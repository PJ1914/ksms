import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Temporary lockout after repeated wrong passwords (FIXES F13), stored on the user row so every API
 * instance sees the same state. Lockouts are never permanent (an attacker must not be able to lock a
 * shop out for good): 5 failures lock for 1 minute, 10 for 15 minutes, 20 or more for 1 hour each.
 * Failures older than 24 hours are forgotten. A successful login resets everything.
 *
 * While locked, login answers exactly like a wrong password (same status, body and timing), so a
 * client cannot tell whether an account exists or is locked.
 */
export const LOCKOUT_STEPS = [
  { failures: 20, lockMinutes: 60 },
  { failures: 10, lockMinutes: 15 },
  { failures: 5, lockMinutes: 1 },
] as const;
const FORGET_AFTER_HOURS = 24;

@Injectable()
export class LoginLockoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  isLocked(user: { lockedUntil: Date | null }, now = new Date()): boolean {
    return user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();
  }

  /** Counts one failure atomically; locks (and audits) when a threshold is reached. */
  async recordFailure(userId: string, meta: { ipAddress?: string; correlationId?: string }) {
    const [row] = await this.prisma.$queryRaw<{ failures: number; locked_until: Date | null }[]>`
      UPDATE users SET
        failed_login_count = CASE
          WHEN last_failed_login_at IS NULL
            OR last_failed_login_at < now() - make_interval(hours => ${FORGET_AFTER_HOURS})
          THEN 1 ELSE failed_login_count + 1 END,
        last_failed_login_at = now()
      WHERE id = ${userId}::uuid
      RETURNING failed_login_count AS failures, locked_until`;
    if (!row) return;
    const step = LOCKOUT_STEPS.find((s) => row.failures >= s.failures);
    if (!step) return;
    const lockedUntil = new Date(Date.now() + step.lockMinutes * 60_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { lockedUntil } });
      // Audit once per threshold crossed (not on every failure while at 20+ beyond the first).
      if (LOCKOUT_STEPS.some((s) => s.failures === row.failures) || row.failures % 10 === 0) {
        const orgs = await tx.organizationMember.findMany({
          where: { userId },
          select: { organizationId: true },
        });
        for (const { organizationId } of orgs) {
          await this.audit.record(tx, {
            organizationId,
            actorId: null,
            action: 'user.login_locked',
            entityType: 'user',
            entityId: userId,
            after: { failures: row.failures, lockedUntil: lockedUntil.toISOString() },
            ipAddress: meta.ipAddress,
            correlationId: meta.correlationId,
          });
        }
      }
    });
  }

  /** After a successful login. Cheap no-op when there is nothing to reset. */
  async recordSuccess(user: { id: string; failedLoginCount: number; lockedUntil: Date | null }) {
    if (user.failedLoginCount === 0 && user.lockedUntil === null) return;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
    });
  }
}
