import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../errors/app.exception';
import { AccessTokenService } from './access-token.service';
import type { AppRequest } from './auth.types';
import { IS_PUBLIC } from './decorators';

/**
 * Global guard #1: authenticates the caller.
 * Checks the token AND that the session is still valid in the database, so logout,
 * session revocation and account deactivation take effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer (.+)$/.exec(header) : null;
    if (!match?.[1]) throw new AppException('UNAUTHORIZED', 'Missing access token', 401);

    const claims = await this.tokens.verify(match[1]);

    const session = await this.prisma.userSession.findUnique({
      where: { id: claims.sid },
      select: {
        userId: true,
        organizationId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { isActive: true, tokenVersion: true } },
      },
    });

    const valid =
      session !== null &&
      session.revokedAt === null &&
      session.expiresAt.getTime() > Date.now() &&
      session.userId === claims.sub &&
      session.organizationId === claims.org &&
      session.user.isActive &&
      session.user.tokenVersion === claims.v;
    if (!valid) throw new AppException('UNAUTHORIZED', 'Session is no longer valid', 401);

    req.principal = { userId: claims.sub, sessionId: claims.sid, organizationId: claims.org };
    return true;
  }
}
