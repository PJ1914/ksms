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
