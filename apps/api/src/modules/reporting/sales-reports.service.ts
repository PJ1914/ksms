import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { Paginated } from '../../common/pagination/paginated';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import {
  dec,
  money,
  percentOf,
  quantity,
  ReportRange,
  resolveRange,
  sumOf,
} from './domain/report-math';
import type { SalesBreakdownQuery, SalesSummaryQuery } from './reporting.dto';

export const branchOf = (t: TenantContext): string => {
  if (!t.branchId) throw new AppException('BRANCH_REQUIRED', 'x-branch-id header is required', 400);
  return t.branchId;
};

const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamptz`;

/**
 * The lines behind every sales figure, as one source so reports cannot disagree:
 *  - each line of a COMPLETED bill sold in the period adds its price before GST (`net`) and its cost;
 *  - each line returned in the period takes the same away (cost only comes back for SALEABLE goods: damaged or
 *    expired goods are a real loss and stay in the cost).
 * Cost per line is rounded to the paisa, so sums at any level add up exactly.
 */
export const saleLines = (organizationId: string, branchId: string, r: ReportRange) => Prisma.sql`
  SELECT si.product_id, si.base_quantity AS qty, si.taxable_value AS net,
         round(si.unit_cost_snapshot * si.base_quantity, 2) AS cogs
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
  WHERE s.organization_id = ${organizationId}::uuid AND s.branch_id = ${branchId}::uuid
    AND s.status = 'COMPLETED' AND s.sold_at >= ${ts(r.fromTs)} AND s.sold_at < ${ts(r.toTs)}
  UNION ALL
  SELECT ri.product_id, -ri.base_quantity, -(ri.line_total - ri.tax_amount),
         -(CASE WHEN ri.disposition = 'SALEABLE' THEN round(ri.unit_cost_snapshot * ri.base_quantity, 2) ELSE 0 END)
  FROM sale_return_items ri
  JOIN sale_returns rt ON rt.id = ri.return_id
  JOIN sales s ON s.id = rt.sale_id
  WHERE rt.organization_id = ${organizationId}::uuid AND rt.branch_id = ${branchId}::uuid
    AND s.status = 'COMPLETED' AND rt.created_at >= ${ts(r.fromTs)} AND rt.created_at < ${ts(r.toTs)}`;

interface SalesRow {
  bucket: string;
  bills: number;
  subtotal: string;
  discount: string;
  taxable: string;
  tax: string;
  round_off: string;
  total: string;
  credit: string;
}
interface ReturnsRow {
  bucket: string;
  returns: number;
  total: string;
  taxable: string;
  tax: string;
}

/** Sales reports: all read-only, scoped to the caller's shop AND branch. Cancelled bills are left out. */
@Injectable()
export class SalesReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sales by day, week (Monday) or month. Definitions (also in docs/architecture/REPORTING.md):
   *  - billValue: what customers were billed (after discount, with GST and round-off);
   *  - netSales: revenue = price before GST of the bills, less the price before GST of goods returned in the period.
   */
  async summary(t: TenantContext, q: SalesSummaryQuery) {
    const branchId = branchOf(t);
    const r = resolveRange(q.from, q.to);
    const unit = q.groupBy ?? 'day';

    const [sales, returns] = await Promise.all([
      this.prisma.$queryRaw<SalesRow[]>`
        SELECT (date_trunc(${unit}, s.sold_at AT TIME ZONE 'Asia/Kolkata'))::date::text AS bucket,
               count(*)::int AS bills,
               COALESCE(sum(s.subtotal), 0)::text AS subtotal,
               COALESCE(sum(s.discount_total), 0)::text AS discount,
               COALESCE(sum(s.taxable_total), 0)::text AS taxable,
               COALESCE(sum(s.cgst_total + s.sgst_total + s.igst_total), 0)::text AS tax,
               COALESCE(sum(s.round_off), 0)::text AS round_off,
               COALESCE(sum(s.total), 0)::text AS total,
               COALESCE(sum(s.credit_amount), 0)::text AS credit
        FROM sales s
        WHERE s.organization_id = ${t.organizationId}::uuid AND s.branch_id = ${branchId}::uuid
          AND s.status = 'COMPLETED' AND s.sold_at >= ${ts(r.fromTs)} AND s.sold_at < ${ts(r.toTs)}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<ReturnsRow[]>`
        SELECT (date_trunc(${unit}, rt.created_at AT TIME ZONE 'Asia/Kolkata'))::date::text AS bucket,
               count(*)::int AS returns,
               COALESCE(sum(rt.total), 0)::text AS total,
               COALESCE(sum(rt.subtotal - rt.tax_total), 0)::text AS taxable,
               COALESCE(sum(rt.tax_total), 0)::text AS tax
        FROM sale_returns rt JOIN sales s ON s.id = rt.sale_id
        WHERE rt.organization_id = ${t.organizationId}::uuid AND rt.branch_id = ${branchId}::uuid
          AND s.status = 'COMPLETED' AND rt.created_at >= ${ts(r.fromTs)} AND rt.created_at < ${ts(r.toTs)}
        GROUP BY 1 ORDER BY 1`,
    ]);

    const buckets = new Map<string, { s?: SalesRow; r?: ReturnsRow }>();
    for (const s of sales) buckets.set(s.bucket, { s });
    for (const x of returns) buckets.set(x.bucket, { ...buckets.get(x.bucket), r: x });

    const series = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, { s, r: ret }]) => this.figures(bucket, s, ret));

    const totals = this.figures(
      null,
      {
        bucket: '',
        bills: sales.reduce((n, x) => n + x.bills, 0),
        subtotal: sumOf(sales.map((x) => dec(x.subtotal))).toFixed(2),
        discount: sumOf(sales.map((x) => dec(x.discount))).toFixed(2),
        taxable: sumOf(sales.map((x) => dec(x.taxable))).toFixed(2),
        tax: sumOf(sales.map((x) => dec(x.tax))).toFixed(2),
        round_off: sumOf(sales.map((x) => dec(x.round_off))).toFixed(2),
        total: sumOf(sales.map((x) => dec(x.total))).toFixed(2),
        credit: sumOf(sales.map((x) => dec(x.credit))).toFixed(2),
      },
      {
        bucket: '',
        returns: returns.reduce((n, x) => n + x.returns, 0),
        total: sumOf(returns.map((x) => dec(x.total))).toFixed(2),
        taxable: sumOf(returns.map((x) => dec(x.taxable))).toFixed(2),
        tax: sumOf(returns.map((x) => dec(x.tax))).toFixed(2),
      },
    );

    return { from: r.from, to: r.to, groupBy: unit, totals, series };
  }

  private figures(bucket: string | null, s?: SalesRow, ret?: ReturnsRow) {
    const bills = s?.bills ?? 0;
    const billValue = dec(s?.total);
    const taxable = dec(s?.taxable);
    const returnedTaxable = dec(ret?.taxable);
    return {
      ...(bucket === null ? {} : { date: bucket }),
      bills,
      billValue: money(billValue),
      averageBill: bills === 0 ? '0.00' : money(billValue.div(bills)),
      grossBeforeDiscount: money(s?.subtotal),
      discount: money(s?.discount),
      taxableValue: money(taxable),
      gst: money(s?.tax),
      roundOff: money(s?.round_off),
      creditGiven: money(s?.credit),
      returnsCount: ret?.returns ?? 0,
      returnsValue: money(ret?.total),
      returnedBeforeGst: money(returnedTaxable),
      /** Revenue: price before GST, after discounts and returns. */
      netSales: money(taxable.minus(returnedTaxable)),
    };
  }

  /**
   * Sales split by product, category, customer, payment method or cashier.
   * Product and category are net of returns and can show cost and profit (`includeProfit`); the rest are per bill.
   */
  async breakdown(t: TenantContext, q: SalesBreakdownQuery, includeProfit: boolean) {
    const branchId = branchOf(t);
    const r = resolveRange(q.from, q.to);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    switch (q.by) {
      case 'product':
      case 'category':
        return this.byProductOrCategory(
          t,
          branchId,
          r,
          q.by,
          page,
          pageSize,
          offset,
          includeProfit,
        );
      case 'customer':
        return this.byCustomer(t, branchId, r, page, pageSize, offset);
      case 'payment_method':
        return this.byPaymentMethod(t, branchId, r);
      case 'cashier':
        return this.byCashier(t, branchId, r, page, pageSize, offset);
    }
  }

  private async byProductOrCategory(
    t: TenantContext,
    branchId: string,
    r: ReportRange,
    by: 'product' | 'category',
    page: number,
    pageSize: number,
    offset: number,
    includeProfit: boolean,
  ) {
    const lines = saleLines(t.organizationId, branchId, r);
    const groupKey =
      by === 'product'
        ? Prisma.sql`p.id`
        : Prisma.sql`COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::uuid)`;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        label: string;
        sku: string | null;
        unit: string | null;
        qty: string;
        net: string;
        cogs: string;
      }[]
    >`
      WITH lines AS (${lines})
      SELECT ${groupKey} AS id,
             ${by === 'product' ? Prisma.sql`p.name` : Prisma.sql`COALESCE(c.name, 'No category')`} AS label,
             ${by === 'product' ? Prisma.sql`p.sku` : Prisma.sql`NULL::text`} AS sku,
             ${by === 'product' ? Prisma.sql`u.code` : Prisma.sql`NULL::text`} AS unit,
             sum(l.qty)::text AS qty, sum(l.net)::text AS net, sum(l.cogs)::text AS cogs
      FROM lines l
      JOIN products p ON p.id = l.product_id
      JOIN units_of_measurement u ON u.id = p.base_unit_id
      LEFT JOIN product_categories c ON c.id = p.category_id
      GROUP BY ${groupKey}, 2, 3, 4
      HAVING sum(l.qty) <> 0 OR sum(l.net) <> 0 OR sum(l.cogs) <> 0
      ORDER BY sum(l.net) DESC, 2 ASC, 1 ASC
      LIMIT ${pageSize} OFFSET ${offset}`;
    const totalRows = await this.prisma.$queryRaw<
      { n: number; qty: string; net: string; cogs: string }[]
    >`
      WITH lines AS (${lines}),
      grouped AS (
        SELECT ${groupKey} AS id, sum(l.qty) AS qty, sum(l.net) AS net, sum(l.cogs) AS cogs
        FROM lines l JOIN products p ON p.id = l.product_id
        LEFT JOIN product_categories c ON c.id = p.category_id
        GROUP BY ${groupKey}
        HAVING sum(l.qty) <> 0 OR sum(l.net) <> 0 OR sum(l.cogs) <> 0)
      SELECT count(*)::int AS n, COALESCE(sum(qty), 0)::text AS qty,
             COALESCE(sum(net), 0)::text AS net, COALESCE(sum(cogs), 0)::text AS cogs
      FROM grouped`;
    const tot = totalRows[0]!;
    const NO_CATEGORY = '00000000-0000-0000-0000-000000000000';
    const items = rows.map((x) => ({
      id: x.id === NO_CATEGORY ? null : x.id,
      name: x.label,
      ...(x.sku ? { sku: x.sku } : {}),
      ...(x.unit ? { baseUnit: x.unit } : {}),
      quantity: quantity(x.qty),
      netSales: money(x.net),
      ...(includeProfit ? this.profitFigures(dec(x.net), dec(x.cogs)) : {}),
    }));
    return new Paginated(items, {
      page,
      pageSize,
      total: tot.n,
      by,
      from: r.from,
      to: r.to,
      totals: {
        quantity: quantity(tot.qty),
        netSales: money(tot.net),
        ...(includeProfit ? this.profitFigures(dec(tot.net), dec(tot.cogs)) : {}),
      },
    });
  }

  private profitFigures(net: Decimal, cogs: Decimal) {
    const profit = net.minus(cogs);
    return {
      costOfGoods: money(cogs),
      grossProfit: money(profit),
      marginPercent: percentOf(profit, net),
    };
  }

  private async byCustomer(
    t: TenantContext,
    branchId: string,
    r: ReportRange,
    page: number,
    pageSize: number,
    offset: number,
  ) {
    const where = Prisma.sql`s.organization_id = ${t.organizationId}::uuid AND s.branch_id = ${branchId}::uuid
      AND s.status = 'COMPLETED' AND s.sold_at >= ${ts(r.fromTs)} AND s.sold_at < ${ts(r.toTs)}`;
    const [rows, tot] = await Promise.all([
      this.prisma.$queryRaw<
        { id: string | null; name: string | null; bills: number; total: string; credit: string }[]
      >`
        SELECT s.customer_id AS id, c.name, count(*)::int AS bills,
               sum(s.total)::text AS total, sum(s.credit_amount)::text AS credit
        FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE ${where}
        GROUP BY s.customer_id, c.name
        ORDER BY sum(s.total) DESC, c.name ASC NULLS LAST, s.customer_id ASC NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ n: number; bills: number; total: string; credit: string }[]>`
        SELECT count(DISTINCT s.customer_id)::int + (CASE WHEN bool_or(s.customer_id IS NULL) THEN 1 ELSE 0 END) AS n,
               count(*)::int AS bills, COALESCE(sum(s.total), 0)::text AS total,
               COALESCE(sum(s.credit_amount), 0)::text AS credit
        FROM sales s WHERE ${where}`,
    ]);
    const x = tot[0]!;
    return new Paginated(
      rows.map((c) => ({
        id: c.id,
        name: c.name ?? 'Walk-in customers',
        bills: c.bills,
        billValue: money(c.total),
        creditGiven: money(c.credit),
      })),
      {
        page,
        pageSize,
        total: x.n ?? 0,
        by: 'customer',
        from: r.from,
        to: r.to,
        totals: { bills: x.bills, billValue: money(x.total), creditGiven: money(x.credit) },
      },
    );
  }

  /** What the bills were paid with, plus what was left on credit. Together they equal the bill value. */
  private async byPaymentMethod(t: TenantContext, branchId: string, r: ReportRange) {
    const [paid, credit] = await Promise.all([
      this.prisma.$queryRaw<{ method: string; n: number; amount: string }[]>`
        SELECT p.method::text AS method, count(*)::int AS n, sum(sp.amount)::text AS amount
        FROM sale_payments sp
        JOIN payments p ON p.id = sp.payment_id
        JOIN sales s ON s.id = sp.sale_id
        WHERE s.organization_id = ${t.organizationId}::uuid AND s.branch_id = ${branchId}::uuid
          AND s.status = 'COMPLETED' AND s.sold_at >= ${ts(r.fromTs)} AND s.sold_at < ${ts(r.toTs)}
        GROUP BY p.method ORDER BY sum(sp.amount) DESC, p.method ASC`,
      this.prisma.$queryRaw<{ n: number; amount: string }[]>`
        SELECT count(*) FILTER (WHERE s.credit_amount > 0)::int AS n,
               COALESCE(sum(s.credit_amount), 0)::text AS amount
        FROM sales s
        WHERE s.organization_id = ${t.organizationId}::uuid AND s.branch_id = ${branchId}::uuid
          AND s.status = 'COMPLETED' AND s.sold_at >= ${ts(r.fromTs)} AND s.sold_at < ${ts(r.toTs)}`,
    ]);
    const items = [
      ...paid.map((x) => ({ method: x.method, bills: x.n, amount: money(x.amount) })),
      { method: 'CREDIT', bills: credit[0]?.n ?? 0, amount: money(credit[0]?.amount) },
    ];
    const total = sumOf(items.map((i) => dec(i.amount)));
    // A short list (one row per payment mode plus credit) is always shown whole.
    return new Paginated(items, {
      page: 1,
      pageSize: items.length,
      total: items.length,
      by: 'payment_method',
      from: r.from,
      to: r.to,
      totals: { billValue: money(total) },
    });
  }

  private async byCashier(
    t: TenantContext,
    branchId: string,
    r: ReportRange,
    page: number,
    pageSize: number,
    offset: number,
  ) {
    const where = Prisma.sql`s.organization_id = ${t.organizationId}::uuid AND s.branch_id = ${branchId}::uuid
      AND s.status = 'COMPLETED' AND s.sold_at >= ${ts(r.fromTs)} AND s.sold_at < ${ts(r.toTs)}`;
    const [rows, tot] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; name: string; bills: number; total: string }[]>`
        SELECT u.id, u.full_name AS name, count(*)::int AS bills, sum(s.total)::text AS total
        FROM sales s JOIN users u ON u.id = s.sold_by_id
        WHERE ${where}
        GROUP BY u.id, u.full_name
        ORDER BY sum(s.total) DESC, u.full_name ASC, u.id ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ n: number; bills: number; total: string }[]>`
        SELECT count(DISTINCT s.sold_by_id)::int AS n, count(*)::int AS bills,
               COALESCE(sum(s.total), 0)::text AS total
        FROM sales s WHERE ${where}`,
    ]);
    const x = tot[0]!;
    return new Paginated(
      rows.map((c) => ({ id: c.id, name: c.name, bills: c.bills, billValue: money(c.total) })),
      {
        page,
        pageSize,
        total: x.n,
        by: 'cashier',
        from: r.from,
        to: r.to,
        totals: { bills: x.bills, billValue: money(x.total) },
      },
    );
  }
}
