import type { PermissionKey } from '@ksms/constants';
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import type { AppRequest, Principal, TenantContext } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const REQUIRE_BRANCH = 'requireBranch';

/** Skip authentication for a route (login, health, docs). Everything else is protected by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Marks a controller as part of the PLATFORM plane (/admin/v1, ADR-001). The shop guards (Auth, Tenant,
 * Permission) skip it entirely and the platform guard takes over; the platform guard skips everything else.
 * A shop token can therefore never reach a platform route, and a platform token never a shop route.
 */
export const IS_PLATFORM = 'isPlatform';
export const PlatformRoute = () => SetMetadata(IS_PLATFORM, true);

/*
 * Subscription enforcement (ADMIN_PANEL.md §2.5), read by TenantGuard:
 *   EXPIRED shops may read but not write; LOCKED shops may do neither, except on the routes below.
 */
export const ALLOW_WHEN_LOCKED = 'allowWhenLocked';
export const ALLOW_WHEN_EXPIRED = 'allowWhenExpired';
export const READ_ONLY_SAFE = 'readOnlySafe';

/** Still reachable when the shop is LOCKED (and EXPIRED): who-am-I, logout, own subscription, support. */
export const AllowWhenLocked = () => SetMetadata(ALLOW_WHEN_LOCKED, true);

/** A write that stays allowed when the subscription has EXPIRED (e.g. marking notifications read). */
export const AllowWhenExpired = () => SetMetadata(ALLOW_WHEN_EXPIRED, true);

/** A POST that only reads (e.g. a price preview); treated like a GET for EXPIRED shops. */
export const ReadOnlySafe = () => SetMetadata(READ_ONLY_SAFE, true);

/** The route needs an `X-Branch-Id` header the user is assigned to (branch-scoped operations). */
export const RequireBranch = () => SetMetadata(REQUIRE_BRANCH, true);

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal => {
    const p = ctx.switchToHttp().getRequest<AppRequest>().principal;
    if (!p) throw new AppException('UNAUTHORIZED', 'Not authenticated', 401);
    return p;
  },
);

/** Tenant scope for repositories: always pass this down; never read ids from the request body. */
export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const t = ctx.switchToHttp().getRequest<AppRequest>().tenant;
  if (!t) throw new AppException('FORBIDDEN', 'Tenant context missing', 403);
  return t;
});

export const REQUIRE_PERMISSION = 'requirePermission';
export const AUTHENTICATED_ONLY = 'authenticatedOnly';
export const AUTH_THROTTLED = 'authThrottled';

/**
 * Route needs ALL listed permissions (see PERMISSIONS in @ksms/constants).
 * Authenticated routes with no policy are DENIED by default, so a forgotten decorator fails closed.
 */
export const RequirePermission = (...keys: PermissionKey[]) =>
  SetMetadata(REQUIRE_PERMISSION, keys);

/** Any logged-in member may call this route (e.g. "who am I", logout). Use sparingly. */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY, true);

/** Apply the stricter per-IP limit used for credential endpoints (login, register, refresh). */
export const AuthThrottled = () => SetMetadata(AUTH_THROTTLED, true);
