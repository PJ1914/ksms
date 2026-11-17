# Architecture (Phase 0 outline)

Status: superseded in detail by the Phase 1 HLD in `docs/architecture/` (SYSTEM_CONTEXT, DEPLOYMENT, AUTHENTICATION, SALES_WORKFLOW, INVENTORY_WORKFLOW, SYNC_WORKFLOW). Where they differ, `docs/architecture/` wins. Notable change: Finance no longer depends on Payments; Payments depends on Finance and the two Accounts modules (acyclic layering).

## 1. Style

Modular monolith. One NestJS deployable, one PostgreSQL database, one React Native Android client. Modules are organized independently inside the monolith and communicate through explicit service interfaces; no module reaches into another's tables via its repository.

## 2. System context

```
 Android app (Owner/Manager/Cashier/Agent)
    │  HTTPS REST /api/v1 (JWT)             ▲ FCM push
    ▼                                        │
 Cloud Run: NestJS API ──── Prisma ──► Neon PostgreSQL (source of truth)
    │            │
    │            └──► Cloudflare R2 (images, invoice PDFs, encrypted backups; signed URLs)
    └──► Firebase Cloud Messaging (notifications only)

 On device: SQLite (Drizzle) = cache, drafts, held bills, outbox. SecureStore = tokens.
```

## 3. Backend modules

Identity & Access · Organization · Branch · Product Catalog · Inventory · Sales · Billing · Procurement · Supplier Accounts · Customer Accounts · Payments · Finance · Reporting · Notifications · Audit & Sync.

### Layering inside each module

`controller (HTTP, DTO validation, permission decorators) → application service (use case, transaction boundary) → domain logic (pure functions: conversion, tax, pricing, ledger math) → repository (Prisma)`.

### Allowed dependency direction (draft; finalized Phase 1)

```
Identity, Organization, Branch          (foundation; depend on nothing business)
Catalog ─► (foundation)
Inventory ─► Catalog
Procurement ─► Catalog, Inventory, Supplier Accounts
Sales ─► Catalog, Inventory, Customer Accounts, Payments, Billing
Billing ─► Catalog, Organization
Payments ─► Customer/Supplier Accounts, Finance
Finance ─► Payments (ledger/cashbook writes)
Reporting ─► read-only over all (via SQL views/queries)
Notifications ─► (event subscribers)
Audit & Sync ─► (cross-cutting; others call it, it calls none)
```

Rule: no cycles. Cross-module side effects that would create a cycle use in-process domain events (NestJS event emitter) dispatched after commit, or are orchestrated by the higher-level module (Sales orchestrates the checkout transaction).

## 4. Critical transaction: checkout

Single DB transaction, keyed by idempotency key:

1. Check idempotency record (return stored result if replay).
2. Load products, prices, conversions, tax config; recompute everything server-side with decimal math.
3. Allocate stock (FEFO for batch-tracked) using conditional update / `SELECT … FOR UPDATE`; fail if insufficient and no override.
4. Insert sale, items (with snapshots), stock movements, payments, ledger entries (credit portion), cashbook entries (cash portion).
5. Allocate invoice number from `invoice_sequences` with row lock.
6. Write audit and idempotency result; commit. Post-commit: events (notifications, PDF generation).

## 5. Data and money rules

- UUID PKs; `organization_id` on all tenant rows, `branch_id` on branch-operational rows; composite FKs/indexes lead with tenant key.
- NUMERIC for money (e.g., (14,2)) and quantities (e.g., (14,3)); decimal.js in code, Prisma Decimal at the boundary.
- Append-only: stock_movements, ledger entries, cashbook entries, audit_logs. Corrections are compensating rows.
- Cached balances (`inventory_balances`, customer/supplier balance) are derived and reconcilable; reconciliation jobs/tests compare to ledgers.

## 6. Sync (Phase 14 summary)

Online-first. Reads cached in SQLite with `updated_since` pull. Writes of non-financial drafts local-only. Financial commands go through API with idempotency keys; the outbox exists for retriable non-conflicting operations and visibility, not for offline sales. Conflicts are surfaced, never silently overwritten.

## 7. Auth

Argon2id password hashes; 15-min JWT access tokens; rotating opaque refresh tokens stored hashed per device session; revocation by session. Guards: authentication → org/branch context → permission check.

## 8. Deployment

Cloud Run (asia-south1) + Neon (pooled URL at runtime, direct URL for migrations run from a CI job) + R2 + FCM. GitHub Actions CI/CD; EAS for Android builds.

## 9. Cross-cutting

Global validation pipe, exception filter with stable error codes, structured JSON logging with correlation ID, Swagger at `/api/docs`, throttling, health `/api/v1/health`.
