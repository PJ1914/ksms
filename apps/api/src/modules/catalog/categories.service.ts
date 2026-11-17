import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateCategoryDto, UpdateCategoryDto } from './catalog.dto';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const SELECT = { id: true, name: true, parentId: true, sortOrder: true, isActive: true } as const;
const MAX_DEPTH = 3;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string) {
    const rows = await this.prisma.productCategory.findMany({
      where: { organizationId, deletedAt: null },
      select: { ...SELECT, _count: { select: { products: { where: { deletedAt: null } } } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
  }

  /** Category must belong to the organization (used when attaching products). */
  async assertExists(db: Db, organizationId: string, id: string): Promise<void> {
    const found = await db.productCategory.count({
      where: { id, organizationId, deletedAt: null },
    });
    if (!found)
      throw new AppException('CATEGORY_NOT_FOUND', 'Category not found in this organization', 404);
  }

  async create(organizationId: string, actorId: string, dto: CreateCategoryDto, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.parentId) {
        await this.assertExists(tx, organizationId, dto.parentId);
        if ((await this.depthOf(tx, organizationId, dto.parentId)) >= MAX_DEPTH) {
          throw new AppException(
            'CATEGORY_TOO_DEEP',
            `Categories can be nested ${MAX_DEPTH} levels deep at most`,
            422,
          );
        }
      }
      await this.assertNameFree(tx, organizationId, dto.parentId ?? null, dto.name);
      const created = await tx.productCategory.create({
        data: {
          organizationId,
          name: dto.name,
          parentId: dto.parentId ?? null,
          sortOrder: dto.sortOrder ?? 0,
        },
        select: SELECT,
      });
      await this.audit.record(tx, {
        organizationId,
        actorId,
        action: 'category.create',
        entityType: 'category',
        entityId: created.id,
        after: created,
        ...meta,
      });
      return created;
    });
  }

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    dto: UpdateCategoryDto,
    meta: Meta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.productCategory.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: SELECT,
      });
      if (!before) throw new AppException('NOT_FOUND', 'Category not found', 404);

      const parentId = dto.parentId === undefined ? before.parentId : dto.parentId;
      if (dto.parentId !== undefined && parentId !== before.parentId && parentId) {
        await this.assertExists(tx, organizationId, parentId);
        if (parentId === id || (await this.isDescendant(tx, organizationId, parentId, id))) {
          throw new AppException('CATEGORY_CYCLE', 'A category cannot be moved inside itself', 422);
        }
        const subtreeHeight = await this.heightOf(tx, organizationId, id);
        if ((await this.depthOf(tx, organizationId, parentId)) + subtreeHeight > MAX_DEPTH) {
          throw new AppException(
            'CATEGORY_TOO_DEEP',
            `Categories can be nested ${MAX_DEPTH} levels deep at most`,
            422,
          );
        }
      }
      const name = dto.name ?? before.name;
      if (name !== before.name || parentId !== before.parentId) {
        await this.assertNameFree(tx, organizationId, parentId, name, id);
      }
      const after = await tx.productCategory.update({
        where: { id },
        data: { name, parentId, sortOrder: dto.sortOrder, isActive: dto.isActive },
        select: SELECT,
      });
      await this.audit.record(tx, {
        organizationId,
        actorId,
        action: 'category.update',
        entityType: 'category',
        entityId: id,
        before,
        after,
        ...meta,
      });
      return after;
    });
  }

  async remove(organizationId: string, actorId: string, id: string, meta: Meta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const category = await tx.productCategory.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: SELECT,
      });
      if (!category) throw new AppException('NOT_FOUND', 'Category not found', 404);
      const children = await tx.productCategory.count({
        where: { parentId: id, organizationId, deletedAt: null },
      });
      const products = await tx.product.count({
        where: { categoryId: id, organizationId, deletedAt: null },
      });
      if (children > 0 || products > 0) {
        throw new AppException(
          'CATEGORY_NOT_EMPTY',
          'Move or remove its products and sub-categories first',
          409,
        );
      }
      await tx.productCategory.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      await this.audit.record(tx, {
        organizationId,
        actorId,
        action: 'category.delete',
        entityType: 'category',
        entityId: id,
        before: category,
        ...meta,
      });
    });
  }

  /** Sibling names are unique ignoring case (a database unique index cannot do this because NULL parents are distinct). */
  private async assertNameFree(
    db: Db,
    organizationId: string,
    parentId: string | null,
    name: string,
    exceptId?: string,
  ) {
    const clash = await db.productCategory.findFirst({
      where: {
        organizationId,
        parentId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash)
      throw new AppException('CONFLICT', 'A category with this name already exists here', 409);
  }

  /** Number of levels from the root down to (and including) this category. */
  private async depthOf(db: Db, organizationId: string, id: string): Promise<number> {
    let depth = 0;
    let cursor: string | null = id;
    while (cursor && depth < 10) {
      const row: { parentId: string | null } | null = await db.productCategory.findFirst({
        where: { id: cursor, organizationId },
        select: { parentId: true },
      });
      depth++;
      cursor = row?.parentId ?? null;
    }
    return depth;
  }

  private async isDescendant(
    db: Db,
    organizationId: string,
    candidateId: string,
    ancestorId: string,
  ): Promise<boolean> {
    let cursor: string | null = candidateId;
    for (let i = 0; cursor && i < 10; i++) {
      if (cursor === ancestorId) return true;
      const row: { parentId: string | null } | null = await db.productCategory.findFirst({
        where: { id: cursor, organizationId },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
    }
    return false;
  }

  /** Levels in the subtree rooted at id (1 = no children). */
  private async heightOf(db: Db, organizationId: string, id: string): Promise<number> {
    const children = await db.productCategory.findMany({
      where: { parentId: id, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (children.length === 0) return 1;
    const heights = await Promise.all(children.map((c) => this.heightOf(db, organizationId, c.id)));
    return 1 + Math.max(...heights);
  }
}
