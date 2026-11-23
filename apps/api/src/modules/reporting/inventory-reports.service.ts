import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { todayInIndia } from '../../common/utils/dates';
import { addDays, money, quantity, resolveRange } from './domain/report-math';
import type { MoversQuery } from './reporting.dto';
import { branchOf, saleLines } from './sales-reports.service';

/** How soon counts as "expiring soon". Same as the stock screens. */
const EXPIRING_SOON_DAYS = 30;

/** Inventory reports: what the stock is worth, what is running out or expiring, and what sells fast or slow. */
@Injectable()
export class InventoryReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stock position of the branch today. Value is at the moving average cost, the same figure as
   * `GET /inventory/valuation`. The expiry exposure is valued at each batch's own cost.
   */
  async summary(t: TenantContext) {
    const branchId = branchOf(t);
    const today = todayInIndia();
    const soon = addDays(today, EXPIRING_SOON_DAYS);

    const [stock, worth, expiry, byCategory] = await Promise.all([
      this.prisma.$queryRaw<{ out_of_stock: number; low: number }[]>`
        SELECT count(*) FILTER (WHERE COALESCE(b.quantity_on_hand, 0) <= 0)::int AS out_of_stock,
               count(*) FILTER (WHERE p.min_stock_level > 0 AND COALESCE(b.quantity_on_hand, 0) <= p.min_stock_level)::int AS low
        FROM products p
        LEFT JOIN inventory_balances b ON b.product_id = p.id AND b.branch_id = ${branchId}::uuid
        WHERE p.organization_id = ${t.organizationId}::uuid AND p.deleted_at IS NULL AND p.status <> 'DISCONTINUED'`,
      // The value counts every product with stock (even switched-off ones), exactly like GET /inventory/valuation.
      this.prisma.$queryRaw<{ value: string; in_stock: number }[]>`
        SELECT COALESCE(round(sum(GREATEST(quantity_on_hand, 0) * average_cost), 2), 0)::text AS value,
               count(*) FILTER (WHERE quantity_on_hand > 0)::int AS in_stock
        FROM inventory_balances
        WHERE organization_id = ${t.organizationId}::uuid AND branch_id = ${branchId}::uuid`,
      this.prisma.$queryRaw<
        { expired_n: number; expired_value: string; soon_n: number; soon_value: string }[]
      >`
        SELECT count(*) FILTER (WHERE expiry_date < ${today}::date)::int AS expired_n,
               COALESCE(round(sum(quantity_on_hand * unit_cost) FILTER (WHERE expiry_date < ${today}::date), 2), 0)::text AS expired_value,
               count(*) FILTER (WHERE expiry_date >= ${today}::date AND expiry_date <= ${soon}::date)::int AS soon_n,
               COALESCE(round(sum(quantity_on_hand * unit_cost) FILTER (WHERE expiry_date >= ${today}::date AND expiry_date <= ${soon}::date), 2), 0)::text AS soon_value
        FROM inventory_batches
        WHERE organization_id = ${t.organizationId}::uuid AND branch_id = ${branchId}::uuid
          AND quantity_on_hand > 0 AND expiry_date IS NOT NULL`,
      this.prisma.$queryRaw<{ id: string | null; name: string | null; value: string }[]>`
        SELECT c.id, c.name,
               round(sum(b.quantity_on_hand * b.average_cost), 2)::text AS value
        FROM inventory_balances b
        JOIN products p ON p.id = b.product_id
        LEFT JOIN product_categories c ON c.id = p.category_id
        WHERE b.organization_id = ${t.organizationId}::uuid AND b.branch_id = ${branchId}::uuid
          AND b.quantity_on_hand > 0
        GROUP BY c.id, c.name
        ORDER BY sum(b.quantity_on_hand * b.average_cost) DESC, c.name ASC NULLS LAST`,
    ]);
    const s = stock[0]!;
    const e = expiry[0]!;
    return {
      asOf: today,
      method: 'MOVING_WEIGHTED_AVERAGE',
      stockValue: money(worth[0]?.value),
      productsInStock: worth[0]?.in_stock ?? 0,
      productsOutOfStock: s.out_of_stock,
      lowStockProducts: s.low,
      expired: { batches: e.expired_n, value: money(e.expired_value) },
      expiringSoon: {
        withinDays: EXPIRING_SOON_DAYS,
        batches: e.soon_n,
        value: money(e.soon_value),
      },
      byCategory: byCategory.map((c) => ({
        categoryId: c.id,
        category: c.name ?? 'No category',
        value: money(c.value),
      })),
    };
  }

  /**
   * Fast movers: the most sold in the last N days. Slow movers: stock on the shelf that sold the least, with what is
   * tied up in it. Sold quantity is net of returns.
   */
  async movers(t: TenantContext, q: MoversQuery) {
    const branchId = branchOf(t);
    const days = q.days ?? 30;
    const limit = q.limit ?? 20;
    const today = todayInIndia();
    const r = resolveRange(addDays(today, -(days - 1)), today);
    const lines = saleLines(t.organizationId, branchId, r);
    const order =
      q.kind === 'fast'
        ? Prisma.sql`ORDER BY sold DESC, p.name ASC, p.id ASC`
        : Prisma.sql`ORDER BY sold ASC, value DESC, p.name ASC, p.id ASC`;
    const having = q.kind === 'fast' ? Prisma.sql`WHERE sold > 0` : Prisma.sql`WHERE on_hand > 0`;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        sku: string;
        name: string;
        unit: string;
        sold: string;
        on_hand: string;
        value: string;
      }[]
    >`
      WITH lines AS (${lines}),
      sold AS (SELECT product_id, sum(qty) AS qty FROM lines GROUP BY product_id)
      SELECT * FROM (
        SELECT p.id, p.sku, p.name, u.code AS unit,
               COALESCE(sd.qty, 0) AS sold,
               COALESCE(b.quantity_on_hand, 0) AS on_hand,
               GREATEST(COALESCE(b.quantity_on_hand, 0), 0) * COALESCE(b.average_cost, 0) AS value
        FROM products p
        JOIN units_of_measurement u ON u.id = p.base_unit_id
        LEFT JOIN sold sd ON sd.product_id = p.id
        LEFT JOIN inventory_balances b ON b.product_id = p.id AND b.branch_id = ${branchId}::uuid
        WHERE p.organization_id = ${t.organizationId}::uuid AND p.deleted_at IS NULL
          AND p.status <> 'DISCONTINUED'
      ) p ${having} ${order}
      LIMIT ${limit}`;
    return {
      kind: q.kind,
      days,
      from: r.from,
      to: r.to,
      items: rows.map((x) => ({
        productId: x.id,
        sku: x.sku,
        name: x.name,
        baseUnit: x.unit,
        soldQuantity: quantity(x.sold),
        quantityOnHand: quantity(x.on_hand),
        stockValue: money(x.value),
      })),
    };
  }
}
