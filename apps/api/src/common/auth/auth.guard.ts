import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENV, type Env } from '../../config/config.module';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../errors/app.exception';
import { findMember, type MemberLookup } from '../tenant/member-lookup';
import { AccessTokenService } from './access-token.service';
import type { AppRequest } from './auth.types';
import { IS_PLATFORM, IS_PUBLIC } from './decorators';
import { type CachedSession, SessionCache } from './session-cache';
import { absoluteExpiry } from './session-lifetime';

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
    @Inject(ENV) private readonly env: Env,
    private readonly cache: SessionCache,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    // Platform routes are authenticated by PlatformGuard with its own tokens (ADR-001).
    if (this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer (.+)$/.exec(header) : null;
    if (!match?.[1]) throw new AppException('UNAUTHORIZED', 'Missing access token', 401);

    const claims = await this.tokens.verify(match[1]);

    // Reads may use the short-lived cache; writes always check the database (see SessionCache).
    const cacheable = req.method === 'GET' || req.method === 'HEAD';
    const cached = cacheable ? this.cache.get(claims.sid) : undefined;

    let session: CachedSession | null;
    let memberLookup: MemberLookup;
    if (cached) {
      session = cached.session;
      memberLookup = Promise.resolve(cached.member);
    } else {
      // Membership is needed by the next guard; start it now so both queries run at the same time.
      memberLookup = findMember(this.prisma, claims.org, claims.sub);
      memberLookup.catch(() => undefined); // errors surface where it is awaited (or are moot if auth fails)
      session = await this.prisma.userSession.findUnique({
        where: { id: claims.sid },
        select: {
          userId: true,
          organizationId: true,
          revokedAt: true,
          expiresAt: true,
          createdAt: true,
          user: { select: { isActive: true, tokenVersion: true } },
        },
      });
    }

    // Every check runs on every request, cached or not.
    const now = Date.now();
    const valid =
      session !== null &&
      session.revokedAt === null &&
      session.expiresAt.getTime() > now &&
      absoluteExpiry(session.createdAt, this.env.SESSION_ABSOLUTE_TTL_DAYS).getTime() > now &&
      session.userId === claims.sub &&
      session.organizationId === claims.org &&
      session.user.isActive &&
      session.user.tokenVersion === claims.v;
    if (!valid) throw new AppException('UNAUTHORIZED', 'Session is no longer valid', 401);

    if (!cached) {
      // Cache only positive results: a valid session AND an active membership.
      const validSession = session!;
      memberLookup
        .then((member) => {
          if (member?.status === 'ACTIVE') {
            this.cache.set(claims.sid, { session: validSession, member });
          }
        })
        .catch(() => undefined);
    }

    req.memberLookup = memberLookup;
    req.principal = { userId: claims.sub, sessionId: claims.sid, organizationId: claims.org };
    return true;
  }
}
