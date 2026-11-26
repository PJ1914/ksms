import { Injectable } from '@nestjs/common';
import type { Principal, TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { UpdateDeviceDto } from './auth.dto';
import { SessionService } from './session.service';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const DEVICE_SELECT = {
  id: true,
  deviceUid: true,
  name: true,
  platform: true,
  appVersion: true,
  lastSeenAt: true,
  revokedAt: true,
  createdAt: true,
  user: { select: { id: true, fullName: true } },
} as const;

/** A released phone keeps its history under a retired uid, so the real uid is free for a new owner. */
const RELEASED_PREFIX = 'released:';

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  /** Updates the device attached to the caller's own session (users can never touch other devices). */
  async updateCurrent(principal: Principal, dto: UpdateDeviceDto) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: principal.sessionId },
      select: { deviceId: true },
    });
    if (!session?.deviceId)
      throw new AppException('NOT_FOUND', 'This session has no registered device', 404);
    return this.prisma.device.update({
      where: { id: session.deviceId },
      data: {
        pushToken: dto.pushToken,
        name: dto.name,
        appVersion: dto.appVersion,
        lastSeenAt: new Date(),
      },
      select: {
        id: true,
        deviceUid: true,
        name: true,
        platform: true,
        appVersion: true,
        lastSeenAt: true,
      },
    });
  }

  /** Phones registered to this shop (released ones are hidden). */
  async list(organizationId: string) {
    return this.prisma.device.findMany({
      where: { organizationId, NOT: { deviceUid: { startsWith: RELEASED_PREFIX } } },
      select: DEVICE_SELECT,
      orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
    });
  }

  /** Blocks a phone: it can no longer sign in, and every session on it ends now. */
  async revoke(t: TenantContext, id: string, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.find(tx, t.organizationId, id);
      if (before.revokedAt) return before;
      await tx.device.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.sessions.revokeAllForDevice(tx, id, 'device_revoked');
      return this.audited(tx, t, id, 'device.revoke', before, meta);
    });
  }

  /** The only way a blocked phone can sign in again. */
  async restore(t: TenantContext, id: string, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.find(tx, t.organizationId, id);
      if (!before.revokedAt) return before;
      await tx.device.update({ where: { id }, data: { revokedAt: null } });
      return this.audited(tx, t, id, 'device.restore', before, meta);
    });
  }

  /**
   * Frees a phone for a different user: its sessions end and the row is retired (history kept), so the
   * next person to sign in on it registers it afresh. A blocked phone must be re-enabled first.
   */
  async release(t: TenantContext, id: string, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.find(tx, t.organizationId, id);
      if (before.revokedAt) {
        throw new AppException(
          'DEVICE_REVOKED',
          'This device is blocked. Re-enable it before releasing it.',
          409,
        );
      }
      await this.sessions.revokeAllForDevice(tx, id, 'device_released');
      await tx.device.update({
        where: { id },
        data: { deviceUid: `${RELEASED_PREFIX}${id}`, pushToken: null },
      });
      return this.audited(tx, t, id, 'device.release', before, meta);
    });
  }

  private async find(db: Db, organizationId: string, id: string) {
    const device = await db.device.findFirst({
      where: { id, organizationId, NOT: { deviceUid: { startsWith: RELEASED_PREFIX } } },
      select: DEVICE_SELECT,
    });
    if (!device) throw new AppException('NOT_FOUND', 'Device not found', 404);
    return device;
  }

  private async audited(
    tx: Db,
    t: TenantContext,
    id: string,
    action: string,
    before: Awaited<ReturnType<DevicesService['find']>>,
    meta: Meta,
  ) {
    const after = await tx.device.findUniqueOrThrow({ where: { id }, select: DEVICE_SELECT });
    await this.audit.record(tx, {
      organizationId: t.organizationId,
      actorId: t.userId,
      action,
      entityType: 'device',
      entityId: id,
      before: JSON.parse(JSON.stringify(before)),
      after: JSON.parse(JSON.stringify(after)),
      ...meta,
    });
    return after;
  }
}
