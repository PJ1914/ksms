import { Injectable } from '@nestjs/common';
import { normalizeIndianPhone } from '@ksms/validation';
import { SessionCache } from '../../../common/auth/session-cache';
import { AppException } from '../../../common/errors/app.exception';
import { afterKeyset, decodeKeyset, keysetPage } from '../../../common/pagination/keyset';
import type { Db } from '../../../database/db.types';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { PasswordService } from '../../identity/password.service';
import { SubscriptionService } from '../../subscription/subscription.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { newTemporaryPassword } from '../auth/credentials';
import type { PlatformPrincipal, PlatformRequestMeta } from '../platform.types';
import type { UpdateShopUserDto, UsersQuery } from './users.dto';

const notFound = () => new AppException('NOT_FOUND', 'User not found', 404);

const MEMBER_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  organizationId: true,
  organization: { select: { id: true, name: true } },
  role: { select: { id: true, name: true, isSystem: true } },
  user: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      isActive: true,
      lastLoginAt: true,
      lockedUntil: true,
    },
  },
} as const;

type MemberRow = Prisma.OrganizationMemberGetPayload<{ select: typeof MEMBER_SELECT }>;

function view(m: MemberRow) {
  return {
    memberId: m.id,
    status: m.status,
    joinedAt: m.createdAt,
    shop: m.organization,
    role: { id: m.role.id, name: m.role.name, isOwner: m.role.isSystem && m.role.name === 'Owner' },
    user: {
      id: m.user.id,
      fullName: m.user.fullName,
      phone: m.user.phone,
      email: m.user.email,
      isActive: m.user.isActive,
      lastLoginAt: m.user.lastLoginAt,
      loginLocked: m.user.lockedUntil !== null && m.user.lockedUntil.getTime() > Date.now(),
    },
  };
}

/**
 * Every person in every shop, as the platform sees them (ADR-001: cross-tenant by design, only here).
 * Platform staff can edit a person's details, move them to another role of THEIR shop, remove them from
 * the shop (deactivate: bills and ledgers still point at them, so a user is never erased), reset their
 * password and sign them out. Every change is audited with a reason, in the same transaction.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly cache: SessionCache,
    private readonly passwords: PasswordService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async list(q: UsersQuery) {
    const limit = q.limit ?? 50;
    const text = q.q?.trim();
    const and: Prisma.OrganizationMemberWhereInput[] = [];
    if (text) {
      and.push({
        OR: [
          { user: { fullName: { contains: text, mode: 'insensitive' } } },
          { user: { phone: { contains: text } } },
          { user: { email: { contains: text, mode: 'insensitive' } } },
          { organization: { name: { contains: text, mode: 'insensitive' } } },
        ],
      });
    }
    if (q.cursor) and.push(afterKeyset('createdAt', 'desc', 'desc', decodeKeyset(q.cursor)));
    const rows = await this.prisma.organizationMember.findMany({
      where: {
        organization: { deletedAt: null },
        organizationId: q.orgId,
        status: q.status,
        ...(q.role ? { role: { name: q.role } } : {}),
        ...(and.length > 0 ? { AND: and } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: MEMBER_SELECT,
    });
    const page = keysetPage(
      rows.map((m) => ({ id: m.id, ...view(m) })),
      limit,
      (r) => r.joinedAt,
    );
    return page;
  }

  /** The roles a person of this shop can be moved to (system roles and the shop's own). */
  async rolesOf(orgId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!org) throw new AppException('NOT_FOUND', 'Shop not found', 404);
    const roles = await this.prisma.role.findMany({
      where: { organizationId: orgId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isSystem: true, description: true },
    });
    return roles;
  }

  private async load(tx: Db, memberId: string) {
    const m = await tx.organizationMember.findFirst({
      where: { id: memberId, organization: { deletedAt: null } },
      select: MEMBER_SELECT,
    });
    if (!m) throw notFound();
    return m;
  }

  /** A shop must always keep one active Owner: nobody removes or demotes the last one. */
  private async assertAnotherOwner(tx: Db, organizationId: string, exceptMemberId: string) {
    const others = await tx.organizationMember.count({
      where: {
        organizationId,
        id: { not: exceptMemberId },
        status: 'ACTIVE',
        role: { isSystem: true, name: 'Owner' },
      },
    });
    if (others === 0) {
      throw new AppException('LAST_OWNER', 'This is the shop’s only active Owner', 409);
    }
  }

  private revokeSessions(tx: Db, userId: string, organizationId: string, reason: string) {
    this.cache.invalidateUser(userId);
    return tx.userSession.updateMany({
      where: { userId, organizationId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Edit name, phone, email and/or role. Phone and email belong to the person, so they change in every shop. */
  async update(
    actor: PlatformPrincipal,
    memberId: string,
    dto: UpdateShopUserDto,
    meta: PlatformRequestMeta,
  ) {
    const phone = dto.phone === undefined ? undefined : normalizeIndianPhone(dto.phone);
    if (dto.phone !== undefined && phone === null) {
      throw new AppException('VALIDATION_ERROR', 'Enter a valid Indian mobile number', 400);
    }
    if (
      dto.fullName === undefined &&
      phone === undefined &&
      dto.email === undefined &&
      dto.roleId === undefined
    ) {
      throw new AppException('VALIDATION_ERROR', 'Nothing to change', 400);
    }
    const out = await this.prisma.$transaction(async (tx) => {
      const m = await this.load(tx, memberId);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      if (dto.roleId !== undefined && dto.roleId !== m.role.id) {
        const target = await tx.role.findFirst({
          where: { id: dto.roleId, organizationId: m.organizationId },
          select: { id: true, name: true, isSystem: true },
        });
        if (!target) {
          throw new AppException('ROLE_NOT_FOUND', 'That role does not belong to this shop', 400);
        }
        const wasOwner = m.role.isSystem && m.role.name === 'Owner';
        if (wasOwner && m.status === 'ACTIVE') {
          await this.assertAnotherOwner(tx, m.organizationId, m.id);
        }
        await tx.organizationMember.update({
          where: { id: m.id },
          data: { roleId: target.id },
          select: { id: true },
        });
        if (target.isSystem && target.name === 'Owner') {
          // Owners work in every branch of the shop, like the first Owner does.
          const branches = await tx.branch.findMany({
            where: { organizationId: m.organizationId, deletedAt: null },
            select: { id: true },
          });
          await tx.branchMembership.createMany({
            data: branches.map((b) => ({
              organizationId: m.organizationId,
              memberId: m.id,
              branchId: b.id,
            })),
            skipDuplicates: true,
          });
        }
        before.role = m.role.name;
        after.role = target.name;
      }

      const data: Prisma.UserUpdateInput = {};
      if (dto.fullName !== undefined && dto.fullName.trim() !== m.user.fullName) {
        data.fullName = dto.fullName.trim();
        before.fullName = m.user.fullName;
        after.fullName = data.fullName;
      }
      if (phone && phone !== m.user.phone) {
        const clash = await tx.user.findFirst({
          where: { phone, id: { not: m.user.id } },
          select: { id: true },
        });
        if (clash)
          throw new AppException('CONFLICT', 'Another account uses this mobile number', 409);
        data.phone = phone;
        before.phone = m.user.phone;
        after.phone = phone;
      }
      if (dto.email !== undefined) {
        const email = dto.email.trim() === '' ? null : dto.email.trim().toLowerCase();
        if (email !== m.user.email) {
          if (email) {
            const clash = await tx.user.findFirst({
              where: { email, id: { not: m.user.id } },
              select: { id: true },
            });
            if (clash) throw new AppException('CONFLICT', 'Another account uses this email', 409);
          }
          data.email = email;
          before.email = m.user.email;
          after.email = email;
        }
      }
      if (Object.keys(data).length > 0) {
        await tx.user.update({ where: { id: m.user.id }, data, select: { id: true } });
      }
      if (Object.keys(after).length === 0) {
        throw new AppException('VALIDATION_ERROR', 'Nothing to change', 400);
      }
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'user.update',
        organizationId: m.organizationId,
        entityType: 'organization_member',
        entityId: m.id,
        before: before as Prisma.InputJsonObject,
        after: after as Prisma.InputJsonObject,
        reason: dto.reason,
        meta,
      });
      return this.load(tx, memberId);
    });
    this.cache.invalidateAll(); // role and member rows change for every cached session of the shop
    return view(out);
  }

  /**
   * Remove from the shop (DEACTIVATED) or bring back (ACTIVE). Removing ends their sessions at once.
   * Bringing back respects the plan's user limit.
   */
  async setStatus(
    actor: PlatformPrincipal,
    memberId: string,
    status: 'ACTIVE' | 'DEACTIVATED',
    reason: string,
    meta: PlatformRequestMeta,
  ) {
    const out = await this.prisma.$transaction(async (tx) => {
      const m = await this.load(tx, memberId);
      if (m.status === status) {
        throw new AppException('CONFLICT', `This user is already ${status.toLowerCase()}`, 409);
      }
      if (status === 'DEACTIVATED') {
        if (m.role.isSystem && m.role.name === 'Owner' && m.status === 'ACTIVE') {
          await this.assertAnotherOwner(tx, m.organizationId, m.id);
        }
      } else {
        await this.subscriptions.assertWithinLimit(tx, m.organizationId, 'users');
      }
      await tx.organizationMember.update({
        where: { id: m.id },
        data: { status },
        select: { id: true },
      });
      let revoked = 0;
      if (status === 'DEACTIVATED') {
        revoked = (
          await this.revokeSessions(tx, m.user.id, m.organizationId, 'platform_user_removed')
        ).count;
      }
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: status === 'DEACTIVATED' ? 'user.remove' : 'user.restore',
        organizationId: m.organizationId,
        entityType: 'organization_member',
        entityId: m.id,
        before: { status: m.status },
        after: { status, sessionsRevoked: revoked },
        reason,
        meta,
      });
      return this.load(tx, memberId);
    });
    this.cache.invalidateAll();
    return view(out);
  }

  async forceLogout(
    actor: PlatformPrincipal,
    memberId: string,
    reason: string,
    meta: PlatformRequestMeta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const m = await this.load(tx, memberId);
      const res = await this.revokeSessions(
        tx,
        m.user.id,
        m.organizationId,
        'platform_force_logout',
      );
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'user.force_logout',
        organizationId: m.organizationId,
        entityType: 'organization_member',
        entityId: m.id,
        after: { sessionsRevoked: res.count },
        reason,
        meta,
      });
      return { sessionsRevoked: res.count };
    });
  }

  /** A temporary password (shown once), a login lockout cleared and every session ended. */
  async resetPassword(
    actor: PlatformPrincipal,
    memberId: string,
    reason: string,
    meta: PlatformRequestMeta,
  ) {
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const user = await this.prisma.$transaction(async (tx) => {
      const m = await this.load(tx, memberId);
      await tx.user.update({
        where: { id: m.user.id },
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
        where: { userId: m.user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'platform_password_reset' },
      });
      this.cache.invalidateUser(m.user.id);
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'user.reset_password',
        organizationId: m.organizationId,
        entityType: 'user',
        entityId: m.user.id,
        reason,
        meta,
      });
      return { id: m.user.id, fullName: m.user.fullName, phone: m.user.phone };
    });
    return { user, temporaryPassword };
  }
}
