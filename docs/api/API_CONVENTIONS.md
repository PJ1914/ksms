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

## Error codes added in Phase 8 (suppliers, purchases, returns, payments)

Money-writing routes need an `Idempotency-Key` header (see Phase 7) and `X-Branch-Id`.

| HTTP | code                                                                                                                                             | Meaning                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 404  | `SUPPLIER_NOT_FOUND`, `PURCHASE_NOT_FOUND`, `PURCHASE_RETURN_NOT_FOUND`, `PAYMENT_NOT_FOUND`                                                     | Not found in this shop (or this branch, for purchases and returns)                     |
| 409  | `SUPPLIER_NAME_IN_USE`                                                                                                                           | A supplier with this name exists (ignoring capital letters); `details.supplierId`      |
| 409  | `SUPPLIER_INVOICE_DUPLICATE`                                                                                                                     | This supplier's bill number was already entered; `details.purchaseId`                  |
| 409  | `VERSION_CONFLICT`                                                                                                                               | The supplier changed on another device (`details.currentVersion`)                      |
| 422  | `SUPPLIER_INACTIVE`                                                                                                                              | Switched-off suppliers cannot receive new purchases                                    |
| 409  | `PURCHASE_NOT_EDITABLE`, `PURCHASE_NOT_DRAFT`                                                                                                    | Only a draft can be edited / confirmed                                                 |
| 409  | `PURCHASE_CANCELLED`, `PURCHASE_ALREADY_RECEIVED`, `PURCHASE_HAS_RECEIPTS`                                                                       | The purchase is in the wrong state: cancelled, fully received, or already has goods in |
| 409  | `PURCHASE_NOT_RETURNABLE`                                                                                                                        | Goods that were never received cannot be returned                                      |
| 422  | `RECEIPT_EXCEEDS_ORDER`, `NOTHING_TO_RECEIVE`                                                                                                    | More than outstanding was entered / nothing is left; `details.remainingBaseQuantity`   |
| 422  | `RETURN_EXCEEDS_RECEIVED`                                                                                                                        | More than can still be returned; `details.returnableBaseQuantity`                      |
| 422  | `ITEM_NOT_IN_PURCHASE`, `DUPLICATE_RECEIPT_LINE`                                                                                                 | A line does not belong to the purchase, or is listed twice                             |
| 422  | `PRODUCT_NOT_ACTIVE`, `UNIT_NOT_CONFIGURED`, `UNIT_NOT_PURCHASE_ENABLED`                                                                         | The product or unit cannot be bought (`details.line` = line number)                    |
| 422  | `DISCOUNT_EXCEEDS_LINE`, `ROUND_OFF_TOO_LARGE`, `PURCHASE_EMPTY`, `PURCHASE_TOTAL_NEGATIVE`, `AMOUNT_TOO_LARGE`, `ADDITIONAL_COST_UNALLOCATABLE` | Purchase arithmetic rules                                                              |
| 422  | `PURCHASE_DATE_FUTURE`, `PURCHASE_DATE_INVALID`, `EXPIRY_INVALID`                                                                                | Dates must be real calendar dates; a purchase cannot be dated in the future            |
| 422  | `PAYMENT_AMOUNT_INVALID`                                                                                                                         | A payment must be more than zero                                                       |
| 422  | `ALLOCATION_NOT_PAYABLE`, `ALLOCATION_DUPLICATE`, `ALLOCATION_INVALID`, `ALLOCATION_EXCEEDS_OUTSTANDING`, `ALLOCATION_EXCEEDS_PAYMENT`           | Payment allocation rules                                                               |
| 409  | `PAYMENT_ALREADY_REVERSED`                                                                                                                       | This payment was already reversed                                                      |

## Added with the Phase 8 audit follow-ups (2026-11-19)

| HTTP | code           | Meaning                                                                                                                                                 |
| ---- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `INVALID_DATE` | A `from` / `to` filter is not a real date (for example `2026-02-31`). Plain dates cover whole India-time days: `to=2026-11-18` includes the entire 18th |

`POST /supplier-payments/:id/reverse` now requires `X-Branch-Id` and only finds payments made in that branch. A branch that has been switched off or deleted is refused (`BRANCH_FORBIDDEN`) even for people assigned to it.

## Error codes added in Phase 9 (sales, returns, held bills, customers)

Checkout, cancellation and returns need an `Idempotency-Key` header and `X-Branch-Id`.

| HTTP | code                                                                                   | Meaning                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 422  | `GST_BILLING_NOT_READY`                                                                | The shop has GST switched on; GST bills arrive in Phase 10                                                                                        |
| 422  | `SALE_EMPTY`, `PRODUCT_NOT_ACTIVE`, `UNIT_NOT_CONFIGURED`, `UNIT_NOT_SALE_ENABLED`     | The bill or a line cannot be sold as entered                                                                                                      |
| 409  | `INSUFFICIENT_STOCK`                                                                   | Not enough sellable stock (see Phase 7); nothing is saved and no bill number is used                                                              |
| 422  | `DISCOUNT_INVALID`, `DISCOUNT_EXCEEDS_LINE`, `DISCOUNT_EXCEEDS_BILL`                   | Discount amounts that cannot apply                                                                                                                |
| 403  | `DISCOUNT_LIMIT_EXCEEDED`                                                              | Discount above the shop's cashier limit (`details.limitPercent`, `details.requestedPercent`)                                                      |
| 403  | `FORBIDDEN` (`details.required`)                                                       | A discount, typed price (`price.override`) or credit-limit override (`credit.override_limit`) the user may not give                               |
| 422  | `PAYMENT_AMOUNT_INVALID`, `PAYMENT_EXCEEDS_TOTAL`                                      | A payment of zero, or payments adding up to more than the bill                                                                                    |
| 422  | `CREDIT_NEEDS_CUSTOMER`                                                                | An unpaid amount needs a customer to put it on                                                                                                    |
| 422  | `CREDIT_LIMIT_EXCEEDED`                                                                | Over the customer's credit limit (`details.creditLimit`, `balance`, `available`); send `overrideCreditLimit: true` with the permission to go over |
| 422  | `CUSTOMER_INACTIVE`                                                                    | A switched-off customer gets no new credit                                                                                                        |
| 404  | `SALE_NOT_FOUND`, `SALE_RETURN_NOT_FOUND`, `HELD_BILL_NOT_FOUND`, `CUSTOMER_NOT_FOUND` | Not found in this shop (and this branch, for bills, returns and held bills)                                                                       |
| 409  | `SALE_ALREADY_CANCELLED`, `SALE_HAS_RETURNS`, `SALE_CANCELLED`                         | Wrong state for a cancellation or a return                                                                                                        |
| 403  | `SALE_CANCEL_WINDOW_CLOSED`                                                            | Only the owner can cancel a bill from an earlier day (`details.soldOn`)                                                                           |
| 422  | `ITEM_NOT_IN_SALE`, `RETURN_EXCEEDS_SOLD`                                              | A return line not on the bill, or more than is left to return (`details.returnableBaseQuantity`)                                                  |
| 422  | `REFUND_EXCEEDS_PAID`, `REFUND_NEEDS_CUSTOMER`                                         | Cash refund above what was paid (`details.refundable`), or a walk-in bill refunded to an account                                                  |
| 400  | `HELD_BILL_TOO_LARGE`                                                                  | A held bill is limited to 64 KB                                                                                                                   |
| 409  | `CUSTOMER_PHONE_IN_USE`                                                                | Another customer of the shop has this mobile number (`details.customerId`)                                                                        |
| 409  | `VERSION_CONFLICT`                                                                     | The customer changed on another device                                                                                                            |

## Error codes added with Phase 10 (GST billing and invoices)

| HTTP | code                       | Meaning                                                                                       |
| ---- | -------------------------- | --------------------------------------------------------------------------------------------- |
| 422  | `BRANCH_GST_INCOMPLETE`    | GST is on but the branch has no GSTIN or state code                                           |
| 422  | `PRODUCT_GST_RATE_MISSING` | A taxable product has no GST rate (`details.line`, `details.productId`)                       |
| 422  | `TAX_RATE_INVALID`         | A GST rate outside 0 to 100%                                                                  |
| 404  | `INVOICE_NOT_FOUND`        | No such invoice in this shop and branch                                                       |
| 503  | `SERVER_TOO_SLOW`          | The database could not finish in time; nothing was saved. Try again (split a very large bill) |

`GST_BILLING_NOT_READY` (Phase 9) is no longer returned: GST shops can bill.

## Error codes added with Phase 11 (khata and collections)

| HTTP | code                          | Meaning                                                   |
| ---- | ----------------------------- | --------------------------------------------------------- |
| 422  | `PAYMENT_AMOUNT_INVALID`      | The payment must be more than zero                        |
| 422  | `COLLECTED_AT_INVALID`        | The collection time is not a valid date                   |
| 422  | `COLLECTED_AT_IN_FUTURE`      | The collection time cannot be in the future               |
| 422  | `COLLECTED_AT_TOO_OLD`        | More than 7 days back                                     |
| 422  | `START_DATE_INVALID`          | An assignment start date that is not a real calendar date |
| 422  | `AGENT_INACTIVE`              | The collection agent is switched off                      |
| 422  | `AGENT_USER_ALREADY_LINKED`   | That login already belongs to another agent               |
| 403  | `AGENT_ATTRIBUTION_FORBIDDEN` | A collector tried to record under another agent           |
| 404  | `COLLECTION_NOT_FOUND`        | No such collection receipt in this shop and branch        |
| 404  | `COLLECTION_AGENT_NOT_FOUND`  | No such agent in this shop                                |
| 404  | `ASSIGNMENT_NOT_FOUND`        | No such assignment for this agent                         |
| 409  | `PAYMENT_ALREADY_REVERSED`    | The collection was already reversed                       |
| 409  | `ASSIGNMENT_ALREADY_ACTIVE`   | The customer is already actively assigned to this agent   |
| 409  | `ASSIGNMENT_ALREADY_ENDED`    | The assignment has already ended                          |

Routes: `POST /customers/:id/payments`, `POST /collections` (both need `Idempotency-Key` and `collection.create`), `GET /collections`, `GET /collections/:id`, `GET /collections/reconciliation` (`collection.read`), `POST /collections/:id/reverse` (`collection.assign`), `GET|POST /collection-agents`, `GET|PATCH /collection-agents/:id`, `POST /collection-agents/:id/assignments`, `POST /collection-agents/:id/assignments/:assignmentId/end`, `GET /collection-agents/:id/summary`.

## Error codes added with Phase 11 (khata and collections)

| HTTP | code                          | Meaning                                                   |
| ---- | ----------------------------- | --------------------------------------------------------- |
| 422  | `PAYMENT_AMOUNT_INVALID`      | The payment must be more than zero                        |
| 422  | `COLLECTED_AT_INVALID`        | The collection time is not a valid date                   |
| 422  | `COLLECTED_AT_IN_FUTURE`      | The collection time cannot be in the future               |
| 422  | `COLLECTED_AT_TOO_OLD`        | More than 7 days back                                     |
| 422  | `START_DATE_INVALID`          | An assignment start date that is not a real calendar date |
| 422  | `AGENT_INACTIVE`              | The collection agent is switched off                      |
| 422  | `AGENT_USER_ALREADY_LINKED`   | That login already belongs to another agent               |
| 403  | `AGENT_ATTRIBUTION_FORBIDDEN` | A collector tried to record under another agent           |
| 404  | `COLLECTION_NOT_FOUND`        | No such collection receipt in this shop and branch        |
| 404  | `COLLECTION_AGENT_NOT_FOUND`  | No such agent in this shop                                |
| 404  | `ASSIGNMENT_NOT_FOUND`        | No such assignment for this agent                         |
| 409  | `PAYMENT_ALREADY_REVERSED`    | The collection was already reversed                       |
| 409  | `ASSIGNMENT_ALREADY_ACTIVE`   | The customer is already actively assigned to this agent   |
| 409  | `ASSIGNMENT_ALREADY_ENDED`    | The assignment has already ended                          |

Routes: `POST /customers/:id/payments`, `POST /collections` (both need `Idempotency-Key` and `collection.create`), `GET /collections`, `GET /collections/:id`, `GET /collections/reconciliation` (`collection.read`), `POST /collections/:id/reverse` (`collection.assign`), `GET|POST /collection-agents`, `GET|PATCH /collection-agents/:id`, `POST /collection-agents/:id/assignments`, `POST /collection-agents/:id/assignments/:assignmentId/end`, `GET /collection-agents/:id/summary`.

## Error codes added with Phase 12 (finance, expenses and daily closing)

| HTTP | code                         | Meaning                                                  |
| ---- | ---------------------------- | -------------------------------------------------------- |
| 409  | `EXPENSE_CATEGORY_EXISTS`    | An expense category with that name already exists        |
| 404  | `EXPENSE_CATEGORY_NOT_FOUND` | No such expense category in this shop                    |
| 422  | `EXPENSE_CATEGORY_INACTIVE`  | The expense category is switched off                     |
| 422  | `EXPENSE_AMOUNT_INVALID`     | Expense amount must be more than zero                    |
| 422  | `EXPENSE_DATE_INVALID`       | Expense date is not a real calendar date                 |
| 422  | `EXPENSE_DATE_IN_FUTURE`     | Expense date cannot be in the future                     |
| 422  | `EXPENSE_DATE_TOO_OLD`       | Expense date can be at most 30 days back                 |
| 404  | `EXPENSE_NOT_FOUND`          | No such expense in this shop and branch                  |
| 409  | `EXPENSE_ALREADY_CANCELLED`  | The expense was already cancelled                        |
| 422  | `CASHBOOK_AMOUNT_INVALID`    | Manual cashbook entry amount must be more than zero      |
| 422  | `BUSINESS_DATE_INVALID`      | Business date is not a real calendar date                |
| 422  | `BUSINESS_DATE_IN_FUTURE`    | Business/closing date cannot be in the future            |
| 422  | `BUSINESS_DATE_TOO_OLD`      | Manual cashbook entries can be dated at most 7 days back |
| 409  | `DAY_ALREADY_CLOSED`         | The branch cash register is already closed for that date |

## Error codes added with Phase 12 (finance, expenses and daily closing)

| HTTP | code                         | Meaning                                                  |
| ---- | ---------------------------- | -------------------------------------------------------- |
| 409  | `EXPENSE_CATEGORY_EXISTS`    | An expense category with that name already exists        |
| 404  | `EXPENSE_CATEGORY_NOT_FOUND` | No such expense category in this shop                    |
| 422  | `EXPENSE_CATEGORY_INACTIVE`  | The expense category is switched off                     |
| 422  | `EXPENSE_AMOUNT_INVALID`     | Expense amount must be more than zero                    |
| 422  | `EXPENSE_DATE_INVALID`       | Expense date is not a real calendar date                 |
| 422  | `EXPENSE_DATE_IN_FUTURE`     | Expense date cannot be in the future                     |
| 422  | `EXPENSE_DATE_TOO_OLD`       | Expense date can be at most 30 days back                 |
| 404  | `EXPENSE_NOT_FOUND`          | No such expense in this shop and branch                  |
| 409  | `EXPENSE_ALREADY_CANCELLED`  | The expense was already cancelled                        |
| 422  | `CASHBOOK_AMOUNT_INVALID`    | Manual cashbook entry amount must be more than zero      |
| 422  | `BUSINESS_DATE_INVALID`      | Business date is not a real calendar date                |
| 422  | `BUSINESS_DATE_IN_FUTURE`    | Business/closing date cannot be in the future            |
| 422  | `BUSINESS_DATE_TOO_OLD`      | Manual cashbook entries can be dated at most 7 days back |
| 409  | `DAY_ALREADY_CLOSED`         | The branch cash register is already closed for that date |

## Error codes added by the Phase 11 and 12 audit

| HTTP | code                   | Meaning                                                                                                                                                   |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 409  | `CLOSING_OUT_OF_ORDER` | A newer day is already closed; days must be closed in order                                                                                               |
| 400  | `INVALID_DATE`         | A `from` / `to` filter is not a real calendar date                                                                                                        |
| 400  | `INVALID_RANGE`        | A report period is reversed (`from` after `to`) or longer than 366 days                                                                                   |
| 409  | `DAY_ALREADY_CLOSED`   | A cash line (manual entry, expense date) names a day that is closed. Sales and collections made "now" are never refused: they go on the next business day |

## Delta sync endpoints & codes added with Phase 14

| HTTP | code                    | Meaning                                                                          |
| ---- | ----------------------- | -------------------------------------------------------------------------------- |
| 400  | `INVALID_CURSOR`        | The opaque `cursor` query parameter is malformed or invalid                      |
| 400  | `INVALID_UPDATED_SINCE` | The `updated_since` query parameter is not a valid ISO-8601 UTC/offset timestamp |

Routes: `GET /sync/products`, `GET /sync/categories`, `GET /sync/units` (need `product.read`), `GET /sync/customers` (needs `customer.read`). Responses use the cursor envelope `{ data: [...], meta: { limit, hasMore, nextCursor, serverTime } }`.

`POST /held-bills` now accepts an optional `Idempotency-Key` (UUID) header used by the mobile sync outbox; retries with the same key and body replay the stored held bill with `Idempotent-Replayed: true` and create no duplicates.

## Notifications endpoints added with Phase 15

| HTTP | code                     | Meaning                                |
| ---- | ------------------------ | -------------------------------------- |
| 404  | `NOTIFICATION_NOT_FOUND` | No such notification for this org/user |

Routes: `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all` (all `@AuthenticatedOnly()`), and `POST /notifications/check-alerts` (`@RequireBranch()`, needs `stock.read`).

## Keyset paging and capped totals (FIXES F12)

`GET /products`, `GET /sales` and `GET /inventory/movements` accept `?paging=cursor` (first page) and then `?cursor=<meta.nextCursor>`, with `pageSize` as the page length. The answer is `{ data, meta: { limit, hasMore, nextCursor, serverTime } }`: no total and no `OFFSET`, so page 2,000 costs the same as page 1. The cursor is opaque (base64url of the last row's sort value and id); a tampered one answers `400 INVALID_CURSOR`. It carries no shop id: every query is still filtered by the caller's organization and branch.

Without these parameters `page` / `pageSize` work as before. Their `meta.total` is now **capped at 10,000** (`meta.totalCapped: true` is added only when the real number is larger; otherwise the shape is unchanged), on products, sales, stock movements and stock balances, so a total never scans more than 10,001 rows. The phone uses `total` only to decide whether to load more, so nothing changed for it.

Measured on 50,000 products (Neon, `EXPLAIN ANALYZE`): page 1 0.10 ms; OFFSET 49,975 43.5 ms; keyset after row 49,975 0.10 ms; `count(*)` 12.4 ms; capped count 3.3 ms.
