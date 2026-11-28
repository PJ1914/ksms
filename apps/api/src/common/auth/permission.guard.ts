import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@ksms/constants';
import { AppException } from '../errors/app.exception';
import type { AppRequest } from './auth.types';
import { AUTHENTICATED_ONLY, IS_PLATFORM, IS_PUBLIC, REQUIRE_PERMISSION } from './decorators';
import { RolePermissionService } from './role-permission.service';

/**
 * Global guard #3 (after AuthGuard and TenantGuard): role-based access control.
 * DEFAULT DENY: a protected route must declare @RequirePermission(...) or @AuthenticatedOnly().
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly roles: RolePermissionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets)) return true; // PlatformGuard decides
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY, targets)) return true;

    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      REQUIRE_PERMISSION,
      targets,
    );
    if (!required || required.length === 0) {
      this.logger.warn(
        `Route ${ctx.getClass().name}.${ctx.getHandler().name} has no permission policy; denied`,
      );
      throw new AppException('FORBIDDEN', 'This action is not available', 403);
    }

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const tenant = req.tenant;
    if (!tenant) throw new AppException('FORBIDDEN', 'Tenant context missing', 403);

    // Writes always use the role as it is in the database now (FIXES F16); the fresh value also
    // refreshes the cache, so permission checks later in the same request see it too.
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    const perms = await this.roles.get(tenant.roleId, { fresh: write });
    if (!perms.isOwner && !required.every((k) => perms.keys.has(k))) {
      throw new AppException('FORBIDDEN', 'You do not have permission to do this', 403, {
        required,
      });
    }
    return true;
  }
}
