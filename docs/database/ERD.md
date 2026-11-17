# Entity Relationship Diagrams

Phase 2 · source of truth is `apps/api/prisma/schema/*.prisma`. Diagrams show key columns and relationships only (53 tables total). Actor columns (`created_by_id`, `cancelled_by_id`, …) are plain UUIDs unless shown as a relationship.

## 1. Identity and organization

```mermaid
erDiagram
  organizations ||--o{ branches : has
  organizations ||--o{ organization_members : has
  organizations ||--o{ roles : defines
  users ||--o{ organization_members : "is member"
  roles ||--o{ organization_members : assigned
  roles ||--o{ role_permissions : grants
  permissions ||--o{ role_permissions : in
  organization_members ||--o{ branch_memberships : "works at"
  branches ||--o{ branch_memberships : includes
  users ||--o{ user_sessions : owns
  users ||--o{ devices : registers
  devices ||--o{ user_sessions : used_by
  organizations ||--o{ invitations : issues
```

## 2. Catalog and inventory

```mermaid
erDiagram
  product_categories ||--o{ products : groups
  product_categories ||--o{ product_categories : parent
  units_of_measurement ||--o{ products : "base unit"
  products ||--o{ product_unit_conversions : "unit → base factor"
  units_of_measurement ||--o{ product_unit_conversions : unit
  products ||--o{ product_unit_prices : prices
  products ||--o{ product_barcodes : barcodes
  products ||--o{ inventory_balances : "per branch"
  products ||--o{ inventory_batches : batches
  products ||--o{ stock_movements : history
  inventory_batches ||--o{ stock_movements : "batch moves"
  stock_transfers ||--o{ stock_transfer_items : lines
```

`stock_adjustments` links to its `stock_movements` row through `movement_id` (unique).

## 3. Procurement and sales

```mermaid
erDiagram
  suppliers ||--o{ purchases : supplies
  purchases ||--o{ purchase_items : lines
  products ||--o{ purchase_items : bought
  purchases ||--o{ purchase_payments : "paid by"
  payments ||--o{ purchase_payments : allocated
  suppliers ||--o{ purchase_returns : returns
  purchase_returns ||--o{ purchase_return_items : lines

  customers ||--o{ sales : buys
  sales ||--o{ sale_items : lines
  products ||--o{ sale_items : sold
  sales ||--o{ sale_payments : "paid by"
  payments ||--o{ sale_payments : allocated
  sales ||--|| invoices : "invoiced as"
  sales ||--o{ sale_returns : returns
  sale_returns ||--o{ sale_return_items : lines
  sale_items ||--o{ sale_return_items : returned
```

## 4. Finance and operations

```mermaid
erDiagram
  customers ||--o{ customer_ledger_entries : ledger
  suppliers ||--o{ supplier_ledger_entries : ledger
  customers ||--o{ payments : pays
  expense_categories ||--o{ expenses : classifies
  cash_registers ||--o{ cashbook_entries : records
  cash_registers ||--o{ daily_closings : closes
  collection_agents ||--o{ collection_assignments : assigned
  customers ||--o{ collection_assignments : "assigned to"
  collection_agents ||--o{ collection_records : collects
  customers ||--o{ collection_records : from
  payments ||--o| collection_records : "is a"
  users ||--o{ audit_logs : acts
```

Standalone tables (no FKs, keyed by org): `held_bills`, `document_sequences`, `notifications`, `idempotency_records`, `sync_operations`.

## 5. Source-of-truth vs derived data

| Derived cache                         | Source of truth                        | Reconciliation             |
| ------------------------------------- | -------------------------------------- | -------------------------- |
| `inventory_balances.quantity_on_hand` | SUM(`stock_movements.quantity`)        | Phase 7 test + nightly job |
| `inventory_batches.quantity_on_hand`  | SUM(batch movements)                   | Phase 7                    |
| `customers.balance`                   | SUM(`customer_ledger_entries.amount`)  | Phase 11                   |
| `suppliers.balance`                   | SUM(`supplier_ledger_entries.amount`)  | Phase 12                   |
| `sale_items.returned_base_quantity`   | SUM(`sale_return_items.base_quantity`) | Phase 9                    |
| Cash expected (daily closing)         | opening + SUM(CASH `cashbook_entries`) | Phase 12                   |
