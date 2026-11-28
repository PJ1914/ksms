import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import type { PlatformRequestMeta } from '../platform.types';

/**
 * Admin lockout, stored on the admin row so every API instance (and a restart) sees it.
 * Wrong passwords AND wrong authenticator/recovery codes count together: from the 5th failure within
 * 24 hours, every further failure locks the account for 15 minutes. A full sign-in resets the count.
 */
export const PLATFORM_LOCK_AFTER_FAILURES = 5;
export const PLATFORM_LOCK_MINUTES = 15;
const FORGET_AFTER_HOURS = 24;

@Injectable()
export class PlatformLockoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  isLocked(admin: { lockedUntil: Date | null }, now = Date.now()): boolean {
    return admin.lockedUntil !== null && admin.lockedUntil.getTime() > now;
  }

  async recordFailure(adminId: string, kind: 'password' | 'mfa', meta: PlatformRequestMeta) {
    const [row] = await this.prisma.$queryRaw<{ failures: number }[]>`
      UPDATE platform_admins SET
        failed_login_count = CASE
          WHEN last_failed_login_at IS NULL
            OR last_failed_login_at < now() - make_interval(hours => ${FORGET_AFTER_HOURS})
          THEN 1 ELSE failed_login_count + 1 END,
        last_failed_login_at = now()
      WHERE id = ${adminId}::uuid
      RETURNING failed_login_count AS failures`;
    if (!row || row.failures < PLATFORM_LOCK_AFTER_FAILURES) return;
    const lockedUntil = new Date(Date.now() + PLATFORM_LOCK_MINUTES * 60_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.platformAdmin.update({
        where: { id: adminId },
        data: { lockedUntil },
        select: { id: true },
      });
      await this.audit.record(tx, {
        adminId,
        action: 'auth.locked',
        entityType: 'platform_admin',
        entityId: adminId,
        after: { failures: row.failures, kind, lockedUntil: lockedUntil.toISOString() },
        meta,
      });
    });
  }

  async reset(adminId: string): Promise<void> {
    await this.prisma.platformAdmin.updateMany({
      where: { id: adminId, OR: [{ failedLoginCount: { gt: 0 } }, { lockedUntil: { not: null } }] },
      data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
    });
  }
}
