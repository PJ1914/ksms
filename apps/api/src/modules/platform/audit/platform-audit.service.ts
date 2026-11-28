import { Injectable } from '@nestjs/common';
import type { Db } from '../../../database/db.types';
import type { Prisma } from '../../../generated/prisma/client';
import type { PlatformRequestMeta } from '../platform.types';

export interface PlatformAuditEntry {
  adminId: string;
  action: string; // e.g. "admin.create", "shop.lock"
  organizationId?: string | null;
  entityType?: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
  meta?: PlatformRequestMeta;
}

/**
 * Writes to the append-only platform_audit_logs table, inside the caller's transaction so the audit row
 * commits or rolls back with the change. Never put passwords, codes or secrets in before/after.
 */
@Injectable()
export class PlatformAuditService {
  async record(db: Db, e: PlatformAuditEntry): Promise<void> {
    await db.platformAuditLog.create({
      data: {
        adminId: e.adminId,
        action: e.action,
        organizationId: e.organizationId ?? null,
        entityType: e.entityType ?? null,
        entityId: e.entityId ?? null,
        beforeData: e.before,
        afterData: e.after,
        reason: e.reason,
        ipAddress: e.meta?.ipAddress,
        correlationId: e.meta?.correlationId,
      },
      select: { id: true },
    });
  }
}
