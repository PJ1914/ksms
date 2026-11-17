# Index Strategy

Phase 2. Principles: lead with `organization_id`; index what the screens and reports filter/sort on; avoid speculative indexes (each costs writes). Revisit with `EXPLAIN` on realistic data in Phase 13/16.

## Unique constraints (business rules enforced by the database)

| Table                             | Unique                                                                               | Purpose                                      |
| --------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| users                             | `phone`, `email`                                                                     | Login identity                               |
| organization_members              | `(organization_id, user_id)`                                                         | One membership per org                       |
| branches                          | `(organization_id, code)`                                                            |                                              |
| roles                             | `(organization_id, name)`                                                            |                                              |
| permissions                       | `key`                                                                                |                                              |
| products                          | `(organization_id, sku)`                                                             |                                              |
| product_barcodes                  | `(organization_id, barcode)`                                                         | No ambiguous scans                           |
| product_unit_conversions          | `(product_id, unit_id)`                                                              | One factor per unit                          |
| product_unit_prices               | `(product_id, unit_id, quantity)`                                                    | One price per price point                    |
| inventory_balances                | `(branch_id, product_id)`                                                            | One balance row                              |
| inventory_batches                 | `(branch_id, product_id, batch_number)`                                              |                                              |
| sales                             | `(organization_id, branch_id, sale_number)`                                          |                                              |
| invoices                          | `(org, branch, invoice_number)`, `(org, branch, series, sequence_number)`, `sale_id` | No duplicate/missing-linked numbers          |
| document_sequences                | `(org, branch, document_type, series, financial_year)`                               | Counter row to lock                          |
| payments                          | `(org, branch, receipt_number)`, `reversal_of_id`                                    | Receipt uniqueness; one reversal per payment |
| sale_payments / purchase_payments | `(sale_id, payment_id)` / `(purchase_id, payment_id)`                                | No double allocation                         |
| collection_records                | `payment_id`                                                                         | One collection per payment                   |
| idempotency_records               | `(organization_id, key)`                                                             | Duplicate-submission guard                   |
| sync_operations                   | `(org, device_id, operation_id)`                                                     | Duplicate sync guard                         |
| daily_closings                    | `(register_id, business_date)`                                                       | One closing per day                          |
| user_sessions                     | `refresh_token_hash`                                                                 | Token lookup                                 |

## Query-driven indexes

| Screen / job            | Index                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| POS product search/list | `products (org, status)`, `(org, name)`, partial `(org, name) WHERE deleted_at IS NULL`; barcode unique above |
| Delta sync pull         | `products (org, updated_at)` (same pattern to be added to customers etc. in Phase 14 if measured)             |
| Stock screens           | `inventory_balances (org, branch)` + unique `(branch, product)`                                               |
| Stock movement history  | `stock_movements (org, branch, product, occurred_at)`, `(reference_type, reference_id)`                       |
| FEFO / expiry alerts    | `inventory_batches (org, branch, product, expiry_date)` plus partial index on open batches                    |
| Sales history / reports | `sales (org, branch, sold_at)`, `(org, customer_id, sold_at)`, `(org, status, sold_at)`                       |
| Customer ledger         | `customer_ledger_entries (org, customer_id, occurred_at)`                                                     |
| Supplier ledger         | `supplier_ledger_entries (org, supplier_id, occurred_at)`                                                     |
| Cashbook / closing      | `cashbook_entries (org, branch, business_date)`, `(register_id, business_date)`                               |
| Purchase history        | `purchases (org, branch, purchase_date)`, `(org, supplier_id, purchase_date)`                                 |
| Audit search            | `audit_logs (org, created_at)`, `(org, entity_type, entity_id)`                                               |
| Notifications inbox     | `notifications (org, user_id, read_at)`                                                                       |
| Idempotency cleanup     | `idempotency_records (expires_at)`                                                                            |

## Deferred

- `pg_trgm` GIN index for fuzzy product search — only if `ILIKE` over a few thousand SKUs proves slow (needs Prisma extension support check).
- Reporting materialized views — Phase 13, only if aggregates are measurably slow.
- Partitioning of `stock_movements`/ledgers — not needed at shop scale.
