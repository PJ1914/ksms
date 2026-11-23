import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { Paginated } from '../../common/pagination/paginated';
import { todayInIndia } from '../../common/utils/dates';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { NotificationsQuery } from './notifications.dto';

const EXPIRING_DAYS = 30;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(t: TenantContext, q: NotificationsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where = this.scopeWhere(t, q.unreadOnly);

    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: this.scopeWhere(t, true) }),
    ]);

    return new Paginated(rows.map(view), { page, pageSize, total, unreadCount });
  }

  async unreadCount(t: TenantContext) {
    const unreadCount = await this.prisma.notification.count({
      where: this.scopeWhere(t, true),
    });
    return { unreadCount };
  }

  async markRead(t: TenantContext, id: string) {
    const existing = await this.prisma.notification.findFirst({
      where: {
        id,
        organizationId: t.organizationId,
        OR: [{ userId: null }, { userId: t.userId }],
      },
    });
    if (!existing) {
      throw new AppException('NOTIFICATION_NOT_FOUND', 'Notification not found', 404);
    }
    const updated = existing.readAt
      ? existing
      : await this.prisma.notification.update({
          where: { id },
          data: { readAt: new Date() },
        });
    return view(updated);
  }

  async markAllRead(t: TenantContext) {
    const res = await this.prisma.notification.updateMany({
      where: this.scopeWhere(t, true),
      data: { readAt: new Date() },
    });
    return { marked: res.count };
  }

  /**
   * Scans the current branch for low-stock products and expired/expiring batches,
   * creating deduplicated unread notifications so repeated checks do not spam duplicates.
   */
  async checkBranchAlerts(t: TenantContext) {
    if (!t.branchId) {
      throw new AppException('BRANCH_REQUIRED', 'Choose a working branch first', 400);
    }
    const branchId = t.branchId;
    const cutoff = new Date(Date.now() + EXPIRING_DAYS * 86_400_000);

    const [balances, batches, existingUnread] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where: {
          organizationId: t.organizationId,
          branchId,
          product: { deletedAt: null, status: 'ACTIVE' },
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              minStockLevel: true,
              baseUnit: { select: { code: true } },
            },
          },
        },
      }),
      this.prisma.inventoryBatch.findMany({
        where: {
          organizationId: t.organizationId,
          branchId,
          expiryDate: { lte: cutoff },
          quantityOnHand: { gt: 0 },
          product: { deletedAt: null, status: 'ACTIVE' },
        },
        include: {
          product: { select: { id: true, name: true, baseUnit: { select: { code: true } } } },
        },
      }),
      this.prisma.notification.findMany({
        where: {
          organizationId: t.organizationId,
          branchId,
          readAt: null,
          type: { in: ['LOW_STOCK', 'EXPIRING_SOON'] },
        },
        select: { type: true, data: true },
      }),
    ]);

    const seenKeys = new Set(
      existingUnread
        .map((n) => {
          const d = n.data as Record<string, unknown> | null;
          return d?.dedupeKey ? `${n.type}:${String(d.dedupeKey)}` : null;
        })
        .filter((x): x is string => x !== null),
    );

    const toCreate: Prisma.NotificationCreateManyInput[] = [];
    const today = todayInIndia();

    for (const b of balances) {
      const min = new Decimal(b.product.minStockLevel.toString());
      if (min.lte(0)) continue;
      const qty = new Decimal(b.quantityOnHand.toString());
      if (qty.gt(min)) continue;

      const dedupeKey = `low:${branchId}:${b.product.id}`;
      if (seenKeys.has(`LOW_STOCK:${dedupeKey}`)) continue;
      seenKeys.add(`LOW_STOCK:${dedupeKey}`);

      toCreate.push({
        organizationId: t.organizationId,
        branchId,
        userId: null,
        type: 'LOW_STOCK',
        title: `Low stock: ${b.product.name}`,
        body: `Only ${qty.toFixed(3).replace(/\.?0+$/, '')} ${b.product.baseUnit.code} left (reorder at ${min.toFixed(3).replace(/\.?0+$/, '')} ${b.product.baseUnit.code}).`,
        data: { productId: b.product.id, branchId, date: today, dedupeKey },
      });
    }

    const nowMs = Date.now();
    for (const batch of batches) {
      if (!batch.expiryDate) continue;
      const dedupeKey = `exp:${branchId}:${batch.id}`;
      if (seenKeys.has(`EXPIRING_SOON:${dedupeKey}`)) continue;
      seenKeys.add(`EXPIRING_SOON:${dedupeKey}`);

      const expired = batch.expiryDate.getTime() <= nowMs;
      const qty = new Decimal(batch.quantityOnHand.toString()).toFixed(3).replace(/\.?0+$/, '');
      toCreate.push({
        organizationId: t.organizationId,
        branchId,
        userId: null,
        type: 'EXPIRING_SOON',
        title: `${expired ? 'Expired' : 'Expiring soon'}: ${batch.product.name}`,
        body: `Batch ${batch.batchNumber} (${qty} ${batch.product.baseUnit.code}) ${expired ? 'expired on' : 'expires on'} ${batch.expiryDate.toISOString().slice(0, 10)}.`,
        data: {
          productId: batch.product.id,
          batchId: batch.id,
          branchId,
          expired,
          dedupeKey,
        },
      });
    }

    if (toCreate.length > 0) {
      await this.prisma.notification.createMany({ data: toCreate });
    }
    return { created: toCreate.length };
  }

  private scopeWhere(t: TenantContext, unreadOnly?: boolean): Prisma.NotificationWhereInput {
    return {
      organizationId: t.organizationId,
      AND: [
        { OR: [{ userId: null }, { userId: t.userId }] },
        ...(t.branchId ? [{ OR: [{ branchId: null }, { branchId: t.branchId }] }] : []),
      ],
      ...(unreadOnly ? { readAt: null } : {}),
    };
  }
}

function view(n: Prisma.NotificationGetPayload<object>) {
  return {
    id: n.id,
    branchId: n.branchId,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}
