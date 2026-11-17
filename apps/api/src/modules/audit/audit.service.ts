import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Db } from '../../database/db.types';

export interface AuditEntry {
  organizationId: string;
  branchId?: string | null;
  actorId?: string | null;
  action: string; // e.g. "role.create"
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
  correlationId?: string;
  ipAddress?: string;
}

/** Writes to the append-only audit_logs table, inside the caller's transaction so the audit row commits or rolls back with the change. */
@Injectable()
export class AuditService {
  async record(db: Db, e: AuditEntry): Promise<void> {
    await db.auditLog.create({
      data: {
        organizationId: e.organizationId,
        branchId: e.branchId ?? null,
        actorId: e.actorId ?? null,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId ?? null,
        beforeData: e.before,
        afterData: e.after,
        reason: e.reason,
        correlationId: e.correlationId,
        ipAddress: e.ipAddress,
      },
    });
  }
}
