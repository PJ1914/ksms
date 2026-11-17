import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface RolePermissions {
  /** The system Owner role is treated as holding every permission, including ones added later. */
  isOwner: boolean;
  keys: ReadonlySet<string>;
}

const TTL_MS = 30_000;

/** Loads a role's permissions with a short in-memory cache; invalidated immediately when a role changes. */
@Injectable()
export class RolePermissionService {
  private readonly cache = new Map<string, { value: RolePermissions; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async get(roleId: string): Promise<RolePermissions> {
    const hit = this.cache.get(roleId);
    if (hit && hit.expires > Date.now()) return hit.value;

    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: {
        name: true,
        isSystem: true,
        permissions: { select: { permission: { select: { key: true } } } },
      },
    });
    const value: RolePermissions = {
      isOwner: role?.isSystem === true && role.name === 'Owner',
      keys: new Set(role?.permissions.map((p) => p.permission.key) ?? []),
    };
    this.cache.set(roleId, { value, expires: Date.now() + TTL_MS });
    return value;
  }

  invalidate(roleId?: string): void {
    if (roleId) this.cache.delete(roleId);
    else this.cache.clear();
  }
}
