# Test Strategy

| Layer        | Location / command                                                             | Database                             | Purpose                                                                           |
| ------------ | ------------------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------- |
| Unit         | `src/**/*.spec.ts` — `pnpm test`                                               | none                                 | Pure logic: env validation, decimals, tax/conversion engines (later), formatting  |
| API e2e      | `apps/api/test/*.e2e-spec.ts` — `pnpm --filter @ksms/api test:e2e`             | **mocked Prisma**                    | Real Nest app: pipes, filters, guards, throttling, Swagger, auth and tenant rules |
| Integration  | `apps/api/test/integration/*.int-spec.ts` — `pnpm --filter @ksms/api test:int` | **real PostgreSQL** (`DATABASE_URL`) | Locking, concurrency, constraints, transactions, reconciliation                   |
| Mobile logic | `apps/mobile/src/**/*.spec.ts`                                                 | none                                 | Utilities, validation, sync logic                                                 |
| Bundle check | `pnpm --filter @ksms/mobile export:check`                                      | none                                 | App compiles for Android                                                          |

## Principles

- Test failure paths, not just success (revoked sessions, wrong algorithm tokens, other organizations, DB down).
- Security rules get **mutation checks**: temporarily break the rule and confirm a test fails (done for session revocation and branch assignment in Phase 4).
- Integration tests create and drop their own objects; they never rely on shared data. History tables reject `TRUNCATE`/`DELETE`, so use fresh schemas for resets.
- Never mark a phase complete with failing tests; record evidence in `TEST_RESULTS.md`.
- Every new endpoint needs: unauthenticated test, cross-organization test, permission test (from Phase 5), validation test.
