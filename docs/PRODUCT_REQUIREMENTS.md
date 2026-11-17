# Product Requirements

Status: Phase 0 draft. Items marked **[ASSUMPTION]** are not confirmed by the owner and are tracked in `RISKS_AND_ASSUMPTIONS.md`.

## 1. Functional requirements

### FR-1 Identity, RBAC, devices

- Owner registration and initial shop setup; login/logout; refresh tokens; session revocation; device registration.
- Employee invitation/management, custom roles, permissions, branch assignment, account deactivation.
- Backend enforces identity, organization membership, branch access, role permissions, session validity.

### FR-2 Product catalog

- Categories; products with SKU (generated or manual); multiple barcodes; MRP; status; min-stock threshold; search/filter.
- Product types WEIGHT / VOLUME / COUNT, each with one canonical base unit.
- Per-product unit conversions (e.g., 1 BAG = 25 KG), purchase-enabled and sale-enabled units, per-unit selling prices.
- Packaged vs loose: separate SKUs where separately sellable (e.g., 500 ML vs 1 L milk).
- No implicit weight↔volume conversion. Fractional quantities on COUNT products only if explicitly configured.
- Conversion factor snapshots stored on transaction lines; historical data never rewritten.

### FR-3 Inventory

- Balances stored in base unit; `available = on_hand − reserved`.
- Signed, append-only stock movements for opening stock, purchase receipt, sale, sale return, purchase return, adjustment, damage, expiry, cancellation reversal.
- Batches and expiry with FEFO for expiry-tracked products.
- Moving weighted-average cost; cost snapshot per transaction.
- Negative stock blocked unless an authorized, audited override is configured.
- Low-stock and expiry alerts; stock valuation; movement history.
- Held bills do not deduct stock; completed sales do.

### FR-4 Procurement and suppliers

- Supplier CRUD; purchases with unit conversion to base unit; discounts and additional costs; partial receipt; purchase returns.
- Only received goods increase stock. Supplier payable created on receipt; partial payments; supplier ledger.

### FR-5 Sales / POS

- Product search, barcode scan, category filter, cart, unit selection, loose quantities, unit-specific price, discounts (permission-gated), customer or walk-in, credit sale, split payment (cash/UPI/card/bank transfer), held bills, sales history.
- Server recalculates all totals, tax, discounts and stock checks; idempotency key per submission.
- Cancellation and returns via reversal/compensating entries. Return classes: SALEABLE, DAMAGED, EXPIRED, QUARANTINED; only SALEABLE re-enters available stock.

### FR-6 Billing and GST

- Normal and GST invoices; shop GST settings; customer GSTIN; HSN/SAC per product; configurable tax rates; tax-inclusive/exclusive pricing; CGST/SGST/IGST by place of supply; round-off.
- Concurrency-safe invoice numbering per branch/series/financial year **[ASSUMPTION]**.
- Invoice preview, PDF, share, print-ready layout. Invoice snapshots immutable.
- GST rules must be validated by a qualified tax professional before production.

### FR-7 Khata and collections

- Customers; append-only customer ledger; credit sales; payments (partial allowed); receipts with numbers; outstanding balance.
- Collection agents, assignments, records capturing customer, collector, amount, mode, reference, timestamp, recording employee, receipt number.
- Balances derived from / reconcilable against ledger entries; no direct balance overwrites.

### FR-8 Finance

- Supplier ledger, payment allocation, expenses and categories, cashbook (in/out), daily closing (expected vs actual cash, difference), payment modes (cash, UPI, card, bank transfer, configurable others).
- Duplicate-payment protection.

### FR-9 Reporting and dashboard

- Sales (daily/weekly/monthly, product, category, payment mode, customer); purchases; inventory (current, valuation, low-stock, expiring, fast/slow movers, movement history); financial (gross profit estimate, expenses, outstanding, collections, cashbook, closing).
- Revenue, gross profit, net profit and cash flow are distinct and labeled correctly.
- Server-side aggregation and pagination.

### FR-10 Offline and sync

- Offline: browse/search cached products, categories, customers; create/hold draft bills; local preferences.
- Completed financial transactions require server confirmation (no offline sales initially).
- SQLite outbox with idempotent processing, backoff retry, duplicate and conflict detection, visible sync status and failures. No last-write-wins for financial data.

### FR-11 Notifications, files, backups

- FCM push (low stock, expiry, etc.). R2 for product images, documents, invoice PDFs, encrypted DB backups. Independent off-site backups with tested restore.

### FR-12 Audit

- Audit log for important operations (auth events, price/permission changes, overrides, cancellations, adjustments, closings).

## 2. Non-functional requirements

| Area          | Requirement                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money         | PostgreSQL NUMERIC + decimal library; never JS floats                                                                                               |
| Integrity     | Transactions, idempotency, row locking/conditional updates, append-only history                                                                     |
| Security      | Short-lived access tokens, hashed passwords and refresh tokens, tenant isolation tests, no secrets in repo/bundle, rate limiting, upload validation |
| Performance   | POS add-to-cart is local/instant; checkout round-trip target under 2 s on typical 4G **[ASSUMPTION]**; reports paginated/aggregated server-side     |
| Availability  | Single Cloud Run service; cold-start mitigation (min instances) decided in Phase 17                                                                 |
| Usability     | Large touch targets, light theme, INR formatting, empty/loading/error/offline states, i18n-ready (English first; Telugu/Hindi later)                |
| Observability | Structured logs, correlation IDs, health endpoints                                                                                                  |
| Data          | UTC timestamps, UUID keys, DB-level constraints, reversible migrations where practical                                                              |

## 3. Out of scope initially

Microservices, Kubernetes, Redis, Kafka, web admin portal, AI forecasting, accounting integrations, multi-DB, offline financial transactions, SaaS billing, multi-warehouse optimization.

## 4. Open product questions

See `RISKS_AND_ASSUMPTIONS.md` §2 (questions requiring owner decision before Phase 2/5/6/9/10).
