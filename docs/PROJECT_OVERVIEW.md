# Project Overview — Kirana Store Management System (KSMS)

Status: Phase 0 draft, awaiting approval. Last updated: 2026-11-17.

## 1. Purpose

A mobile-first system for Indian kirana (grocery/retail) shops covering products, inventory, purchases, POS billing, GST invoices, customer credit (Khata), supplier payables, collections, expenses, cashbook, reports, employees and sync/backup.

## 2. Initial deployment

- One physical shop, two Android devices.
- Architecture must allow multiple branches/shops/organizations later without a rewrite (tenant keys `organization_id`, `branch_id` from day one).

## 3. Users and roles

| Role             | Scope                                                        |
| ---------------- | ------------------------------------------------------------ |
| Owner            | Full access                                                  |
| Manager          | Operational + financial, permission-gated                    |
| Cashier          | POS + permitted customer operations                          |
| Collection Agent | Assigned collections and payment recording, permission-gated |

Authorization is enforced on the backend (RBAC + org/branch scoping). UI hiding is cosmetic only.

## 4. Product scope (summary)

Home dashboard · Stock (catalog, units, batches, expiry) · Billing (POS, held bills, returns) · Khata (customer ledger, collections) · More (purchases, suppliers, expenses, cashbook, reports, employees, settings, sync status). Full detail in `PRODUCT_REQUIREMENTS.md`.

## 5. Guiding principles

Correctness and financial integrity over speed. Modular monolith. Server is the source of truth for all money and stock. Append-only ledgers and stock movements. Decimal arithmetic only. Idempotent, transactional financial writes. Nothing is "done" without backend + frontend + tests.

## 6. Current repository state (Phase 0 discovery)

- `e:\my projects\KSMS` is empty. Not a git repository. No existing code, designs, credentials or configuration.
- Toolchain on the dev machine: Node v24.18.0, npm 10.9.0, git 2.44, Java 21 (OpenJDK).
- Missing: pnpm, Docker, Android SDK / adb, EAS CLI, psql. `ANDROID_HOME` is unset.

## 7. Document map

`PRODUCT_REQUIREMENTS.md` · `ARCHITECTURE.md` · `TECH_STACK.md` · `IMPLEMENTATION_ROADMAP.md` · `TECHNICAL_DECISIONS.md` · `RISKS_AND_ASSUMPTIONS.md`. Later phases add `docs/database/`, `docs/api/`, `docs/architecture/`, `docs/decisions/ADRs/`, `docs/testing/`.
