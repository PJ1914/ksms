import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/auth/auth.types';
import { Paginated } from '../../common/pagination/paginated';
import { PrismaService } from '../../database/prisma.service';
import { dec, money, resolveRange, sumOf } from './domain/report-math';
import type { PurchasesBreakdownQuery, SalesSummaryQuery } from './reporting.dto';
import { branchOf } from './sales-reports.service';

interface PurchaseRow {
  bucket: string;
  orders: number;
  billed: string;
  returned: string;
  tax: string;
}

/**
 * Purchase reports. A purchase counts once it is confirmed (not a draft, not cancelled), on its purchase date.
 *  - billed: what the supplier is owed for the goods received so far;
 *  - returned: credit given back through purchase returns;
 *  - net: billed less returned.
 */
@Injectable()
export class PurchaseReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(t: TenantContext, q: SalesSummaryQuery) {
    const branchId = branchOf(t);
    const r = resolveRange(q.from, q.to);
    const unit = q.groupBy ?? 'day';
    const rows = await this.prisma.$queryRaw<PurchaseRow[]>`
      SELECT (date_trunc(${unit}, p.purchase_date::timestamp))::date::text AS bucket,
             count(*)::int AS orders,
             COALESCE(sum(p.billed_total), 0)::text AS billed,
             COALESCE(sum(p.returned_total), 0)::text AS returned,
             COALESCE(sum(p.tax_total), 0)::text AS tax
      FROM purchases p
      WHERE p.organization_id = ${t.organizationId}::uuid AND p.branch_id = ${branchId}::uuid
        AND p.status NOT IN ('DRAFT', 'CANCELLED')
        AND p.purchase_date >= ${r.from}::date AND p.purchase_date <= ${r.to}::date
      GROUP BY 1 ORDER BY 1`;
    const fig = (bucket: string | null, x: PurchaseRow[]) => {
      const billed = sumOf(x.map((y) => dec(y.billed)));
      const returned = sumOf(x.map((y) => dec(y.returned)));
      return {
        ...(bucket === null ? {} : { date: bucket }),
        orders: x.reduce((n, y) => n + y.orders, 0),
        billed: money(billed),
        returned: money(returned),
        net: money(billed.minus(returned)),
      };
    };
    return {
      from: r.from,
      to: r.to,
      groupBy: unit,
      totals: fig(null, rows),
      series: rows.map((x) => fig(x.bucket, [x])),
    };
  }

  async bySupplier(t: TenantContext, q: PurchasesBreakdownQuery) {
    const branchId = branchOf(t);
    const r = resolveRange(q.from, q.to);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const [rows, tot] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          name: string;
          orders: number;
          billed: string;
          returned: string;
          owed: string;
        }[]
      >`
        SELECT s.id, s.name, count(*)::int AS orders,
               sum(p.billed_total)::text AS billed, sum(p.returned_total)::text AS returned,
               s.balance::text AS owed
        FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.organization_id = ${t.organizationId}::uuid AND p.branch_id = ${branchId}::uuid
          AND p.status NOT IN ('DRAFT', 'CANCELLED')
          AND p.purchase_date >= ${r.from}::date AND p.purchase_date <= ${r.to}::date
        GROUP BY s.id, s.name, s.balance
        ORDER BY sum(p.billed_total - p.returned_total) DESC, s.name ASC, s.id ASC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ n: number; orders: number; billed: string; returned: string }[]>`
        SELECT count(DISTINCT p.supplier_id)::int AS n, count(*)::int AS orders,
               COALESCE(sum(p.billed_total), 0)::text AS billed,
               COALESCE(sum(p.returned_total), 0)::text AS returned
        FROM purchases p
        WHERE p.organization_id = ${t.organizationId}::uuid AND p.branch_id = ${branchId}::uuid
          AND p.status NOT IN ('DRAFT', 'CANCELLED')
          AND p.purchase_date >= ${r.from}::date AND p.purchase_date <= ${r.to}::date`,
    ]);
    const x = tot[0]!;
    return new Paginated(
      rows.map((s) => ({
        supplierId: s.id,
        name: s.name,
        orders: s.orders,
        billed: money(s.billed),
        returned: money(s.returned),
        net: money(dec(s.billed).minus(dec(s.returned))),
        /** What the shop owes this supplier now (all branches, all time). */
        owedNow: money(s.owed),
      })),
      {
        page,
        pageSize,
        total: x.n,
        by: 'supplier',
        from: r.from,
        to: r.to,
        totals: {
          orders: x.orders,
          billed: money(x.billed),
          returned: money(x.returned),
          net: money(dec(x.billed).minus(dec(x.returned))),
        },
      },
    );
  }
}
