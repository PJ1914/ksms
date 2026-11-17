# API Conventions

Phase 4. Implemented in `apps/api/src/common/`. Interactive docs: `GET /api/docs` (UI) and `/api/docs-json` (OpenAPI). Swagger is on by default, off in production unless `SWAGGER_ENABLED=true`.

## URLs and verbs

- Base: `/api/v1`. Resources are plural nouns: `/products`, `/sales`, `/customers`.
- `GET` reads, `POST` creates and commands (`POST /sales/:id/cancel`), `PATCH` partial updates, `DELETE` only for non-transactional master data.

## Success envelope

```json
{ "data": { "...": "..." } }
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 25, "total": 130 } }
```

Return a plain value from a controller to get `{ data }`; return `new Paginated(items, meta)` for lists.

## Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "qty", "messages": ["qty must not be less than 1"] }],
    "correlationId": "573d5243-644e-48c7-aaa0-cc5aad8e6049"
  }
}
```

`code` is stable and machine-readable; `message` is safe to show; `details` is optional. 5xx never leak internals (logged server-side with the correlation id).

| HTTP | code                                                   | Meaning                                                                |
| ---- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`                                     | Body/query failed validation, or unknown fields were sent              |
| 400  | `INVALID_BRANCH_ID` / `BRANCH_REQUIRED`                | `X-Branch-Id` malformed / missing where required                       |
| 401  | `UNAUTHORIZED`                                         | Missing, invalid, expired token, or session revoked / user deactivated |
| 403  | `FORBIDDEN` / `ORG_ACCESS_DENIED` / `BRANCH_FORBIDDEN` | Authenticated but not allowed (permission, organization, branch)       |
| 404  | `NOT_FOUND`                                            | No such route/resource                                                 |
| 409  | `CONFLICT`                                             | Unique-constraint violation (business conflicts add their own codes)   |
| 429  | `RATE_LIMITED`                                         | Too many requests (default 120 / minute / IP; health probes exempt)    |
| 500  | `INTERNAL_ERROR`                                       | Unexpected server error                                                |
| 503  | `DATABASE_UNAVAILABLE`                                 | Readiness check failed                                                 |

Business codes (e.g. `INSUFFICIENT_STOCK`) are added by later phases by throwing `new AppException(code, message, status, details)`.

## Headers

| Header             | Direction        | Purpose                                                                                            |
| ------------------ | ---------------- | -------------------------------------------------------------------------------------------------- |
| `Authorization`    | request          | `Bearer <access token>`                                                                            |
| `X-Branch-Id`      | request          | Working branch (UUID). Must be one the user is assigned to. Required where `@RequireBranch()`      |
| `X-Correlation-Id` | request/response | Client may send 8–64 chars `[A-Za-z0-9_-]`; otherwise generated. Always echoed; in logs and errors |
| `Idempotency-Key`  | request          | UUID per user action on commands (enforced from Phase 9). Redacted from logs                       |

The organization is **never** taken from a header or body; it comes only from the verified token.

## Request pipeline (order)

Rate limit (throttler) → authentication (JWT + live session check) → tenant context (active org membership, branch assignment) → validation pipe (whitelist, reject unknown fields) → controller → response envelope. Exceptions go through one global filter.

- Routes are protected by default. Opt out with `@Public()`.
- Controllers receive tenant scope with `@Tenant()` and must pass it to services/repositories.

## Money and quantities

Decimal **strings** (`"125.50"`, `"0.500"`). Never JSON numbers. Validated with `@ksms/validation`.

## Pagination, filtering, sorting (to be implemented with the first list endpoint, Phase 6)

`?page=1&pageSize=25&sort=-createdAt&q=rice`; `pageSize` max 100; delta sync uses `updated_since` cursors (see SYNC_WORKFLOW).
