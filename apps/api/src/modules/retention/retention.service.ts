import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** Rows deleted per statement: small enough that each DELETE holds its locks for milliseconds. */
export const PURGE_BATCH_SIZE = 1000;

export interface RetentionPolicy {
  /** Idempotency keys are kept this long after they expire. */
  idempotencyGraceDays: number;
  /** Revoked or expired refresh sessions are kept this long (reuse detection, support). */
  sessionDays: number;
  /** Notifications the user has read are kept this long. */
  readNotificationDays: number;
  /** Finished (DONE / FAILED / CONFLICT) sync operations are kept this long. */
  syncOperationDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  idempotencyGraceDays: 1,
  sessionDays: 30,
  readNotificationDays: 90,
  syncOperationDays: 90,
};

export type PurgeCounts = Record<
  'idempotencyRecords' | 'userSessions' | 'notifications' | 'syncOperations',
  number
>;

/**
 * Deletes short-lived operational rows that would otherwise grow forever (FIXES F4).
 *
 * Only these four tables are touched. Append-only history (audit logs, ledgers, cashbook, stock
 * movements) is never deleted here, and the database triggers would refuse it anyway.
 * Runs from the standalone `dist/purge.js` entry point on a schedule, never inside the web server.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async purge(policy: RetentionPolicy = DEFAULT_RETENTION): Promise<PurgeCounts> {
    const counts: PurgeCounts = {
      idempotencyRecords: await this.inBatches(
        'idempotency_records',
        Prisma.sql`expires_at < now() - make_interval(days => ${policy.idempotencyGraceDays})`,
      ),
      userSessions: await this.inBatches(
        'user_sessions',
        Prisma.sql`(revoked_at < now() - make_interval(days => ${policy.sessionDays})
                 OR expires_at < now() - make_interval(days => ${policy.sessionDays}))`,
      ),
      notifications: await this.inBatches(
        'notifications',
        Prisma.sql`read_at < now() - make_interval(days => ${policy.readNotificationDays})`,
      ),
      syncOperations: await this.inBatches(
        'sync_operations',
        Prisma.sql`status IN ('DONE', 'FAILED', 'CONFLICT')
                 AND server_received_at < now() - make_interval(days => ${policy.syncOperationDays})`,
      ),
    };
    this.logger.log({ msg: 'retention purge finished', ...counts });
    return counts;
  }

  /** Deletes matching rows PURGE_BATCH_SIZE at a time until none are left. */
  private async inBatches(
    table: 'idempotency_records' | 'user_sessions' | 'notifications' | 'sync_operations',
    where: Prisma.Sql,
  ): Promise<number> {
    const name = Prisma.raw(`"${table}"`);
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM ${name} WHERE id IN (
          SELECT id FROM ${name} WHERE ${where} LIMIT ${PURGE_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )`;
      total += deleted;
      if (deleted < PURGE_BATCH_SIZE) return total;
    }
  }
}
