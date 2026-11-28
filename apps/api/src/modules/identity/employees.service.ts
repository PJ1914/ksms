import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { TenantContext } from '../../common/auth/auth.types';
import { SessionCache } from '../../common/auth/session-cache';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { BranchService } from '../organization/branch.service';
import { RolesService } from './roles.service';
import { SessionService } from './session.service';
import type { UpdateEmployeeDto } from './staff.dto';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const EMPLOYEE_SELECT = {
  id: true,
  status: true,
  createdAt: true,
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
  role: { select: { id: true, name: true, isSystem: true } },
  branches: {
    select: { isDefault: true, branch: { select: { id: true, code: true, name: true } } },
  },
} satisfies Prisma.OrganizationMemberSelect;

type EmployeeRow = Prisma.OrganizationMemberGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

const view = (m: EmployeeRow) => ({
  id: m.id,
  status: m.status,
  createdAt: m.createdAt,
  user: m.user,
  role: { id: m.role.id, name: m.role.name },
  isOwner: m.role.isSystem && m.role.name === 'Owner',
  branches: m.branches.map((b) => ({ ...b.branch, isDefault: b.isDefault })),
});

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branches: BranchService,
    private readonly roles: RolesService,
    private readonly sessions: SessionService,
    private readonly cache: SessionCache,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async list(organizationId: string) {
    const rows = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      select: EMPLOYEE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(view);
  }

  async get(organizationId: string, id: string) {
    return view(await this.find(this.prisma, organizationId, id));
  }

  async update(t: TenantContext, id: string, dto: UpdateEmployeeDto, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.find(tx, t.organizationId, id);
      this.assertModifiable(t, before);

      if (dto.roleId) {
        const target = await this.roles.keysOfRole(tx, t.organizationId, dto.roleId);
        if (target.isOwnerRole) {
          throw new AppException(
            'OWNER_ROLE_NOT_ASSIGNABLE',
            'The Owner role cannot be assigned',
            400,
          );
        }
        await this.roles.assertCanGrant(tx, t.roleId, target.keys);
        await tx.organizationMember.update({ where: { id }, data: { roleId: dto.roleId } });
      }
      if (dto.branchIds) {
        await this.branches.assertAssignable(tx, t.organizationId, dto.branchIds);
        await tx.branchMembership.deleteMany({ where: { memberId: id } });
        await tx.branchMembership.createMany({
          data: dto.branchIds.map((branchId, i) => ({
            organizationId: t.organizationId,
            memberId: id,
            branchId,
            isDefault: i === 0,
          })),
        });
      }

      // Role or branches changed: the cached membership must not serve this person's next requests.
      this.cache.invalidateUser(before.user.id);
      const after = await this.find(tx, t.organizationId, id);
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        actorId: t.userId,
        action: 'employee.update',
        entityType: 'employee',
        entityId: id,
        before: view(before) as unknown as Prisma.InputJsonValue,
        after: view(after) as unknown as Prisma.InputJsonValue,
        ...meta,
      });
      return view(after);
    });
  }

  /** Deactivates the membership and signs the person out of this shop immediately. */
  async deactivate(t: TenantContext, id: string, reason: string | undefined, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.find(tx, t.organizationId, id);
      this.assertModifiable(t, before);
      await tx.organizationMember.update({ where: { id }, data: { status: 'DEACTIVATED' } });
      const revoked = await this.sessions.revokeAllForUser(
        tx,
        before.user.id,
        'employee_deactivated',
        t.organizationId,
      );
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        actorId: t.userId,
        action: 'employee.deactivate',
        entityType: 'employee',
        entityId: id,
        before: { status: before.status },
        after: { status: 'DEACTIVATED', revokedSessions: revoked },
        reason,
        ...meta,
      });
      return view(await this.find(tx, t.organizationId, id));
    });
  }

  async reactivate(t: TenantContext, id: string, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.find(tx, t.organizationId, id);
      this.assertModifiable(t, before);
      if (before.status !== 'ACTIVE') {
        await this.subscriptions.assertWithinLimit(tx, t.organizationId, 'users');
      }
      await tx.organizationMember.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        actorId: t.userId,
        action: 'employee.reactivate',
        entityType: 'employee',
        entityId: id,
        before: { status: before.status },
        after: { status: 'ACTIVE' },
        ...meta,
      });
      return view(await this.find(tx, t.organizationId, id));
    });
  }

  /** Clears a temporary login lockout (FIXES F13) so the person can try again at once. */
  async unlockLogin(t: TenantContext, id: string, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.find(tx, t.organizationId, id);
      const user = await tx.user.update({
        where: { id: before.user.id },
        data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
        select: { id: true },
      });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        actorId: t.userId,
        action: 'employee.unlock_login',
        entityType: 'employee',
        entityId: id,
        after: { userId: user.id },
        ...meta,
      });
      return view(await this.find(tx, t.organizationId, id));
    });
  }

  /** Always scoped by organization: another shop's member id is simply "not found". */
  private async find(
    db: Pick<PrismaService, 'organizationMember'>,
    organizationId: string,
    id: string,
  ) {
    const m = await db.organizationMember.findFirst({
      where: { id, organizationId },
      select: EMPLOYEE_SELECT,
    });
    if (!m) throw new AppException('NOT_FOUND', 'Employee not found', 404);
    return m;
  }

  private assertModifiable(t: TenantContext, target: EmployeeRow): void {
    if (target.role.isSystem && target.role.name === 'Owner') {
      throw new AppException('OWNER_PROTECTED', 'The owner account cannot be changed here', 403);
    }
    if (target.user.id === t.userId) {
      throw new AppException(
        'CANNOT_MODIFY_SELF',
        'You cannot change your own role, branches or status',
        403,
      );
    }
  }
}
