import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { Paginated } from '../../common/pagination/paginated';
import { timestampRange } from '../../common/utils/dates';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { isExpired, stockValue, todayInIndia } from './domain/stock';
import type { BalancesQuery, ExpiringQuery, MovementsQuery } from './inventory.dto';

const d = (v: string | number | Prisma.Decimal) => new Decimal(v.toString());
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const addDays = (isoDate: string, days: number) => {
  const t = new Date(`${isoDate}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
const EXPIRING_SOON_DAYS = 30;

/** Read-only inventory views. All of them are scoped to the caller's organization AND branch. */
@Injectable()
export class InventoryQueriesService {
  constructor(private readonly prisma: PrismaService) {}

  private branchOf(t: TenantContext): string {
    if (!t.branchId)
      throw new AppException('BRANCH_REQUIRED', 'x-branch-id header is required', 400);
    return t.branchId;
  }

  private async categoryTreeIds(organizationId: string, rootId: string): Promise<string[]> {
    const all = await this.prisma.productCategory.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    const ids = new Set<string>([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of all) {
        if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
          ids.add(c.id);
          grew = true;
        }
      }
    }
    return [...ids];
  }

  /** Stock per product (products without any stock appear with 0). Cost fields only when includeCost. */
  async balances(t: TenantContext, q: BalancesQuery, includeCost: boolean) {
    const branchId = this.branchOf(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p.organization_id = ${t.organizationId}::uuid`,
      Prisma.sql`p.deleted_at IS NULL`,
    ];
    if (q.q)
      conditions.push(
        Prisma.sql`(p.name ILIKE ${likePattern(q.q)} OR p.sku ILIKE ${likePattern(q.q)})`,
      );
    if (q.categoryId) {
      const catIds = await this.categoryTreeIds(t.organizationId, q.categoryId);
      conditions.push(
        Prisma.sql`p.category_id IN (${Prisma.join(catIds.map((id) => Prisma.sql`${id}::uuid`))})`,
      );
    }
    if (q.lowStock === 'true') {
      conditions.push(
        Prisma.sql`p.status <> 'DISCONTINUED' AND p.min_stock_level > 0 AND COALESCE(b.quantity_on_hand, 0) <= p.min_stock_level`,
      );
    }
    if (q.inStock === 'true') conditions.push(Prisma.sql`COALESCE(b.quantity_on_hand, 0) > 0`);
    const where = Prisma.join(conditions, ' AND ');
    const from = Prisma.sql`
      FROM products p
      JOIN units_of_measurement u ON u.id = p.base_unit_id
      LEFT JOIN inventory_balances b ON b.product_id = p.id AND b.branch_id = ${branchId}::uuid`;

    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          sku: string;
          name: string;
          type: string;
          status: string;
          base_unit: string;
          min_stock: string;
          track_batch: boolean;
          track_expiry: boolean;
          on_hand: string;
          reserved: string;
          average: string;
        }[]
      >`
        SELECT p.id, p.sku, p.name, p.type::text AS type, p.status::text AS status, u.code AS base_unit,
               p.min_stock_level::text AS min_stock, p.track_batch, p.track_expiry,
               COALESCE(b.quantity_on_hand, 0)::text AS on_hand, COALESCE(b.reserved_qty, 0)::text AS reserved,
               COALESCE(b.average_cost, 0)::text AS average
        ${from}
        WHERE ${where}
        ORDER BY p.name ASC, p.id ASC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n ${from} WHERE ${where}`,
    ]);

    const items = rows.map((r) => {
      const onHand = d(r.on_hand);
      const reserved = d(r.reserved);
      const minStock = d(r.min_stock);
      return {
        productId: r.id,
        sku: r.sku,
        name: r.name,
        type: r.type,
        status: r.status,
        baseUnitCode: r.base_unit,
        quantityOnHand: onHand.toFixed(3),
        reservedQuantity: reserved.toFixed(3),
        availableQuantity: onHand.minus(reserved).toFixed(3),
        minStockLevel: minStock.toFixed(3),
        isLowStock: minStock.gt(0) && onHand.lte(minStock),
        trackBatch: r.track_batch,
        trackExpiry: r.track_expiry,
        ...(includeCost
          ? {
              averageCost: d(r.average).toFixed(4),
              stockValue: stockValue(onHand, d(r.average)).toFixed(2),
            }
          : {}),
      };
    });
    return new Paginated(items, { page, pageSize, total: Number(count[0]?.n ?? 0) });
  }

  /** One product: balance, its batches with expiry status, and the latest movements. */
  async productStock(t: TenantContext, productId: string, includeCost: boolean) {
    const branchId = this.branchOf(t);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: t.organizationId, deletedAt: null },
      select: {
        id: true,
        sku: true,
        name: true,
        minStockLevel: true,
        trackBatch: true,
        trackExpiry: true,
        baseUnit: { select: { code: true } },
      },
    });
    if (!product) throw new AppException('NOT_FOUND', 'Product not found', 404);
    const [balance, batches, movements] = await Promise.all([
      this.prisma.inventoryBalance.findUnique({
        where: { branchId_productId: { branchId, productId } },
      }),
      this.prisma.inventoryBatch.findMany({
        where: { organizationId: t.organizationId, branchId, productId, quantityOnHand: { gt: 0 } },
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
      }),
      this.prisma.stockMovement.findMany({
        where: { organizationId: t.organizationId, branchId, productId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 20,
        include: { batch: { select: { batchNumber: true } } },
      }),
    ]);
    const today = todayInIndia();
    const soon = addDays(today, EXPIRING_SOON_DAYS);
    const onHand = balance ? d(balance.quantityOnHand) : new Decimal(0);
    const average = balance ? d(balance.averageCost) : new Decimal(0);
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      baseUnitCode: product.baseUnit.code,
      quantityOnHand: onHand.toFixed(3),
      availableQuantity: onHand.minus(balance ? d(balance.reservedQty) : 0).toFixed(3),
      minStockLevel: d(product.minStockLevel).toFixed(3),
      isLowStock: d(product.minStockLevel).gt(0) && onHand.lte(d(product.minStockLevel)),
      ...(includeCost
        ? { averageCost: average.toFixed(4), stockValue: stockValue(onHand, average).toFixed(2) }
        : {}),
      batches: batches.map((b) => {
        const expiry = b.expiryDate ? b.expiryDate.toISOString().slice(0, 10) : null;
        return {
          id: b.id,
          batchNumber: b.batchNumber,
          expiryDate: expiry,
          quantity: d(b.quantityOnHand).toFixed(3),
          expiryStatus:
            expiry === null
              ? 'NO_EXPIRY'
              : isExpired(expiry, today)
                ? 'EXPIRED'
                : expiry <= soon
                  ? 'EXPIRING_SOON'
                  : 'OK',
          ...(includeCost ? { unitCost: d(b.unitCost).toFixed(4) } : {}),
        };
      }),
      recentMovements: movements.map((m) => this.movementView(m, includeCost)),
    };
  }

  async movements(t: TenantContext, q: MovementsQuery, includeCost: boolean) {
    const branchId = this.branchOf(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.StockMovementWhereInput = {
      organizationId: t.organizationId,
      branchId,
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.from || q.to ? { occurredAt: timestampRange(q.from, q.to) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          batch: { select: { batchNumber: true } },
          product: { select: { name: true, sku: true } },
          createdBy: { select: { fullName: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return new Paginated(
      rows.map((m) => ({
        ...this.movementView(m, includeCost),
        product: m.product,
        createdBy: m.createdBy.fullName,
      })),
      { page, pageSize, total },
    );
  }

  /** Batches that are expired or expire within N days (default 30), soonest first. */
  async expiring(t: TenantContext, q: ExpiringQuery) {
    const branchId = this.branchOf(t);
    const today = todayInIndia();
    const until = addDays(today, q.withinDays ?? EXPIRING_SOON_DAYS);
    const rows = await this.prisma.inventoryBatch.findMany({
      where: {
        organizationId: t.organizationId,
        branchId,
        quantityOnHand: { gt: 0 },
        expiryDate: { not: null, lte: new Date(`${until}T00:00:00Z`) },
      },
      orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
      include: {
        product: {
          select: { id: true, name: true, sku: true, baseUnit: { select: { code: true } } },
        },
      },
    });
    return rows.map((b) => {
      const expiry = b.expiryDate!.toISOString().slice(0, 10);
      const days = Math.round(
        (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
      );
      return {
        batchId: b.id,
        batchNumber: b.batchNumber,
        expiryDate: expiry,
        daysToExpiry: days,
        isExpired: isExpired(expiry, today),
        quantity: d(b.quantityOnHand).toFixed(3),
        product: {
          id: b.product.id,
          name: b.product.name,
          sku: b.product.sku,
          baseUnitCode: b.product.baseUnit.code,
        },
      };
    });
  }

  /** Stock valuation at moving weighted-average cost, aggregated in the database. */
  async valuation(t: TenantContext) {
    const branchId = this.branchOf(t);
    const [totals, byCategory] = await Promise.all([
      this.prisma.$queryRaw<
        { products_in_stock: bigint; value: string | null; negative_products: bigint }[]
      >`
        SELECT count(*) FILTER (WHERE b.quantity_on_hand > 0) AS products_in_stock,
               COALESCE(round(sum(GREATEST(b.quantity_on_hand, 0) * b.average_cost), 2), 0)::text AS value,
               count(*) FILTER (WHERE b.quantity_on_hand < 0) AS negative_products
        FROM inventory_balances b
        WHERE b.organization_id = ${t.organizationId}::uuid AND b.branch_id = ${branchId}::uuid`,
      this.prisma.$queryRaw<
        { category_id: string | null; category: string | null; value: string }[]
      >`
        SELECT c.id AS category_id, c.name AS category,
               round(sum(GREATEST(b.quantity_on_hand, 0) * b.average_cost), 2)::text AS value
        FROM inventory_balances b
        JOIN products p ON p.id = b.product_id
        LEFT JOIN product_categories c ON c.id = p.category_id
        WHERE b.organization_id = ${t.organizationId}::uuid AND b.branch_id = ${branchId}::uuid AND b.quantity_on_hand > 0
        GROUP BY c.id, c.name
        ORDER BY 3 DESC`,
    ]);
    const row = totals[0]!;
    return {
      method: 'MOVING_WEIGHTED_AVERAGE',
      totalValue: d(row.value ?? '0').toFixed(2),
      productsInStock: Number(row.products_in_stock),
      productsBelowZero: Number(row.negative_products),
      byCategory: byCategory.map((c) => ({
        categoryId: c.category_id,
        category: c.category ?? 'Uncategorised',
        value: d(c.value).toFixed(2),
      })),
    };
  }

  /**
   * Proves the cached balances match the append-only movement history (and batches add up to the balance).
   * Any row returned here is a bug or tampering and must be investigated.
   */
  async reconciliation(t: TenantContext) {
    const branchId = this.branchOf(t);
    const [balanceMismatches, batchMismatches, orphanMovements] = await Promise.all([
      this.prisma.$queryRaw<{ product_id: string; balance: string; movements: string }[]>`
        SELECT b.product_id, b.quantity_on_hand::text AS balance, COALESCE(s.total, 0)::text AS movements
        FROM inventory_balances b
        LEFT JOIN (SELECT product_id, sum(quantity) AS total FROM stock_movements
                   WHERE organization_id = ${t.organizationId}::uuid AND branch_id = ${branchId}::uuid GROUP BY product_id) s
          ON s.product_id = b.product_id
        WHERE b.organization_id = ${t.organizationId}::uuid AND b.branch_id = ${branchId}::uuid
          AND b.quantity_on_hand <> COALESCE(s.total, 0)`,
      this.prisma.$queryRaw<{ batch_id: string; batch: string; movements: string }[]>`
        SELECT ib.id AS batch_id, ib.quantity_on_hand::text AS batch, COALESCE(s.total, 0)::text AS movements
        FROM inventory_batches ib
        LEFT JOIN (SELECT batch_id, sum(quantity) AS total FROM stock_movements
                   WHERE organization_id = ${t.organizationId}::uuid AND branch_id = ${branchId}::uuid AND batch_id IS NOT NULL GROUP BY batch_id) s
          ON s.batch_id = ib.id
        WHERE ib.organization_id = ${t.organizationId}::uuid AND ib.branch_id = ${branchId}::uuid
          AND ib.quantity_on_hand <> COALESCE(s.total, 0)`,
      this.prisma.$queryRaw<{ product_id: string }[]>`
        SELECT DISTINCT m.product_id FROM stock_movements m
        LEFT JOIN inventory_balances b ON b.product_id = m.product_id AND b.branch_id = m.branch_id
        WHERE m.organization_id = ${t.organizationId}::uuid AND m.branch_id = ${branchId}::uuid AND b.id IS NULL`,
    ]);
    return {
      consistent: balanceMismatches.length + batchMismatches.length + orphanMovements.length === 0,
      balanceMismatches: balanceMismatches.map((r) => ({
        productId: r.product_id,
        balance: d(r.balance).toFixed(3),
        sumOfMovements: d(r.movements).toFixed(3),
      })),
      batchMismatches: batchMismatches.map((r) => ({
        batchId: r.batch_id,
        batchQuantity: d(r.batch).toFixed(3),
        sumOfMovements: d(r.movements).toFixed(3),
      })),
      movementsWithoutBalance: orphanMovements.map((r) => r.product_id),
    };
  }

  private movementView(
    m: {
      id: string;
      type: string;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      balanceAfter: Prisma.Decimal;
      referenceType: string;
      referenceId: string;
      reason: string | null;
      occurredAt: Date;
      batchId: string | null;
      batch: { batchNumber: string } | null;
    },
    includeCost: boolean,
  ) {
    return {
      id: m.id,
      type: m.type,
      quantity: d(m.quantity).toFixed(3),
      balanceAfter: d(m.balanceAfter).toFixed(3),
      batchId: m.batchId,
      batchNumber: m.batch?.batchNumber ?? null,
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      reason: m.reason,
      occurredAt: m.occurredAt,
      ...(includeCost ? { unitCost: d(m.unitCost).toFixed(4) } : {}),
    };
  }
}
