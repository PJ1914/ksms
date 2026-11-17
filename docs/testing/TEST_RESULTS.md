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
