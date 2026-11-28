import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRoleName } from '@ksms/constants';
import { IS_PLATFORM } from '../../../common/auth/decorators';
import { AppException } from '../../../common/errors/app.exception';
import { ENV, type Env } from '../../../config/config.module';
import { PrismaService } from '../../../database/prisma.service';
import {
  PLATFORM_ALLOW_PASSWORD_CHANGE,
  PLATFORM_PUBLIC,
  PLATFORM_ROLES_KEY,
} from '../platform.decorators';
import type { PlatformRequest } from '../platform.types';
import { PlatformKeys } from './platform-keys';
import { PlatformTokenService } from './platform-token.service';

/**
 * Global guard for the PLATFORM plane (ADR-001). It runs on every request but only acts on
 * @PlatformRoute() controllers; the shop guards do the opposite. On a platform route it:
 *  1. refuses clients outside PLATFORM_ADMIN_IP_ALLOWLIST (when set),
 *  2. verifies the admin token AND the session row AND the admin row (active, MFA enrolled) in the DB,
 *     so logout, disable and role changes take effect on the next request,
 *  3. enforces @PlatformRoles with DEFAULT DENY, using the role stored in the DB (not the token).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  private readonly logger = new Logger(PlatformGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: PlatformTokenService,
    private readonly keys: PlatformKeys,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (!this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets)) return true;

    const req = ctx.switchToHttp().getRequest<PlatformRequest>();
    const allow = this.env.PLATFORM_ADMIN_IP_ALLOWLIST;
    if (allow.length > 0 && !allow.includes(req.ip ?? '')) {
      throw new AppException('FORBIDDEN', 'This action is not available', 403);
    }
    if (!this.keys.enabled) {
      throw new AppException(
        'PLATFORM_DISABLED',
        'The admin panel is not configured on this server',
        503,
      );
    }
    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_PUBLIC, targets)) return true;

    const roles = this.reflector.getAllAndOverride<PlatformRoleName[] | undefined>(
      PLATFORM_ROLES_KEY,
      targets,
    );
    if (!roles || roles.length === 0) {
      this.logger.warn(
        `Platform route ${ctx.getClass().name}.${ctx.getHandler().name} has no @PlatformRoles; denied`,
      );
      throw new AppException('FORBIDDEN', 'This action is not available', 403);
    }

    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer (.+)$/.exec(header) : null;
    if (!match?.[1]) throw new AppException('PLATFORM_UNAUTHORIZED', 'Missing admin token', 401);
    const claims = await this.tokens.verifyAccess(match[1]);

    const session = await this.prisma.platformAdminSession.findUnique({
      where: { id: claims.sid },
      select: {
        adminId: true,
        revokedAt: true,
        expiresAt: true,
        admin: {
          select: { isActive: true, role: true, mustChangePassword: true, mfaEnabledAt: true },
        },
      },
    });
    const valid =
      session !== null &&
      session.adminId === claims.sub &&
      session.revokedAt === null &&
      session.expiresAt.getTime() > Date.now() &&
      session.admin.isActive &&
      session.admin.mfaEnabledAt !== null;
    if (!valid)
      throw new AppException('PLATFORM_UNAUTHORIZED', 'Admin session is no longer valid', 401);

    if (
      session.admin.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(PLATFORM_ALLOW_PASSWORD_CHANGE, targets)
    ) {
      throw new AppException(
        'PASSWORD_CHANGE_REQUIRED',
        'Change your temporary password before continuing',
        403,
      );
    }
    if (!roles.includes(session.admin.role)) {
      throw new AppException('FORBIDDEN', 'You do not have permission to do this', 403);
    }

    req.platform = { adminId: claims.sub, sessionId: claims.sid, role: session.admin.role };
    return true;
  }
}
