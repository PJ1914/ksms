# Test Results

## Phase 4 — Backend foundation (2026-11-18)

| Suite                                                | Result                                      |
| ---------------------------------------------------- | ------------------------------------------- |
| API unit (`pnpm test`)                               | 6 / 6 pass                                  |
| API e2e, DB mocked                                   | 29 / 29 pass (foundation 27 + rate limit 2) |
| API integration, **real Neon via pooled URL**        | 4 / 4 pass                                  |
| Packages (validation 4, api-client 2) and mobile (3) | 9 / 9 pass                                  |
| Mutation check: ignore session revocation            | caught (1 failing test)                     |
| Mutation check: skip branch-assignment check         | caught (1 failing test)                     |

Integration evidence (risk R-07, `pooled-locking.int-spec.ts`), through the same pooled URL the API uses:

- 25 concurrent `SELECT … FOR UPDATE` read-modify-write transactions → counter exactly 25 (no lost updates).
- 20 concurrent conditional decrements on stock 5 → exactly 5 succeed, stock ends at 0 (no oversell).
- 15 concurrent `pg_advisory_xact_lock` sections → exactly 15 increments.
- Failed transaction rolls back completely.

Finding: Prisma's default transaction start timeout (2 s) is too short when checkouts queue behind a lock on a remote database. The API now sets `maxWait` 15 s / `timeout` 20 s (`TRANSACTION_OPTIONS`).

Manual run against Neon: `/health/ready` → `{"data":{"status":"ok","database":"up"}}`; unauthenticated `/context` → 401 standard error with echoed correlation id; Swagger lists all routes; a fake bearer token never appears in logs.

Not verified: Swagger UI rendering in a browser; GitHub Actions (account billing lock, see phase report).

## Phase 5 — Authentication, users and RBAC (2026-11-18)

| Suite                                                                         | Result                                                                            |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Unit (API 9, validation 17, api-client 2, mobile 3)                           | 31 / 31 pass                                                                      |
| API e2e, DB mocked (foundation + RBAC default-deny + rate limit)              | 37 / 37 pass                                                                      |
| **Identity integration on a real PostgreSQL schema** (all migrations applied) | **42 / 42 pass** (about 4.5 min against remote Neon; seconds on a local database) |
| `pnpm check`                                                                  | exit 0                                                                            |

The integration suite covers: owner registration (atomic setup, duplicate and rollback, validation, phone formats), login (phone or email, no account enumeration), refresh rotation and theft detection, concurrent refresh, expired sessions, logout, password change, devices, invitations (one-time code, hashed, expiry, revoke, concurrent acceptance, multi-shop accounts), RBAC for Cashier, Manager and Collection Agent, custom roles with immediate effect, privilege escalation, Owner and system role protection, deactivation (immediate sign-out), branch assignment, organization settings, **cross-organization isolation (shop A against shop B across every route)**, the audit trail, and database-level audit immutability. Credential rate limiting is tested separately.

Mutation checks (a rule is deliberately broken, a test must fail, then the code is restored byte-for-byte):

| Broken rule                                                     | Caught by               |
| --------------------------------------------------------------- | ----------------------- |
| Employee lookups ignore the organization (cross-tenant leak)    | cross-organization test |
| Privilege-escalation check removed                              | escalation test         |
| Deactivation does not revoke sessions                           | deactivation test       |
| Routes without a permission policy allowed (fail open)          | default-deny test       |
| Reuse of a rotated refresh token no longer revokes              | rotation test           |
| (Phase 4) session revocation ignored; branch assignment ignored | foundation tests        |

Cleanup verified: no leftover test schemas in Neon, and the real tables still hold 0 rows.

## Phase 6 — Product catalogue and unit conversion (2026-11-18)

| Suite                                                                            | Result                             |
| -------------------------------------------------------------------------------- | ---------------------------------- |
| Conversion and pricing engine unit tests (pure functions)                        | 36 / 36 pass                       |
| All other unit tests (API 9, validation 17, api-client 2, mobile 3)              | 31 / 31 pass                       |
| API e2e, DB mocked                                                               | 37 / 37 pass                       |
| **Catalogue integration on a real PostgreSQL schema** (all 3 migrations applied) | **48 / 48 pass** (see note)        |
| Identity integration (unchanged)                                                 | 42 / 42 pass in the previous phase |

Note: the first full catalogue run passed 44 of 48; the four failures were mistakes in the test data (a one-letter product name, a barcode prefix typo, and pricing a weight product in pieces), not product defects. After fixing the tests, the affected groups were re-run (29 / 29) and the other 19 tests had already passed. The complete suite runs again in CI on a clean PostgreSQL 17.

The catalogue integration suite covers the specification's examples (loose rice with 25 kg bags and 500 g price point, loose oil with a 15 L can, packaged oil with a carton of 12 and whole-pieces-only, milk 500 ml and 1 L as separate SKUs, the 50 g sale step), 24 rule-violation cases, SKU and barcode uniqueness and scanning, versioned edits, conversion and price changes with audit before/after, atomic price replacement, history protection, search (name, SKU, barcode prefix), filters, server-side pagination and sorting, delta sync, the category tree, permissions for Cashier / Collection Agent / Manager, and **cross-organization isolation across every route**.

Mutation checks (a rule is deliberately broken, a test must fail, then the code is restored byte-for-byte):

| Broken rule                                                         | Caught by                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Weight to volume conversion allowed (both dimension checks removed) | engine unit tests (a single removed check is covered by the second layer, by design) |
| Fractional quantity rounded instead of refused                      | engine unit tests                                                                    |
| Fractional pieces allowed for whole-number products                 | engine unit tests                                                                    |
| Exact price point ignored                                           | pricing unit tests                                                                   |
| Price rounding changed from half-up to truncation                   | pricing unit tests                                                                   |
| Product lookups ignore the organization (cross-tenant leak)         | cross-organization integration test                                                  |
| History check on deletion disabled                                  | history integration test                                                             |
| Version conflict check disabled                                     | versioning integration test                                                          |

Two of my first mutation attempts were invalid (a syntax error from a wrong edit); they were redone correctly and are not counted above.

Not yet verifiable in this phase: that **sale and purchase lines keep their own conversion snapshot**. The engine produces an immutable snapshot (tested), but no purchase or sale lines exist yet. This is re-verified end to end in Phases 8 and 9.

Neon after the run: migration applied, 20 global units seeded, no leftover test schemas, real tables still empty.
