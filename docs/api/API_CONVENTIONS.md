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

## Error codes added in Phase 5

| HTTP | code                                        | Meaning                                                                                  |
| ---- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 401  | `INVALID_CREDENTIALS`                       | Wrong mobile/email/password (identical for unknown users)                                |
| 403  | `NO_ACTIVE_MEMBERSHIP`                      | Login is valid but the account is not active in any shop                                 |
| 409  | `ORGANIZATION_REQUIRED`                     | The login belongs to several shops; resend with `organizationId` (list in `details`)     |
| 400  | `INVITATION_INVALID`                        | Wrong, expired, revoked or already used invitation code (deliberately one generic error) |
| 409  | `INVITATION_ALREADY_USED`, `ALREADY_MEMBER` | Revoking an accepted invitation, or inviting an existing employee                        |
| 400  | `OWNER_ROLE_NOT_ASSIGNABLE`                 | The Owner role cannot be given to anyone else                                            |
| 403  | `OWNER_PROTECTED`, `SYSTEM_ROLE_PROTECTED`  | The owner account, Owner role and system roles cannot be changed this way                |
| 403  | `CANNOT_MODIFY_SELF`                        | You cannot change your own role, branches or status                                      |
| 403  | `PERMISSION_ESCALATION`                     | You tried to grant permissions you do not hold (`details.missing`)                       |
| 404  | `ROLE_NOT_FOUND`, `BRANCH_NOT_FOUND`        | Referenced role or branch does not exist in your organization                            |
| 409  | `ROLE_IN_USE`                               | Role still has employees or pending invitations                                          |

## Error codes added in Phase 6 (catalogue)

Business-rule violations from the conversion and pricing engine return **HTTP 422**.

| HTTP | code                                                                                                                              | Meaning                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 422  | `UNIT_DIMENSION_MISMATCH`                                                                                                         | Weight and volume (or count) cannot be converted without density                                |
| 422  | `BASE_UNIT_INVALID`                                                                                                               | Base unit must be a standard unit of the product's own dimension                                |
| 422  | `CONVERSION_FACTOR_REQUIRED`, `CONVERSION_INVALID`, `CONVERSION_MISMATCH`, `CONVERSION_DUPLICATE`, `CONVERSION_NOT_REPRESENTABLE` | A unit's size is missing, not positive, contradicts the standard size, repeated, or too precise |
| 422  | `FRACTIONAL_NOT_ALLOWED`, `FRACTIONAL_REQUIRED`                                                                                   | Piece-counted items are sold whole; weight/volume items are always fractional                   |
| 422  | `QUANTITY_PRECISION`, `QUANTITY_INVALID`, `INCREMENT_VIOLATION`                                                                   | Quantity finer than 0.001 base unit, not positive, or not a multiple of the sale step           |
| 422  | `PRICE_NOT_CONFIGURED`, `PRICE_DUPLICATE`, `PRICE_UNIT_NOT_CONFIGURED`, `UNIT_NOT_CONFIGURED`, `UNIT_NOT_SALE_ENABLED`            | Pricing problems                                                                                |
| 422  | `BASE_UNIT_REQUIRED`, `BASE_UNIT_MUST_SELL`                                                                                       | The base unit cannot be removed or made non-sellable                                            |
| 422  | `CATEGORY_CYCLE`, `CATEGORY_TOO_DEEP`                                                                                             | Category tree rules                                                                             |
| 404  | `UNIT_NOT_FOUND`, `CATEGORY_NOT_FOUND`                                                                                            | Referenced unit does not exist / category is not in your organization                           |
| 409  | `SKU_IN_USE`, `BARCODE_IN_USE`                                                                                                    | Unique within the shop (`details` names the product holding the barcode)                        |
| 409  | `VERSION_CONFLICT`                                                                                                                | The product changed on another device (`details.currentVersion`)                                |
| 409  | `PRODUCT_HAS_HISTORY`, `CONVERSION_EXISTS`, `UNIT_IN_USE`, `UNIT_HAS_PRICES`, `CATEGORY_NOT_EMPTY`                                | Refused to protect existing data                                                                |

## Error codes added in Phase 7 (inventory and idempotency)

Stock commands (`POST /inventory/opening-stock`, `POST /inventory/adjustments`) require an `Idempotency-Key` header (a UUID). A repeat with the same key and the same body returns the stored result with the header `Idempotent-Replayed: true`.

| HTTP | code                                                                                              | Meaning                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 400  | `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID`                                             | The `Idempotency-Key` header is missing or not a UUID                                           |
| 422  | `IDEMPOTENCY_KEY_REUSED`                                                                          | The key was already used for a different request                                                |
| 409  | `IDEMPOTENCY_IN_PROGRESS`                                                                         | The original request is still running; retry shortly                                            |
| 409  | `INSUFFICIENT_STOCK`                                                                              | Not enough sellable stock (`details.requested`, `details.available`, `details.expired`)         |
| 409  | `OPENING_STOCK_LOCKED`                                                                            | The product already has activity in this branch; use an adjustment                              |
| 422  | `NEGATIVE_STOCK_DISABLED`, `OVERRIDE_REASON_REQUIRED`                                             | Going below zero is off in shop settings, or no reason was given                                |
| 403  | `FORBIDDEN` (`details.required: ["stock.override_negative"]`)                                     | You may not take stock below zero                                                               |
| 422  | `ADJUSTMENT_DIRECTION`, `QUANTITY_INVALID`                                                        | Damage/expiry/loss must remove stock, found stock must add it; quantity must not be zero        |
| 422  | `UNIT_COST_REQUIRED`, `UNIT_COST_INVALID`                                                         | A receipt needs a valid, non-negative cost                                                      |
| 422  | `BATCH_REQUIRED`, `EXPIRY_REQUIRED`, `EXPIRY_INVALID`, `BATCH_INPUT_INVALID`, `BATCH_NOT_TRACKED` | Batch or expiry details are missing, malformed, or given for a product that does not track them |
| 422  | `BATCH_EXPIRY_MISMATCH`                                                                           | A batch number keeps one expiry date                                                            |
| 422  | `BATCH_ALREADY_EXPIRED`, `BATCH_EXPIRED`                                                          | Expired stock cannot be received or sold                                                        |
| 404  | `BATCH_NOT_FOUND`                                                                                 | Batch not found for this product in this branch, or already empty                               |
| 400  | `BRANCH_REQUIRED`                                                                                 | Inventory routes need the `X-Branch-Id` header                                                  |
