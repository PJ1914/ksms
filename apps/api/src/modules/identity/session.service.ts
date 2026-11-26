import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AccessTokenService } from '../../common/auth/access-token.service';
import { SessionCache } from '../../common/auth/session-cache';
import { absoluteExpiry, slidingExpiry } from '../../common/auth/session-lifetime';
import { AppException } from '../../common/errors/app.exception';
import { ENV, type Env } from '../../config/config.module';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';

export interface ClientInfo {
  ipAddress?: string;
  userAgent?: string;
  deviceUid?: string;
  deviceName?: string;
  appVersion?: string;
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const newRefreshToken = (): string => randomBytes(32).toString('base64url');

/** Owns sessions and refresh tokens. Refresh tokens are random, stored only as SHA-256 hashes, and rotated on every use. */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AccessTokenService,
    @Inject(ENV) private readonly env: Env,
    private readonly cache: SessionCache,
  ) {}

  /** Sliding expiry for a session started at `createdAt` (a new session: now). */
  private expiry(createdAt = new Date()): Date {
    return slidingExpiry(createdAt, this.env.REFRESH_TTL_DAYS, this.env.SESSION_ABSOLUTE_TTL_DAYS);
  }

  async create(db: Db, userId: string, organizationId: string, client: ClientInfo) {
    let deviceId: string | null = null;
    if (client.deviceUid) {
      deviceId = await this.claimDevice(db, userId, organizationId, client.deviceUid, client);
    }
    const refreshToken = newRefreshToken();
    const session = await db.userSession.create({
      data: {
        userId,
        organizationId,
        deviceId,
        refreshTokenHash: sha256(refreshToken),
        expiresAt: this.expiry(),
        ipAddress: client.ipAddress,
        userAgent: client.userAgent?.slice(0, 300),
        lastUsedAt: new Date(),
      },
      select: { id: true },
    });
    return { sessionId: session.id, refreshToken };
  }

  /**
   * Finds or registers the phone for this user. Login never un-revokes a device and never moves a device
   * to another user: a blocked phone is refused (`DEVICE_REVOKED`) and a phone registered to someone else
   * is refused (`DEVICE_OWNED_BY_OTHER`) until the owner releases it. See TD-135.
   */
  private async claimDevice(
    db: Db,
    userId: string,
    organizationId: string,
    deviceUid: string,
    client: ClientInfo,
  ): Promise<string> {
    // `update: {}` only claims the row (safe for two first logins at once); fields are set below once allowed.
    const device = await db.device.upsert({
      where: { organizationId_deviceUid: { organizationId, deviceUid } },
      create: {
        organizationId,
        userId,
        deviceUid,
        name: client.deviceName,
        appVersion: client.appVersion,
        lastSeenAt: new Date(),
      },
      update: {},
      select: { id: true, userId: true, revokedAt: true },
    });
    if (device.revokedAt !== null) {
      throw new AppException(
        'DEVICE_REVOKED',
        'This device has been blocked. Ask the owner to re-enable it.',
        403,
      );
    }
    if (device.userId !== userId) {
      throw new AppException(
        'DEVICE_OWNED_BY_OTHER',
        'This phone is registered to another user. Ask the owner to release it.',
        403,
      );
    }
    await db.device.update({
      where: { id: device.id },
      data: { name: client.deviceName, appVersion: client.appVersion, lastSeenAt: new Date() },
      select: { id: true },
    });
    return device.id;
  }

  async signAccessToken(
    userId: string,
    sessionId: string,
    organizationId: string,
    tokenVersion: number,
  ) {
    const accessToken = await this.tokens.sign({
      sub: userId,
      sid: sessionId,
      org: organizationId,
      v: tokenVersion,
    });
    return { accessToken, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS };
  }

  /**
   * Exchanges a refresh token for a new pair. A token that was already rotated is a sign of theft or
   * a replayed request: the whole session is revoked and the caller must log in again.
   */
  async rotate(presented: string) {
    const hashValue = sha256(presented);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hashValue },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        revokedAt: true,
        expiresAt: true,
        createdAt: true,
        user: { select: { isActive: true, tokenVersion: true } },
      },
    });

    if (!session) {
      const reused = await this.prisma.userSession.findFirst({
        where: { previousTokenHash: hashValue, revokedAt: null },
        select: { id: true },
      });
      if (reused) await this.revoke(reused.id, 'refresh_token_reuse');
      throw new AppException('UNAUTHORIZED', 'Invalid refresh token', 401);
    }
    if (session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) {
      throw new AppException('UNAUTHORIZED', 'Session is no longer valid', 401);
    }
    // Absolute lifetime: a token that keeps being refreshed (e.g. a stolen one) still dies.
    if (
      absoluteExpiry(session.createdAt, this.env.SESSION_ABSOLUTE_TTL_DAYS).getTime() <= Date.now()
    ) {
      await this.revoke(session.id, 'absolute_expiry');
      throw new AppException('UNAUTHORIZED', 'Session is no longer valid', 401);
    }

    const refreshToken = newRefreshToken();
    // Conditional update: only one concurrent request can rotate a given token.
    const rotated = await this.prisma.userSession.updateMany({
      where: { id: session.id, refreshTokenHash: hashValue, revokedAt: null },
      data: {
        refreshTokenHash: sha256(refreshToken),
        previousTokenHash: hashValue,
        expiresAt: this.expiry(session.createdAt),
        lastUsedAt: new Date(),
      },
    });
    if (rotated.count !== 1) throw new AppException('UNAUTHORIZED', 'Invalid refresh token', 401);

    return {
      sessionId: session.id,
      userId: session.userId,
      organizationId: session.organizationId,
      tokenVersion: session.user.tokenVersion,
      refreshToken,
    };
  }

  async revoke(sessionId: string, reason: string, db: Db = this.prisma): Promise<void> {
    this.cache.invalidateSession(sessionId);
    await db.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Revokes every live session on one device. */
  async revokeAllForDevice(db: Db, deviceId: string, reason: string): Promise<number> {
    this.cache.invalidateAll();
    const res = await db.userSession.updateMany({
      where: { deviceId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.count;
  }

  /** Revokes every live session of a user, optionally only within one organization. */
  async revokeAllForUser(
    db: Db,
    userId: string,
    reason: string,
    organizationId?: string,
  ): Promise<number> {
    this.cache.invalidateUser(userId);
    const res = await db.userSession.updateMany({
      where: { userId, revokedAt: null, ...(organizationId ? { organizationId } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.count;
  }
}
