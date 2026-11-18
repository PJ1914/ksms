# Sales Workflow (Checkout, Cancellation, Returns)

Phase 1 · draft.

## Checkout (single DB transaction)

```mermaid
sequenceDiagram
  participant App
  participant API as Sales service
  participant DB as PostgreSQL
  App->>API: POST /sales {items, customer, payments, Idempotency-Key}
  API->>DB: BEGIN
  API->>DB: INSERT idempotency_records(key, request_hash) ON CONFLICT
  alt key exists & completed
    API-->>App: stored response (HTTP 200, same body)
  else key exists, different request hash
    API-->>App: 422 IDEMPOTENCY_KEY_REUSED
  end
  API->>DB: load products, unit prices, conversions, tax config (snapshot source)
  API->>API: recompute lines, discounts, tax, round-off (decimal math)
  API->>API: validate payments sum == total (credit remainder needs customer)
  loop each line (ordered by product id to avoid deadlocks)
    API->>DB: UPDATE inventory_balances SET on_hand = on_hand - q WHERE on_hand - reserved >= q
    Note right of DB: 0 rows updated → ROLLBACK, 409 INSUFFICIENT_STOCK (unless audited override)
    API->>DB: FEFO batch allocation (lock batches in expiry order) if tracked
    API->>DB: INSERT stock_movements (signed, cost snapshot)
  end
  API->>DB: UPDATE invoice_sequences … RETURNING next (row lock)
  API->>DB: INSERT sale, sale_items(snapshots), invoice, sale_payments
  API->>DB: INSERT payments; cashbook entries for cash; customer_ledger_entry for credit
  API->>DB: INSERT audit_log; UPDATE idempotency_records(response)
  API->>DB: COMMIT
  API-->>App: 201 sale + invoice
  API-)API: post-commit events (low-stock notification, PDF)
```

Properties: all-or-nothing; replays are safe; no stock check outside the transaction; deadlock-safe lock order; on serialization/deadlock error the service retries the whole transaction up to 3 times.

## Held bills

Held bills are drafts: stored locally and optionally in `held_bills` for cross-device pickup. They **never** touch stock or ledgers.

## Cancellation

Only permitted roles, with reason. Within one transaction: mark sale `CANCELLED`, insert compensating `stock_movements` (+qty at original cost), reversal `payments`/cashbook entries, reversing customer ledger entries, and a credit-note-style invoice status. Original rows are never deleted. Not allowed after a closed business day without Owner permission.

## Returns

`sale_returns` link to the original sale lines; quantity ≤ sold − already returned. Each line has a disposition: SALEABLE (+stock), DAMAGED / EXPIRED / QUARANTINED (movement recorded to a non-available bucket, not available stock). Refund modes: cash out, original mode, or reduce customer credit. Tax and price come from the **original sale snapshot**, never current settings.

---

## As built in Phase 9 (2026-11-20)

Where this section differs from the design above, **this section is correct**. Code: `apps/api/src/modules/sales/` (checkout, cancellation, returns, held bills), `customers/` (minimal customers and the customer ledger), `finance/` (cashbook).

### Checkout: one transaction, in this order

1. **Idempotency claim:** a retried or double-tapped checkout returns the first bill.
2. **Prices** come from the catalogue price rules: an exact pack price (500 g = 27), else the unit price, else derived from the base unit. A typed price needs `price.override` and is recorded in the audit.
3. **Discounts:**
   - Line discounts apply first. A bill discount is then shared across the lines in proportion to their value, exact to the paisa.
   - Any discount needs `discount.apply`.
   - In total, discounts may not exceed the shop's cashier limit (`maxCashierDiscountPercent`, 5% by default) unless the user has `discount.override_limit`.
4. **Rounding:** the bill is rounded to the nearest rupee (half up), and the round-off is recorded.
5. **Settlement:**
   - Payments may be split across methods, and together they may not exceed the bill.
   - Whatever is unpaid is credit. Credit needs a customer.
6. **Stock out** goes through the inventory engine: lines in product order, FEFO, expired stock never sold, never below zero. The cost of goods (moving average) is kept on each line.
7. The **bill number** `B/2026-27/000001` comes from the branch's counter, taken after stock, so a refused bill uses no number.
8. The **sale and its lines** are written with permanent snapshots: name, SKU, HSN, unit, conversion factor, price, MRP and cost.
9. **Payments:** one payment per method, each with its cashbook line on the branch's register.
10. **Credit** goes on the customer's account through `CustomerLedgerService`. The customer row is locked last, and the credit limit is checked under that lock (`credit.override_limit` may exceed it).
11. **Audit.**

Lock order everywhere in Sales: **sale -> stock -> document number -> customer**.

### GST

This phase sells for shops with GST switched off; that is the default. A GST-registered shop gets `422 GST_BILLING_NOT_READY` instead of a bill with wrong tax. Tax, GST invoices, invoice numbers and the PDF arrive in Phase 10.

### Held bills

A held bill is a cart parked at the counter, stored per branch (at most 64 KB). It never touches stock, money or numbers. Checking out with `heldBillId` closes it in the same transaction.

### Cancellation

- Who may cancel: users with `sale.cancel` can cancel on the day of the sale; an earlier day needs the Owner. (Phase 12 will change this to "before the day is closed".)
- What happens: the goods go back into stock in the same batches at the original cost. Every payment gets an opposite refund payment and cashbook line, and is marked reversed. The credit comes off the customer's account.
- A bill that already has returns cannot be cancelled. Return the rest instead.

### Returns

- **Value** comes from the original bill. Each line refunds its share of what was charged for it. Partial returns add up exactly, and the bill's round-off is settled by the return that gives the last goods back.
- **Disposition:** `SALEABLE` goods go back into stock, into the latest-expiring batch they were sold from, at the original cost. `DAMAGED`, `EXPIRED` and `QUARANTINED` goods are recorded but never put back on sale.
- **Refund:**
  - As money, but never more than was paid on the bill and not yet refunded (`REFUND_EXCEEDS_PAID`).
  - Or to the customer's account, which reduces what they owe (`CUSTOMER_ACCOUNT`; walk-in bills cannot).

### Customers (minimal; khata in Phase 11)

- Customers are created and edited (versioned) with an optional credit limit. The mobile number is unique per shop.
- They can be switched off; a switched-off customer gets no new credit.
- The statement shows the running balance.
- Only `CustomerLedgerService` changes what a customer owes. The ledger is append-only.

### Proof that the books agree

`GET /sales/reconciliation` returns empty lists when:

- bill totals equal their lines plus round-off;
- paid plus credit equals total;
- payments equal their allocations;
- credit was posted, and reversed on cancellation;
- customer balances equal the ledger sums;
- returned totals agree across the bill, its lines and the return documents;
- stock out per line equals the quantity sold;
- saleable returns came back into stock, and other dispositions did not;
- cancelled bills put all their stock back;
- every sale payment and refund has its cashbook line;
- money refunded equals the refund payments.

### API (all need `X-Branch-Id`; money actions need `Idempotency-Key`)

| Route                                                                           | Permission                                |
| ------------------------------------------------------------------------------- | ----------------------------------------- |
| `POST /sales`                                                                   | `sale.create`                             |
| `GET /sales`, `GET /sales/:id`                                                  | `sale.read`                               |
| `POST /sales/:id/cancel`                                                        | `sale.cancel`                             |
| `POST /sale-returns`                                                            | `sale.return`                             |
| `GET /sale-returns[/:id]`                                                       | `sale.read`                               |
| `GET/POST/PUT/DELETE /held-bills`                                               | `sale.create`                             |
| `GET /sales/reconciliation`                                                     | `report.sales`                            |
| `GET/POST/PATCH /customers[/:id]`, `POST /customers/:id/deactivate\|reactivate` | `customer.read/manage` (no branch needed) |
| `GET /customers/:id/ledger`                                                     | `ledger.read`                             |

### Not in this phase

- GST, invoices, invoice PDF and share (Phase 10).
- Customer payments and collections, collection agents, receipts (Phase 11).
- Daily closing (Phase 12).
- The POS screens on the phone, with offline billing and sync (UI and sync phases).
- Selling below zero stock at the counter (refused; only adjustments may override).
- Choosing a batch by hand at the counter (FEFO always decides).
