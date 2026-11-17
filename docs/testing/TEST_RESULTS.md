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
