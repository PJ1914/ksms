# AGENTS.md — rules for AI agents and contributors

Read `docs/PROJECT_OVERVIEW.md`, `docs/ARCHITECTURE.md`, `docs/TECHNICAL_DECISIONS.md` and the module's docs before changing code.

## Non-negotiables

1. Money and quantities are `NUMERIC` in Postgres and **decimal strings** over the API. Use `decimal.js`. Never use JS `number`, `parseFloat`, or `Number()` for money.
2. Never trust client totals, tax, discounts or stock. Recalculate on the server.
3. Financial writes run in one DB transaction and are idempotent (`Idempotency-Key`).
4. History is append-only (stock movements, ledgers, cashbook, audit logs). Correct with reversing entries. DB triggers enforce this — do not work around them.
5. Every tenant query filters by `organization_id` (and `branch_id` where relevant). Add a cross-tenant test for every new endpoint.
6. Authorization is enforced on the backend. Hiding a button is not security.
7. No secrets in git. `.env` files are ignored; only `*.example` files with placeholders are committed. `EXPO_PUBLIC_*` values are public.
8. Do not claim a feature is done unless backend, frontend and tests exist and pass.

## Module boundaries (backend)

Layering and allowed dependencies are in `docs/architecture/SYSTEM_CONTEXT.md` §4. No cycles. Controllers contain no business logic.

## Workflow

- Pinned versions only (`save-exact`). Do not bump majors without an ADR in `docs/decisions/ADRs/`.
- Before committing run: `pnpm check` (format, lint, typecheck, tests).
- Prisma: edit `apps/api/prisma/schema/*.prisma`; migrations live in `apps/api/prisma/migrations/`; hand-written SQL goes in its own migration. Never run migrations at app start-up.
- Phases are gated: finish, test, document, then wait for owner approval.

## Known tooling facts

- Node 24 LTS, pnpm 12, TypeScript 6.0.x (TypeScript 7 breaks ts-jest/typescript-eslint/Nest Swagger peers), NestJS 11 (CommonJS), Prisma 7.10.1, Expo SDK 58.
- `.npmrc` uses `node-linker=hoisted` because Metro needs a flat `node_modules`.
- Generated Prisma client (`apps/api/src/generated/`) is git-ignored; run `pnpm db:generate`.
