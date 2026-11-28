import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { PlatformRoleName } from '@ksms/constants';
import { PlatformRoute } from '../../common/auth/decorators';
import { AppException } from '../../common/errors/app.exception';
import type { PlatformPrincipal, PlatformRequest } from './platform.types';

export const PLATFORM_ROLES_KEY = 'platformRoles';
export const PLATFORM_PUBLIC = 'platformPublic';
export const PLATFORM_ALLOW_PASSWORD_CHANGE = 'platformAllowPasswordChange';
export const PLATFORM_AUTH_THROTTLED = 'platformAuthThrottled';

/** Class decorator for every platform controller, next to `@Controller('admin/v1/...')`. */
export { PlatformRoute };

/**
 * Who may call a platform route. DEFAULT DENY: a platform route without this (and not
 * @PlatformPublic) is refused by PlatformGuard and fails platform-routes.spec.ts.
 */
export const PlatformRoles = (...roles: PlatformRoleName[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);

/** No admin token needed (login and the MFA steps, which carry their own short-lived mfaToken). */
export const PlatformPublic = () =>
  applyDecorators(SetMetadata(PLATFORM_PUBLIC, true), SetMetadata(PLATFORM_AUTH_THROTTLED, true));

/** Reachable while the admin still has to replace a temporary password (me, change-password, logout). */
export const AllowPendingPasswordChange = () => SetMetadata(PLATFORM_ALLOW_PASSWORD_CHANGE, true);

/** The signed-in platform admin (set by PlatformGuard). */
export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformPrincipal => {
    const p = ctx.switchToHttp().getRequest<PlatformRequest>().platform;
    if (!p) throw new AppException('PLATFORM_UNAUTHORIZED', 'Not authenticated', 401);
    return p;
  },
);
