# ADR-001 — Platform control plane (admin panel)

- Status: Accepted (Phase A of `ADMIN_PANEL.md`, 2026-11-29)
- Deciders: product owner

## Context

Yapaaram is multi-tenant: every shop query is scoped by `organization_id` from the caller's token (AGENTS rule 5). The product owner and support staff need to see and manage **all** shops: subscriptions, locking, tickets. That is cross-tenant by nature. If it were built from shop roles or a "super-owner" flag, one bug in a tenant filter would leak every shop's data.

## Decision

1. **A separate plane.** Platform users (`ADMIN`, `SUPPORT`) live in their own table (`platform_admins`), not in `users`. Their API lives at `/admin/v1/*`, outside the shop prefix `/api/v1` (`setGlobalPrefix` exclude in `configure-app.ts`).
2. **Exception to AGENTS rule 5, contained.** Only `apps/api/src/modules/platform` may query across organizations. No other module may import it (`architecture.spec.ts`), and platform code may not use the shop decorators (`@Tenant`, `@RequirePermission`, `@AuthenticatedOnly`, `@Public`).
3. **Separate guards, mutually exclusive.** Platform controllers carry `@PlatformRoute()`. The shop guards (`AuthGuard`, `TenantGuard`, `PermissionGuard`) return early on it. The global `PlatformGuard` returns early on everything else. Guard order is Throttler → Platform → Auth → Tenant → Permission.
4. **Separate tokens.** Admin tokens use their own secret `PLATFORM_JWT_SECRET` (≥ 48 chars, must differ from `JWT_ACCESS_SECRET`), issuer `ksms-admin` and audience `ksms-admin-app`. The MFA step uses a 5-minute token with a separate audience, `ksms-admin-mfa`. A shop token is never valid on `/admin/v1`, and an admin token is never valid on `/api/v1`. Tests cover both directions.
5. **Default deny.** Every platform handler must declare `@PlatformRoles(...)` or `@PlatformPublic()`. `PlatformGuard` refuses one that doesn't, and `platform-routes.spec.ts` fails the build. The role comes from the database on every request, not from the token, so a demotion applies to the next request.
6. **Mandatory MFA.** Sign-in is password → `mfaToken` → 6-digit TOTP (RFC 6238, Google Authenticator or any TOTP app). There is no way to get a session without enrolling.
   - TOTP is implemented on `node:crypto`, not a dependency, and checked against the RFC 6238 test vectors.
   - Codes are accepted within ±1 step. A step can be used only once: the guard claims it with a conditional update on `mfa_last_step`.
   - The secret is stored with AES-256-GCM using `PLATFORM_MFA_KEY`.
   - Each admin gets 10 single-use recovery codes, stored as SHA-256 hashes.
   - Wrong passwords and wrong codes share one DB-backed counter: from the 5th failure in 24 h, each failure locks the account for 15 minutes.
   - The `mfaToken` carries a fingerprint of the password hash, so a password reset kills any outstanding `mfaToken`.
7. **Short sessions.** Sessions last 12 h at most and end after 30 minutes without a refresh. Refresh tokens rotate on every use, and reusing an old one revokes the session, the same scheme as shop sessions. The guard checks the session and admin rows on every request (no cache; admin traffic is small).
8. **Always one ADMIN.** The last active ADMIN cannot be disabled or demoted, and nobody can change their own account. Every change locks all admin rows in id order, so concurrent changes queue instead of racing or deadlocking.
9. **Audit.** Every platform mutation writes `platform_audit_logs`, which is append-only by trigger, in the same transaction, with reason, IP and correlation id. SUPPORT can read only their own entries.
10. **Bootstrap only from the CLI.** `pnpm --filter @ksms/api admin:create -- --email … --name …` (`src/create-admin.ts`). There is no public admin sign-up and no admin is ever seeded by a migration.
11. **Configuration.** `PLATFORM_JWT_SECRET` and `PLATFORM_MFA_KEY` are optional everywhere, but BOTH are needed to turn the admin panel on. Without them `/admin/v1` answers `503 PLATFORM_DISABLED` and a warning is logged at start-up, while the shop API runs normally. (They were first required in production; that made a missing admin secret fail the whole API deploy, so it was relaxed.) Optional: `PLATFORM_ADMIN_ORIGINS` (added to CORS), `PLATFORM_ADMIN_IP_ALLOWLIST`, `PLATFORM_AUTH_THROTTLE_LIMIT` (default 5 per minute per IP and per email).

## Consequences

- Shop data is reachable only through code in `modules/platform`. Later phases (shops, subscriptions, tickets) add services there and are reviewed against this ADR.
- Two token families and two Swagger documents: `/api/docs` for the shop API and `/admin/v1/docs` for the admin API.
- Later phases add shop-side enforcement (lock/expiry) inside the existing member query (no extra round trip). Lock must invalidate `SessionCache` for the revoked sessions; another instance may serve reads from its own cache for up to 15 s (TD-138).
- **Deploy:** set both secrets on the API service on Render to turn the admin panel on. Until then the API starts and the admin panel API answers 503.
