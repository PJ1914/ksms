import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import type { AppRequest, Principal, TenantContext } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const REQUIRE_BRANCH = 'requireBranch';

/** Skip authentication for a route (login, health, docs). Everything else is protected by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

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
