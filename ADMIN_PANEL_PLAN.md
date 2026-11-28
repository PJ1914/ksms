# ADMIN_PANEL_PLAN.md — How to add ADMIN_PANEL.md to the current code

**Progress:** A, B1, B2, C (admin web app) and D (support tickets, text only) are built on the API and the admin panel, with tests. Still to do: the shop app (mobile) banners, locked screen and Help screen; screenshots on tickets (D2); renewal reminder job; push notifications.

`ADMIN_PANEL.md` is the spec: roles, flows, data model, API, phases. This file checks that spec against the code as it is today (commit `099a063`). It lists what fits, what needs changing, the exact files each phase touches, and the order of work.

---

## 1. What the code has today (and how the spec fits it)

| Area                       | Today                                                                                                                                                 | What it means for the admin panel                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global guards              | `app.module.ts`: Throttler → `AuthGuard` → `TenantGuard` → `PermissionGuard`. Each one skips `@Public()` routes. `PermissionGuard` denies by default. | Add an `IS_PLATFORM` flag in `common/auth/decorators.ts`. The three shop guards return `true` early when it is set, the same way they handle `IS_PUBLIC`. A new global `PlatformGuard` does the opposite. This works as the spec says.                                                                                                                                                                    |
| Route prefix               | `configure-app.ts:63` calls `app.setGlobalPrefix(API_PREFIX)` (`api/v1`) for **every** controller.                                                    | **Gap.** `/admin/v1/*` can't exist unless the prefix leaves those routes out. Use `setGlobalPrefix(API_PREFIX, { exclude: [{ path: 'admin/v1/*path', method: RequestMethod.ALL }] })` (Nest 11 uses path-to-regexp v8 syntax). Put `PLATFORM_PREFIX = 'admin/v1'` in `@ksms/constants`. Serve a separate Swagger document at `/admin/v1/docs`, and only outside production.                               |
| Member lookup              | `AuthGuard` starts `findMember()` at the same time as the session query, and `TenantGuard` awaits it.                                                 | Add `organization: { lockStatus, lockedAt, subscription: { endsAt, graceDays, plan: { isTrial, code } } }` to the `select` in `common/tenant/member-lookup.ts`. That is **zero extra round trips**, as the spec requires.                                                                                                                                                                                 |
| Session cache              | `common/auth/session-cache.ts` keeps session + member rows for GET/HEAD for 15 s, on each instance.                                                   | Lock/unlock state is stored with the member row, so a GET can see a lock up to 15 s late, and only on a _different_ instance. Render free runs one instance, so the lock applies on the next request. Writes always go to the DB. **Lock must call `invalidateSession()` for every revoked session (or `invalidateAll()`).** Write this down in the ADR.                                                  |
| Architecture test          | `architecture.spec.ts` has an `ALLOWED` map, and `common/` may never import `modules/`.                                                               | New entries: `subscription: ['audit']`, `support: ['audit', 'notifications']`, `platform: ['audit', 'organization', 'identity', 'notifications', 'subscription']`. Also add `subscription` to `identity` (trial on sign-up, user limit) and `organization` (branch limit). Add a new test: no module except `platform` may import `modules/platform`, and every platform controller has `@PlatformRoles`. |
| Vendor role                | Owner = `role.isSystem && role.name === 'Owner'` (`auth.service.ts:229`, `employees.service.ts:46`).                                                  | VENDOR is this Owner check. No new shop role is needed.                                                                                                                                                                                                                                                                                                                                                   |
| Permissions                | `packages/constants/src/permissions.ts` (105 lines). Owner gets all permissions.                                                                      | Add `support.create` and `support.read` there, plus a seed/migration so the Permission rows exist.                                                                                                                                                                                                                                                                                                        |
| Sign-up                    | `AuthService.registerOwner` (`auth.service.ts:46`) creates the org and Owner in one transaction.                                                      | Create the TRIAL subscription and the `TRIAL_STARTED` event **inside the same tx**, using a `SubscriptionService.startTrial(tx, orgId)` from the new `subscription` module.                                                                                                                                                                                                                               |
| Login                      | `AuthService.login` (`:128`) plus `login-lockout.service.ts` (DB-backed, FIXES F13).                                                                  | Refuse LOCKED orgs here with `ORG_LOCKED`. Copy the lockout pattern for platform admins.                                                                                                                                                                                                                                                                                                                  |
| `/auth/me`                 | `AuthService.me` (`:201`).                                                                                                                            | Add `subscription{…, serverTime}` and `supportContact`.                                                                                                                                                                                                                                                                                                                                                   |
| POST routes that only read | Only `POST sales/preview` (`sales.controller.ts:97`). Reporting is all GET.                                                                           | Mark `@ReadOnlySafe()`: `sales/preview`, `auth/logout`, `auth/refresh`, and notification mark-read. Mark `@AllowWhenExpired()`: device push-token registration. That's a short list.                                                                                                                                                                                                                      |
| Offline writes             | `apps/mobile/src/sync/sync-engine.ts` only queues **held bills**. Sales are not queued offline, and `modules/sync` only serves pull GETs.             | §2.6 of the spec is smaller than written. Only the held-bill outbox needs the `clientCreatedAt` rule. Send it as an `X-Client-Created-At` header on outbox replays, and check it in `TenantGuard` when state is EXPIRED. LOCKED kills the sessions, so queued items replay only after unlock and re-login, and are accepted only if `clientCreatedAt < lockedAt`.                                         |
| Devices / push             | `Device` has `pushToken`, `revokedAt`, `appVersion`.                                                                                                  | Revoking a device and sending push for ticket replies can reuse these. No new table is needed.                                                                                                                                                                                                                                                                                                            |
| Notifications              | `modules/notifications` (in-app).                                                                                                                     | Ticket replies and renewal reminders go through it.                                                                                                                                                                                                                                                                                                                                                       |
| Jobs                       | `src/purge.ts` is a standalone Nest context (retention).                                                                                              | Copy it for `remind.ts` (renewal reminders) and `tickets-autoclose.ts`. Add them as Render cron entries.                                                                                                                                                                                                                                                                                                  |
| Log redaction              | `logger.config.ts:34` `redact`.                                                                                                                       | Add `password`, `code`, `mfaToken`, `recoveryCode`, `totp`, `secret`.                                                                                                                                                                                                                                                                                                                                     |
| Web apps                   | Only `apps/api` and `apps/mobile`. The uncommitted `render.yaml` change adds `ksms-app` (Expo web static site).                                       | `apps/admin` is new (Vite + React). Add a `ksms-admin` static-site entry next to `ksms-app` using the same pattern, and add its URL to `CORS_ORIGINS`.                                                                                                                                                                                                                                                    |
| API client                 | `packages/api-client/src/index.ts` (81 lines).                                                                                                        | Put the platform calls in a **separate entry** (`@ksms/api-client/platform`) so admin code never ships inside the mobile bundle.                                                                                                                                                                                                                                                                          |

## 2. Problems inside ADMIN_PANEL.md (fix the spec before coding)

1. **Recovery codes:** decision 9 says 10, but §3.4 says 8. → Use **10**.
2. **Plan prices:** Phase B says to seed BASIC/PRO at ₹0, but decision 3 fixes ₹299 and ₹599. → Seed the real prices and limits (Basic 1 branch / 3 users, Pro 3 / 10). TRIAL = Pro limits for 14 days.
3. **Legacy backfill:** decision 5 needs a `LEGACY` reason, which isn't in `SubscriptionEventType`. → Use `GRANTED` with `reason = 'LEGACY'`, Pro plan, +30 days, grace 5.
4. **Uploads:** decision 8 says screenshots wait for Phase D2, but the Phase D prompt includes R2 uploads. → Move `/support/uploads`, `ticket_attachments` and `@aws-sdk/client-s3` to **D2**.
5. **Offline sales:** §2.6 describes offline sales that don't exist (see §1). → Narrow it to held bills.
6. **Closed tickets:** the spec says "reply to a closed ticket: reopen or refuse, pick one". → Pick: **RESOLVED reopens on vendor reply. CLOSED refuses with `TICKET_CLOSED`, and the vendor opens a new ticket.**
7. **Refunds:** these are negative `subscription_payments` rows. Decide whether a refund also shortens `ends_at`. → Default: **no**, the dates change only through an explicit `adjust` with a reason.

## 3. Build order (each phase gated — stop for owner approval)

### Phase A — Platform foundation

- **Docs:** `docs/decisions/ADRs/00X-platform-control-plane.md` (separate plane, cross-tenant exception to rule 5, separate JWT secret/audience, MFA, cache-lag note).
- **Schema:** `prisma/schema/platform.prisma` with `platform_admins`, `platform_admin_recovery_codes`, `platform_admin_sessions`, `platform_audit_logs`. One migration for the tables and a **separate** hand-written migration for the append-only trigger on the audit table.
- **Config:** `config/env.ts` gets `PLATFORM_JWT_SECRET` (≥48), `PLATFORM_MFA_KEY` (32-byte b64), `PLATFORM_ADMIN_ORIGINS`, optional `PLATFORM_ADMIN_IP_ALLOWLIST`. Add the same keys to `.env.example`.
- **Code:** `common/auth/decorators.ts` gets `PlatformRoute()`. The 3 shop guards skip on `IS_PLATFORM`. `configure-app.ts` gets the prefix exclude.
- **Code:** `modules/platform/auth/*` (token service, guard, TOTP via `otplib`, AES-GCM helper, login → mfaToken → verify, refresh rotation and reuse detection copied from `identity/session.service.ts`, lockout copied from `login-lockout.service.ts`), `platform/admins/*`, `platform/audit/*`.
- **CLI:** `apps/api/scripts/create-admin.ts` and the `admin:create` script.
- **Tests:** add the `architecture.spec.ts` rules, plus the Phase-A test list from the spec.
- **New deps (exact versions):** `otplib`, `qrcode`.

### Phase B1 — Subscription core and enforcement (shop side)

- **Schema:** `platform.prisma` gets `plans`, `subscriptions`, `subscription_events`, `subscription_payments`, and the `organizations.lock_*` columns. Separate migrations for: triggers, the partial unique index on payment reference, the `subscriptions(ends_at)` index, and the **backfill** (existing orgs → Pro +30 d, `GRANTED/LEGACY`).
- **Pure logic:** `common/subscription/subscription-state.ts` and `add-months.ts` (UTC, end-of-month safe), covered by unit and fast-check tests.
- **Code:** `modules/subscription` with `startTrial(tx)`, `GET /subscription`, and a `assertWithinPlanLimit(tx, org, 'branches'|'users')` helper.
- **Wiring:** `member-lookup.ts` select extension → `TenantGuard` enforcement plus `@AllowWhenLocked` / `@AllowWhenExpired` / `@ReadOnlySafe` decorators, and the `X-Subscription-State` header.
- **Wiring:** `registerOwner` creates the trial. `login` refuses ORG_LOCKED. `me` returns the subscription block.
- **Wiring:** `organization/branch.service.ts` and `identity/invitations.service.ts` + `employees.service.ts` call the limit helper (`PLAN_LIMIT_REACHED`).
- **Error codes:** add to `@ksms/constants` and `api-client`.
- **Tests:** one test per row of the §2.5 table, and a check that **all existing e2e/int tests still pass** after the backfill.

### Phase B2 — Platform shop and subscription endpoints

- **Endpoints:** `platform/shops/*` (list with keyset pagination using `common/pagination/keyset.ts`, detail, lock/unlock → revoke `user_sessions` + **invalidate SessionCache**, force-logout, device revoke, reset-owner-password).
- **Endpoints:** `platform/subscriptions/*` (extend + payment in one tx, `SELECT … FOR UPDATE` + `version`, `Idempotency-Key` via the existing `common/idempotency`, change-plan, adjust, refund), `platform/plans/*`, `platform/payments/*`.
- **Offline rule:** the held-bill outbox header and the matching check.
- **Job:** `src/remind.ts` cron job (T-7/-3/-1/0/grace end, idempotent per org+milestone).

### Phase C — Admin web app (`apps/admin`)

- **Setup:** Vite + React + TS + TanStack Query + React Router, as a workspace package. Use `@ksms/api-client/platform`, `shared-types` and `constants`.
- **Screens:** Login → MFA → forced setup/change password. Dashboard (`/admin/v1/dashboard`: one aggregate SQL, revenue ADMIN-only). Shops list/detail with all actions. Plans. Payments (CSV). Admins. Audit. Support settings placeholder.
- **Tokens:** access token in memory, refresh token in `sessionStorage`, idle logout at 30 min. Strict CSP through Render static headers. Lock/delete need the shop name typed in to confirm.
- **Deploy:** add `ksms-admin` to `render.yaml` and the origin to CORS.
- **Tests:** Playwright smoke test (fixed test TOTP secret): login → list → extend → lock → unlock.

### Phase D — Support (text only)

- **Schema:** `prisma/schema/support.prisma` with `support_tickets`, `ticket_messages` (append-only trigger), and `support_settings` (single row).
- **Shop side:** `modules/support` (org-scoped, `support.create/read`, all routes `@AllowWhenLocked`, 10 tickets/hour/org throttle, `internal_note` never returned), `GET /support/contact`, and callbacks.
- **Platform side:** `platform/support/*` (queue, thread, internal notes, assign, status, settings). `tickets-autoclose.ts` cron job.
- **Mobile:** Help screen reachable from the LOCKED blocker and EXPIRED banner (`app/help/*`). `tel:` and `wa.me` links come from `/support/contact`.
- **Admin web:** Tickets and Support-settings screens.

### Phase D2 — Screenshots (R2)

`ticket_attachments`, `/support/uploads` (presigned PUT, png/jpg/webp only, ≤5 MB, key under `org/<orgId>/tickets/`), and `@aws-sdk/client-s3`.

### Mobile work spread across phases

- **B1:** banner and full-screen blocker components in `apps/mobile/src/components`. Global error handling in `src/api/client.ts` (`ORG_LOCKED` → blocker, `SUBSCRIPTION_EXPIRED` → read-only toast). Store the `serverTime` offset in `src/auth`. Hide write actions on `(tabs)/billing.tsx` and others when EXPIRED.
- **D:** Help screens and push for replies.

### Phase E — Later

Razorpay, announcements, data export/delete, impersonation, admin alerts. Each needs its own approval.

## 4. Biggest risks

1. **Locking out live shops on deploy.** The backfill must run in the same release as enforcement. CI must test that existing orgs read as ACTIVE.
2. **Mixing up the two planes.** A missed `IS_PLATFORM` skip, or a platform route without roles, would open a hole. Default-deny and the architecture test cover this; add cross-plane token tests in both directions.
3. **Per-request cost.** Keep enforcement inside the existing member query, and check it in the query log (spec criterion: no extra round trip).
4. **Money.** Plan prices, payments and discounts use `decimal.js` and NUMERIC end to end. Discount tiers live in the `plans` row or config, never in client code.
