import { Injectable } from '@nestjs/common';
import { ALL_PERMISSION_KEYS } from '@ksms/constants';
import { RolePermissionService } from '../../common/auth/role-permission.service';
import { AppException } from '../../common/errors/app.exception';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateRoleDto, UpdateRoleDto } from './staff.dto';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { members: true } },
} as const;

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permission: { key: string } }[];
  _count: { members: number };
};

const view = (r: RoleRow) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  isSystem: r.isSystem,
  memberCount: r._count.members,
  permissions:
    r.isSystem && r.name === 'Owner'
      ? [...ALL_PERMISSION_KEYS]
      : r.permissions.map((p) => p.permission.key).sort(),
});

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rolePerms: RolePermissionService,
  ) {}

  async list(organizationId: string) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId },
      select: ROLE_SELECT,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map(view);
  }

  async get(organizationId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, organizationId },
      select: ROLE_SELECT,
    });
    if (!role) throw new AppException('NOT_FOUND', 'Role not found', 404);
    return view(role);
  }

  async permissionCatalog() {
    return this.prisma.permission.findMany({
      select: { key: true, module: true, description: true },
      orderBy: { key: 'asc' },
    });
  }

  /**
   * Privilege-escalation guard: you may only hand out permissions you hold yourself
   * (the Owner holds all). Applied to role creation/edit and to role assignment.
   */
  async assertCanGrant(db: Db, actorRoleId: string, permissionKeys: string[]): Promise<void> {
    const mine = await this.rolePerms.get(actorRoleId);
    if (mine.isOwner) return;
    const missing = permissionKeys.filter((k) => !mine.keys.has(k));
    if (missing.length > 0) {
      throw new AppException(
        'PERMISSION_ESCALATION',
        'You cannot grant permissions you do not have',
        403,
        { missing },
      );
    }
  }

  async keysOfRole(
    db: Db,
    organizationId: string,
    roleId: string,
  ): Promise<{ keys: string[]; isOwnerRole: boolean }> {
    const role = await db.role.findFirst({
      where: { id: roleId, organizationId },
      select: {
        name: true,
        isSystem: true,
        permissions: { select: { permission: { select: { key: true } } } },
      },
    });
    if (!role) throw new AppException('ROLE_NOT_FOUND', 'Role not found in this organization', 404);
    const isOwnerRole = role.isSystem && role.name === 'Owner';
    return { keys: role.permissions.map((p) => p.permission.key), isOwnerRole };
  }

  async create(
    organizationId: string,
    actorId: string,
    actorRoleId: string,
    dto: CreateRoleDto,
    meta: Meta,
  ) {
    await this.assertCanGrant(this.prisma, actorRoleId, dto.permissionKeys);
    return this.prisma.$transaction(async (tx) => {
      const ids = await this.permissionIds(tx, dto.permissionKeys);
      const role = await tx.role.create({
        data: { organizationId, name: dto.name.trim(), description: dto.description },
        select: { id: true },
      });
      await tx.rolePermission.createMany({
        data: ids.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
      const created = await tx.role.findUniqueOrThrow({
        where: { id: role.id },
        select: ROLE_SELECT,
      });
      await this.audit.record(tx, {
        organizationId,
        actorId,
        action: 'role.create',
        entityType: 'role',
        entityId: role.id,
        after: view(created),
        ...meta,
      });
      return view(created);
    });
  }

  async update(
    organizationId: string,
    actorId: string,
    actorRoleId: string,
    id: string,
    dto: UpdateRoleDto,
    meta: Meta,
  ) {
    if (dto.permissionKeys) await this.assertCanGrant(this.prisma, actorRoleId, dto.permissionKeys);
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.role.findFirst({
        where: { id, organizationId },
        select: ROLE_SELECT,
      });
      if (!before) throw new AppException('NOT_FOUND', 'Role not found', 404);
      if (before.isSystem && before.name === 'Owner') {
        throw new AppException('OWNER_PROTECTED', 'The Owner role cannot be changed', 403);
      }
      if (before.isSystem && dto.name && dto.name.trim() !== before.name) {
        throw new AppException('SYSTEM_ROLE_PROTECTED', 'System roles cannot be renamed', 403);
      }
      await tx.role.update({
        where: { id },
        data: { name: dto.name?.trim(), description: dto.description },
      });
      if (dto.permissionKeys) {
        const ids = await this.permissionIds(tx, dto.permissionKeys);
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: ids.map((permissionId) => ({ roleId: id, permissionId })),
        });
      }
      const after = await tx.role.findUniqueOrThrow({ where: { id }, select: ROLE_SELECT });
      await this.audit.record(tx, {
        organizationId,
        actorId,
        action: 'role.update',
        entityType: 'role',
        entityId: id,
        before: view(before),
        after: view(after),
        ...meta,
      });
      return view(after);
    });
    this.rolePerms.invalidate(id); // takes effect immediately on this instance
    return result;
  }

  async remove(organizationId: string, actorId: string, id: string, meta: Meta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findFirst({ where: { id, organizationId }, select: ROLE_SELECT });
      if (!role) throw new AppException('NOT_FOUND', 'Role not found', 404);
      if (role.isSystem)
        throw new AppException('SYSTEM_ROLE_PROTECTED', 'System roles cannot be deleted', 403);
      const pending = await tx.invitation.count({
        where: { roleId: id, acceptedAt: null, revokedAt: null },
      });
      if (role._count.members > 0 || pending > 0) {
        throw new AppException(
          'ROLE_IN_USE',
          'Reassign employees and revoke invitations using this role first',
          409,
        );
      }
      await tx.invitation.deleteMany({ where: { roleId: id } }); // only accepted/revoked history remains
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId,
        actorId,
        action: 'role.delete',
        entityType: 'role',
        entityId: id,
        before: view(role),
        ...meta,
      });
    });
    this.rolePerms.invalidate(id);
  }

  private async permissionIds(db: Db, keys: string[]): Promise<string[]> {
    const rows = await db.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    if (rows.length !== new Set(keys).size) {
      throw new AppException('VALIDATION_ERROR', 'Unknown permission key', 400);
    }
    return rows.map((r) => r.id);
  }
}
