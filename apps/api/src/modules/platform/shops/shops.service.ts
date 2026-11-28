import { Injectable } from '@nestjs/common';
import type { PlatformRoleName } from '@ksms/constants';
import { SessionCache } from '../../../common/auth/session-cache';
import { AppException } from '../../../common/errors/app.exception';
import { decodeKeyset, keysetPage } from '../../../common/pagination/keyset';
import { shopSubscription } from '../../../common/subscription/shop-subscription';
import type { Db } from '../../../database/db.types';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { PasswordService } from '../../identity/password.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { newTemporaryPassword } from '../auth/credentials';
import type { PlatformPrincipal, PlatformRequestMeta } from '../platform.types';
import type { ShopsQuery } from './shops.dto';

interface ShopRow {
  id: string;
  name: string;
  phone: string | null;
  created_at: Date;
  lock_status: string;
  locked_at: Date | null;
  ends_at: Date | null;
  grace_days: number | null;
  plan_code: string | null;
  is_trial: boolean | null;
  owner_name: string | null;
  owner_phone: string | null;
}

const notFound = () => new AppException('NOT_FOUND', 'Shop not found', 404);

/**
 * The platform's view of every shop (ADR-001: cross-tenant by design, only here). Reads for ADMIN and
 * SUPPORT; lock/unlock and owner password reset for ADMIN; force-logout and device revoke for both.
 * Every change is audited with a reason, in the same transaction.
 */
@Injectable()
export class ShopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly cache: SessionCache,
    private readonly passwords: PasswordService,
  ) {}

  async list(q: ShopsQuery) {
    const limit = q.limit ?? 50;
    const where: Prisma.Sql[] = [Prisma.sql`o.deleted_at IS NULL`];
    const text = q.q?.trim();
    if (text) {
      const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        Prisma.sql`(o.name ILIKE ${like} OR o.phone ILIKE ${like} OR owner.phone ILIKE ${like})`,
      );
    }
    if (q.plan) where.push(Prisma.sql`p.code = ${q.plan}`);
    if (q.expiringInDays !== undefined) {
      where.push(
        Prisma.sql`s.ends_at >= now() AND s.ends_at <= now() + make_interval(days => ${q.expiringInDays})`,
      );
    }
    const graceEnd = Prisma.sql`s.ends_at + make_interval(days => s.grace_days)`;
    switch (q.status) {
      case 'LOCKED':
        where.push(Prisma.sql`o.lock_status = 'LOCKED'`);
        break;
      case 'TRIAL':
        where.push(Prisma.sql`o.lock_status = 'NONE' AND s.ends_at > now() AND p.is_trial`);
        break;
      case 'ACTIVE':
        where.push(
          Prisma.sql`o.lock_status = 'NONE' AND (s.id IS NULL OR (s.ends_at > now() AND NOT p.is_trial))`,
        );
        break;
      case 'GRACE':
        where.push(
          Prisma.sql`o.lock_status = 'NONE' AND s.ends_at <= now() AND ${graceEnd} > now()`,
        );
        break;
      case 'EXPIRED':
        where.push(Prisma.sql`o.lock_status = 'NONE' AND ${graceEnd} <= now()`);
        break;
    }
    if (q.cursor) {
      const k = decodeKeyset(q.cursor);
      where.push(Prisma.sql`(o.created_at, o.id) < (${k.value as Date}, ${k.id}::uuid)`);
    }

    const rows = await this.prisma.$queryRaw<ShopRow[]>`
      SELECT o.id, o.name, o.phone, o.created_at, o.lock_status, o.locked_at,
             s.ends_at, s.grace_days, p.code AS plan_code, p.is_trial,
             owner.full_name AS owner_name, owner.phone AS owner_phone
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN LATERAL (
        SELECT u.full_name, u.phone
        FROM organization_members m
        JOIN roles r ON r.id = m.role_id AND r.is_system AND r.name = 'Owner'
        JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = o.id
        ORDER BY m.created_at
        LIMIT 1
      ) owner ON true
      WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${limit + 1}`;

    const items = rows.map((r) => {
      const sub = shopSubscription({
        lockStatus: r.lock_status,
        lockedAt: r.locked_at,
        subscription:
          r.ends_at && r.plan_code !== null
            ? {
                endsAt: r.ends_at,
                graceDays: r.grace_days ?? 0,
                plan: { code: r.plan_code, isTrial: r.is_trial === true },
              }
            : null,
      });
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        createdAt: r.created_at,
        owner: r.owner_phone ? { fullName: r.owner_name, phone: r.owner_phone } : null,
        state: sub.state,
        planCode: sub.planCode,
        endsAt: sub.endsAt,
        graceEndsAt: sub.graceEndsAt,
        daysLeft: sub.daysLeft,
      };
    });
    return keysetPage(items, limit, (r) => r.createdAt);
  }

  async detail(orgId: string, viewer: PlatformRoleName) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: {
        id: true,
        name: true,
        legalName: true,
        phone: true,
        email: true,
        gstEnabled: true,
        settings: true,
        createdAt: true,
        lockStatus: true,
        lockReason: true,
        lockedAt: true,
        lockedBy: { select: { email: true, fullName: true } },
        subscription: {
          select: {
            startsAt: true,
            endsAt: true,
            graceDays: true,
            version: true,
            plan: {
              select: {
                id: true,
                code: true,
                name: true,
                isTrial: true,
                maxBranches: true,
                maxUsers: true,
              },
            },
          },
        },
        branches: {
          where: { deletedAt: null },
          select: { id: true, code: true, name: true, city: true, isActive: true },
          orderBy: { createdAt: 'asc' },
        },
        members: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            role: { select: { name: true, isSystem: true } },
            user: {
              select: {
                id: true,
                fullName: true,
                phone: true,
                email: true,
                isActive: true,
                lastLoginAt: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!org) throw notFound();

    const [devices, events, payments, usage] = await Promise.all([
      this.prisma.device.findMany({
        where: { organizationId: orgId },
        select: {
          id: true,
          name: true,
          platform: true,
          appVersion: true,
          lastSeenAt: true,
          revokedAt: true,
          user: { select: { id: true, fullName: true } },
        },
        orderBy: { lastSeenAt: { sort: 'desc', nulls: 'last' } },
        take: 200,
      }),
      this.prisma.subscriptionEvent.findMany({
        where: { organizationId: orgId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          type: true,
          months: true,
          oldEndsAt: true,
          newEndsAt: true,
          paymentId: true,
          reason: true,
          createdAt: true,
          plan: { select: { code: true } },
          admin: { select: { email: true, fullName: true } },
        },
      }),
      // Money is ADMIN-only (ADMIN_PANEL.md §1.1).
      viewer === 'ADMIN'
        ? this.prisma.subscriptionPayment.findMany({
            where: { organizationId: orgId },
            orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
            take: 100,
            select: {
              id: true,
              amount: true,
              method: true,
              reference: true,
              months: true,
              receivedAt: true,
              reversesPaymentId: true,
              recordedBy: { select: { email: true } },
              createdAt: true,
            },
          })
        : Promise.resolve(null),
      Promise.all([
        this.prisma.product.count({ where: { organizationId: orgId } }),
        this.prisma.customer.count({ where: { organizationId: orgId } }),
        this.prisma.sale.count({ where: { organizationId: orgId } }),
        this.prisma.sale.findFirst({
          where: { organizationId: orgId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]),
    ]);

    const sub = shopSubscription(org);
    return {
      id: org.id,
      name: org.name,
      legalName: org.legalName,
      phone: org.phone,
      email: org.email,
      gstEnabled: org.gstEnabled,
      settings: org.settings,
      createdAt: org.createdAt,
      lock: {
        status: org.lockStatus,
        reason: org.lockReason,
        lockedAt: org.lockedAt,
        lockedBy: org.lockedBy,
      },
      subscription: {
        ...sub,
        startsAt: org.subscription?.startsAt ?? null,
        graceDays: org.subscription?.graceDays ?? null,
        version: org.subscription?.version ?? null,
        plan: org.subscription?.plan ?? null,
      },
      branches: org.branches,
      users: org.members.map((m) => ({
        memberId: m.id,
        status: m.status,
        role: m.role.name,
        isOwner: m.role.isSystem && m.role.name === 'Owner',
        joinedAt: m.createdAt,
        ...m.user,
      })),
      devices,
      events,
      payments,
      usage: {
        products: usage[0],
        customers: usage[1],
        sales: usage[2],
        lastSaleAt: usage[3]?.createdAt ?? null,
      },
    };
  }

  private async lockOrgRow(tx: Db, orgId: string) {
    const rows = await tx.$queryRaw<{ id: string; lock_status: string }[]>`
      SELECT id, lock_status FROM organizations WHERE id = ${orgId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    return rows[0]!;
  }

  /** Ends every shop session of the organization (lock, force-logout). Callers must hold a tx. */
  private async revokeOrgSessions(tx: Db, orgId: string, reason: string): Promise<number> {
    const res = await tx.userSession.updateMany({
      where: { organizationId: orgId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    this.cache.invalidateAll(); // cached reads on this instance stop at once
    return res.count;
  }

  /** ADMIN only. Blocks the shop on its next request and ends every session (ADMIN_PANEL.md §2.4). */
  async lock(actor: PlatformPrincipal, orgId: string, reason: string, meta: PlatformRequestMeta) {
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await this.lockOrgRow(tx, orgId);
      if (before.lock_status === 'LOCKED') {
        throw new AppException('ALREADY_LOCKED', 'This shop is already locked', 409);
      }
      await tx.organization.update({
        where: { id: orgId },
        data: {
          lockStatus: 'LOCKED',
          lockReason: reason,
          lockedAt: new Date(),
          lockedById: actor.adminId,
        },
        select: { id: true },
      });
      const revoked = await this.revokeOrgSessions(tx, orgId, 'org_locked');
      await tx.subscriptionEvent.create({
        data: { organizationId: orgId, type: 'LOCKED', reason, adminId: actor.adminId },
        select: { id: true },
      });
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'shop.lock',
        organizationId: orgId,
        entityType: 'organization',
        entityId: orgId,
        before: { lockStatus: before.lock_status },
        after: { lockStatus: 'LOCKED', sessionsRevoked: revoked },
        reason,
        meta,
      });
      return { lockStatus: 'LOCKED', sessionsRevoked: revoked };
    });
    this.cache.invalidateAll();
    return result;
  }

  /** ADMIN only. Lifts the lock; never changes the subscription dates. */
  async unlock(actor: PlatformPrincipal, orgId: string, reason: string, meta: PlatformRequestMeta) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.unlockInTx(tx, actor, orgId, reason, meta);
      return { lockStatus: 'NONE' };
    });
    this.cache.invalidateAll();
    return result;
  }

  /** Shared with "record payment and unlock" so both run in one transaction. */
  async unlockInTx(
    tx: Db,
    actor: PlatformPrincipal,
    orgId: string,
    reason: string,
    meta: PlatformRequestMeta,
  ) {
    const before = await this.lockOrgRow(tx, orgId);
    if (before.lock_status !== 'LOCKED') {
      throw new AppException('NOT_LOCKED', 'This shop is not locked', 409);
    }
    await tx.organization.update({
      where: { id: orgId },
      data: { lockStatus: 'NONE', lockReason: null, lockedAt: null, lockedById: null },
      select: { id: true },
    });
    await tx.subscriptionEvent.create({
      data: { organizationId: orgId, type: 'UNLOCKED', reason, adminId: actor.adminId },
      select: { id: true },
    });
    await this.audit.record(tx, {
      adminId: actor.adminId,
      action: 'shop.unlock',
      organizationId: orgId,
      entityType: 'organization',
      entityId: orgId,
      before: { lockStatus: 'LOCKED' },
      after: { lockStatus: 'NONE' },
      reason,
      meta,
    });
  }

  /** ADMIN and SUPPORT. Signs every user of the shop out (e.g. a stolen phone). */
  async forceLogout(
    actor: PlatformPrincipal,
    orgId: string,
    reason: string,
    meta: PlatformRequestMeta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOrgRow(tx, orgId);
      const revoked = await this.revokeOrgSessions(tx, orgId, 'platform_force_logout');
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'shop.force_logout',
        organizationId: orgId,
        entityType: 'organization',
        entityId: orgId,
        after: { sessionsRevoked: revoked },
        reason,
        meta,
      });
      return { sessionsRevoked: revoked };
    });
  }

  /** ADMIN and SUPPORT. Blocks one phone of the shop and ends its sessions. */
  async revokeDevice(
    actor: PlatformPrincipal,
    orgId: string,
    deviceId: string,
    reason: string,
    meta: PlatformRequestMeta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, organizationId: orgId },
        select: { id: true, revokedAt: true },
      });
      if (!device) throw new AppException('NOT_FOUND', 'Device not found', 404);
      if (!device.revokedAt) {
        await tx.device.update({
          where: { id: deviceId },
          data: { revokedAt: new Date() },
          select: { id: true },
        });
      }
      const res = await tx.userSession.updateMany({
        where: { deviceId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'platform_device_revoked' },
      });
      this.cache.invalidateAll();
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'shop.device_revoke',
        organizationId: orgId,
        entityType: 'device',
        entityId: deviceId,
        after: { sessionsRevoked: res.count },
        reason,
        meta,
      });
      return { deviceId, sessionsRevoked: res.count };
    });
  }

  /**
   * ADMIN only. Gives the shop owner a temporary password (returned once), signs them out everywhere
   * (token version bump) and clears any login lockout.
   */
  async resetOwnerPassword(
    actor: PlatformPrincipal,
    orgId: string,
    reason: string,
    meta: PlatformRequestMeta,
  ) {
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const owner = await this.prisma.$transaction(async (tx) => {
      await this.lockOrgRow(tx, orgId);
      const member = await tx.organizationMember.findFirst({
        where: { organizationId: orgId, role: { isSystem: true, name: 'Owner' } },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, user: { select: { fullName: true, phone: true } } },
      });
      if (!member) throw new AppException('NOT_FOUND', 'This shop has no owner account', 404);
      await tx.user.update({
        where: { id: member.userId },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
          failedLoginCount: 0,
          lastFailedLoginAt: null,
          lockedUntil: null,
        },
        select: { id: true },
      });
      await tx.userSession.updateMany({
        where: { userId: member.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'platform_password_reset' },
      });
      this.cache.invalidateUser(member.userId);
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'shop.reset_owner_password',
        organizationId: orgId,
        entityType: 'user',
        entityId: member.userId,
        reason,
        meta,
      });
      return { userId: member.userId, ...member.user };
    });
    return { owner, temporaryPassword };
  }

  /** ADMIN and SUPPORT. An internal note on the shop (e.g. SUPPORT recommending a lock). Audit only. */
  async addNote(actor: PlatformPrincipal, orgId: string, note: string, meta: PlatformRequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.organization.findFirst({
        where: { id: orgId },
        select: { id: true },
      });
      if (!exists) throw notFound();
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'shop.note',
        organizationId: orgId,
        entityType: 'organization',
        entityId: orgId,
        reason: note,
        meta,
      });
      return { ok: true };
    });
  }
}
