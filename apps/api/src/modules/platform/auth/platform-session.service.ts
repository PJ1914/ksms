import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
import type { Db } from '../../../database/db.types';
import { PrismaService } from '../../../database/prisma.service';
import type { PlatformRequestMeta } from '../platform.types';

/** Admin sessions are short: 12 h from sign-in whatever happens, and 30 min without a refresh ends them. */
export const PLATFORM_SESSION_ABSOLUTE_HOURS = 12;
export const PLATFORM_SESSION_IDLE_MINUTES = 30;

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const newRefreshToken = (): string => randomBytes(32).toString('base64url');

/**
 * Platform admin sessions, the same scheme as shop sessions (identity/session.service.ts): random refresh
 * tokens stored only as SHA-256, rotated on every use, and reuse of an old token revokes the session.
 */
@Injectable()
export class PlatformSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(db: Db, adminId: string, meta: PlatformRequestMeta) {
    const refreshToken = newRefreshToken();
    const now = Date.now();
    const session = await db.platformAdminSession.create({
      data: {
        adminId,
        refreshTokenHash: sha256(refreshToken),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent?.slice(0, 300),
        lastUsedAt: new Date(now),
        expiresAt: new Date(now + PLATFORM_SESSION_ABSOLUTE_HOURS * 3_600_000),
      },
      select: { id: true },
    });
    return { sessionId: session.id, refreshToken };
  }

  async rotate(presented: string) {
    const hashValue = sha256(presented);
    const session = await this.prisma.platformAdminSession.findUnique({
      where: { refreshTokenHash: hashValue },
      select: {
        id: true,
        adminId: true,
        revokedAt: true,
        expiresAt: true,
        lastUsedAt: true,
        admin: { select: { isActive: true, role: true, mfaEnabledAt: true } },
      },
    });
    if (!session) {
      const reused = await this.prisma.platformAdminSession.findFirst({
        where: { previousTokenHash: hashValue, revokedAt: null },
        select: { id: true },
      });
      if (reused) await this.revoke(this.prisma, reused.id, 'refresh_token_reuse');
      throw new AppException('PLATFORM_UNAUTHORIZED', 'Invalid refresh token', 401);
    }
    const now = Date.now();
    if (
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now ||
      !session.admin.isActive ||
      session.admin.mfaEnabledAt === null
    ) {
      throw new AppException('PLATFORM_UNAUTHORIZED', 'Admin session is no longer valid', 401);
    }
    if (session.lastUsedAt.getTime() + PLATFORM_SESSION_IDLE_MINUTES * 60_000 <= now) {
      await this.revoke(this.prisma, session.id, 'idle_timeout');
      throw new AppException('PLATFORM_UNAUTHORIZED', 'Signed out after 30 minutes idle', 401);
    }

    const refreshToken = newRefreshToken();
    // Conditional update: only one of two concurrent refreshes with the same token wins.
    const rotated = await this.prisma.platformAdminSession.updateMany({
      where: { id: session.id, refreshTokenHash: hashValue, revokedAt: null },
      data: {
        refreshTokenHash: sha256(refreshToken),
        previousTokenHash: hashValue,
        lastUsedAt: new Date(now),
      },
    });
    if (rotated.count !== 1) {
      throw new AppException('PLATFORM_UNAUTHORIZED', 'Invalid refresh token', 401);
    }
    return {
      sessionId: session.id,
      adminId: session.adminId,
      role: session.admin.role,
      refreshToken,
    };
  }

  async revoke(db: Db, sessionId: string, reason: string): Promise<void> {
    await db.platformAdminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Every live session of one admin, optionally keeping one (the caller's own). */
  async revokeAllForAdmin(db: Db, adminId: string, reason: string, keepSessionId?: string) {
    const res = await db.platformAdminSession.updateMany({
      where: {
        adminId,
        revokedAt: null,
        ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.count;
  }
}
