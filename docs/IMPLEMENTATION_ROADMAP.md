# Implementation Roadmap

Rule: every phase ends with a completion report (features, files, DB/API changes, tests, known issues, acceptance status PASS/PARTIAL/FAIL/BLOCKED) and **stops for approval**.

| #   | Phase                      | Key outputs                                                                                                                                   | Gate (summary)                                            |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0   | Discovery & planning       | 7 planning docs                                                                                                                               | Requirements, stack, decisions, roadmap, risks documented |
| 1   | System architecture / HLD  | Context, HLD, deployment, auth, sync, sequence diagrams, module dependency rules                                                              | HLD reviewed for needless complexity                      |
| 2   | Database design & ERD      | ERD, Prisma schema (split sensibly), constraints, indexes, tenant strategy, initial migration, seed strategy                                  | Schema validates; migration applies                       |
| 3   | Monorepo & dev env         | pnpm workspace, strict TS, lint/format, env validation, Docker/DB, CI skeleton                                                                | Mobile + API start, DB connects, CI runs                  |
| 4   | Backend foundation         | Bootstrap, config, Prisma service, validation, exception filter, logging, correlation IDs, Swagger, health, guards, throttling                | Integration tests green                                   |
| 5   | Auth, users, RBAC          | Registration, login/refresh/logout, sessions, devices, invitations, roles/permissions, branch assignment                                      | Cross-org and permission tests green                      |
| 6   | Catalog & unit conversion  | Products, categories, barcodes, units, conversions, prices                                                                                    | Conversion + snapshot tests green                         |
| 7   | Inventory engine           | Balances, movements, adjustments, batches/expiry/FEFO, valuation, negative-stock guard                                                        | Reconciliation + concurrency tests green                  |
| 8   | Procurement & suppliers    | Purchases, receipts, returns, supplier payments/ledger                                                                                        | Atomic stock + payable reconciliation                     |
| 9   | Sales & POS engine         | Checkout, split pay, credit, held bills, idempotency, cancel/returns                                                                          | No oversell, no duplicate sale under concurrency          |
| 10  | Billing & GST              | Tax engine, invoice numbering, PDF, share                                                                                                     | Tax tests, concurrent numbering, immutable snapshots      |
| 11  | Khata & collections        | Customer ledger, collections, agents, receipts                                                                                                | Ledger reconciles; attribution correct                    |
| 12  | Supplier ledger & finance  | Expenses, cashbook, daily closing                                                                                                             | Closing math + auditability                               |
| 13  | Reporting & dashboard      | Server-side reports and dashboard                                                                                                             | Reports reconcile to source                               |
| 14  | Offline & sync             | SQLite cache, drafts, outbox, status UI                                                                                                       | Two-device behavior tested                                |
| 15  | Mobile integration         | All screens on real APIs, notifications, scanner, sharing, printing where supported                                                           | No mock data in flows; 2 device sizes                     |
| 16  | Security & quality audit   | Audit, failure-scenario tests, load tests                                                                                                     | No unresolved critical issues                             |
| 17  | Cloud deployment & CI/CD   | Cloud Run, Neon, R2, FCM, backups, restore test, EAS build, **forgot-password flow (owner decision 2026-11-18; remind owner at phase start)** | Staging works; restore proven                             |
| 18  | Final validation & release | 26-step business simulation, guides, checklist                                                                                                | All values reconcile                                      |

## Practical sequencing notes

- Mobile UI work is built feature-by-feature in Phase 15 per the master prompt. To keep feedback early, I propose (needs your approval, see TD-12) building a thin mobile vertical slice (login + product list) in Phase 5/6 to validate the stack end-to-end. This is an addition, not a replacement.
- Tests are written with each phase, not deferred to Phase 16.
- Phase 2's schema is the highest-leverage artifact; expect extra review time there.
- Approvals required from the owner: before Phase 2 (business-rule answers), Phase 10 (GST review by accountant), Phase 17 (cloud accounts and spend).
