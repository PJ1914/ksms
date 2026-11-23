import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/auth/auth.types';
import { Paginated } from '../../common/pagination/paginated';
import { todayInIndia } from '../../common/utils/dates';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { dec, money, percentOf, resolveRange, sumOf, type ReportRange } from './domain/report-math';
import type { DayBookQuery, OutstandingQuery, PagedRangeQuery, RangeQuery } from './reporting.dto';
import { branchOf, saleLines } from './sales-reports.service';

const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamptz`;

/**
 * Money reports. Four different things are kept apart and named so they are never mixed up:
 *  - revenue (netSales): what was sold, before GST, after discounts and returns;
 *  - gross profit (estimate): revenue less the cost of the goods sold;
 *  - net profit (estimate): gross profit less expenses and stock written off;
 *  - cash flow: money that actually moved in the cash book, whatever it was for.
 */
@Injectable()
export class FinanceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Profit and loss for a period. Profits are estimates: cost is the moving average cost when the goods were sold. */
  async profitAndLoss(t: TenantContext, q: RangeQuery) {
    const branchId = branchOf(t);
    const r = resolveRange(q.from, q.to);
    const [sold, expenses, byCategory, writeOffs] = await Promise.all([
      this.prisma.$queryRaw<{ net: string; cogs: string }[]>`
        WITH lines AS (${saleLines(t.organizationId, branchId, r)})
        SELECT COALESCE(sum(net), 0)::text AS net, COALESCE(sum(cogs), 0)::text AS cogs FROM lines`,
      this.prisma.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(sum(e.amount), 0)::text AS total FROM expenses e
        WHERE e.organization_id = ${t.organizationId}::uuid AND e.branch_id = ${branchId}::uuid
          AND e.cancelled_at IS NULL AND e.expense_date >= ${r.from}::date AND e.expense_date <= ${r.to}::date`,
      this.prisma.$queryRaw<{ id: string; name: string; total: string }[]>`
        SELECT c.id, c.name, sum(e.amount)::text AS total
        FROM expenses e JOIN expense_categories c ON c.id = e.category_id
        WHERE e.organization_id = ${t.organizationId}::uuid AND e.branch_id = ${branchId}::uuid
          AND e.cancelled_at IS NULL AND e.expense_date >= ${r.from}::date AND e.expense_date <= ${r.to}::date
        GROUP BY c.id, c.name ORDER BY sum(e.amount) DESC, c.name ASC`,
      this.writtenOff(t.organizationId, branchId, r),
    ]);

    const revenue = dec(sold[0]?.net);
    const cogs = dec(sold[0]?.cogs);
    const grossProfit = revenue.minus(cogs);
    const expenseTotal = dec(expenses[0]?.total);
    const writeOff = dec(writeOffs);
    const netProfit = grossProfit.minus(expenseTotal).minus(writeOff);
    return {
      from: r.from,
      to: r.to,
      isEstimate: true,
      /** Revenue: sales before GST, after discounts and returns. Not the money received. */
      revenue: money(revenue),
      costOfGoodsSold: money(cogs),
      grossProfit: money(grossProfit),
      grossMarginPercent: percentOf(grossProfit, revenue),
      expenses: {
        total: money(expenseTotal),
        byCategory: byCategory.map((c) => ({
          categoryId: c.id,
          name: c.name,
          total: money(c.total),
        })),
      },
      /** Stock lost to damage, expiry and count corrections, less stock found, at cost. */
      stockWrittenOff: money(writeOff),
      netProfit: money(netProfit),
      netMarginPercent: percentOf(netProfit, revenue),
    };
  }

  /** Cost of stock written off in the period: damage, expiry and adjustments (net of stock found). */
  private async writtenOff(organizationId: string, branchId: string, r: ReportRange) {
    const rows = await this.prisma.$queryRaw<{ lost: string }[]>`
      SELECT COALESCE(-sum(round(m.quantity * m.unit_cost, 2)), 0)::text AS lost
      FROM stock_movements m
      WHERE m.organization_id = ${organizationId}::uuid AND m.branch_id = ${branchId}::uuid
        AND m.type IN ('DAMAGE', 'EXPIRY', 'ADJUSTMENT_OUT', 'ADJUSTMENT_IN')
        AND m.occurred_at >= ${ts(r.fromTs)} AND m.occurred_at < ${ts(r.toTs)}`;
    return rows[0]?.lost ?? '0';
  }

  /** Cash book movements for the period: money in and out by payment mode and by kind, and the closing differences. */
  async cashFlow(t: TenantContext, q: RangeQuery) {
    const branchId = branchOf(t);
    const r = resolveRange(q.from, q.to);
    const scope = Prisma.sql`c.organization_id = ${t.organizationId}::uuid AND c.branch_id = ${branchId}::uuid
      AND c.business_date >= ${r.from}::date AND c.business_date <= ${r.to}::date`;
    const [byMethod, byKind, daily, closings] = await Promise.all([
      this.prisma.$queryRaw<{ method: string; money_in: string; money_out: string }[]>`
        SELECT c.method::text AS method,
               COALESCE(sum(c.amount) FILTER (WHERE c.amount > 0), 0)::text AS money_in,
               COALESCE(-sum(c.amount) FILTER (WHERE c.amount < 0), 0)::text AS money_out
        FROM cashbook_entries c WHERE ${scope} GROUP BY c.method ORDER BY c.method`,
      this.prisma.$queryRaw<{ kind: string; money_in: string; money_out: string }[]>`
        SELECT c.kind::text AS kind,
               COALESCE(sum(c.amount) FILTER (WHERE c.amount > 0), 0)::text AS money_in,
               COALESCE(-sum(c.amount) FILTER (WHERE c.amount < 0), 0)::text AS money_out
        FROM cashbook_entries c WHERE ${scope} GROUP BY c.kind ORDER BY c.kind`,
      this.prisma.$queryRaw<{ day: string; money_in: string; money_out: string }[]>`
        SELECT c.business_date::text AS day,
               COALESCE(sum(c.amount) FILTER (WHERE c.amount > 0), 0)::text AS money_in,
               COALESCE(-sum(c.amount) FILTER (WHERE c.amount < 0), 0)::text AS money_out
        FROM cashbook_entries c WHERE ${scope} GROUP BY c.business_date ORDER BY c.business_date`,
      this.prisma.$queryRaw<{ days: number; difference: string }[]>`
        SELECT count(*)::int AS days, COALESCE(sum(d.difference), 0)::text AS difference
        FROM daily_closings d
        WHERE d.organization_id = ${t.organizationId}::uuid AND d.branch_id = ${branchId}::uuid
          AND d.status = 'CLOSED'
          AND d.business_date >= ${r.from}::date AND d.business_date <= ${r.to}::date`,
    ]);
    const flow = (x: { money_in: string; money_out: string }) => ({
      moneyIn: money(x.money_in),
      moneyOut: money(x.money_out),
      net: money(dec(x.money_in).minus(dec(x.money_out))),
    });
    const totalIn = sumOf(byMethod.map((x) => dec(x.money_in)));
    const totalOut = sumOf(byMethod.map((x) => dec(x.money_out)));
    return {
      from: r.from,
      to: r.to,
      totals: flow({ money_in: totalIn.toFixed(2), money_out: totalOut.toFixed(2) }),
      byMethod: byMethod.map((x) => ({ method: x.method, ...flow(x) })),
      byKind: byKind.map((x) => ({ kind: x.kind, ...flow(x) })),
      daily: daily.map((x) => ({ date: x.day, ...flow(x) })),
      closings: {
        daysClosed: closings[0]?.days ?? 0,
        /** Counted cash less expected cash over the closed days (negative = cash was short). */
        cashDifference: money(closings[0]?.difference),
      },
    };
  }

  /**
   * Money owed. Customers owe the shop (khata); the shop owes suppliers. Both are for the whole shop, not one
   * branch, because customers and suppliers belong to the shop.
   */
  async outstanding(t: TenantContext, q: OutstandingQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const offset = (page - 1) * pageSize;
    const org = t.organizationId;
    const [custTot, suppTot] = await Promise.all([
      this.prisma.$queryRaw<{ owing: number; due: string; advances: string }[]>`
        SELECT count(*) FILTER (WHERE balance > 0)::int AS owing,
               COALESCE(sum(balance) FILTER (WHERE balance > 0), 0)::text AS due,
               COALESCE(-sum(balance) FILTER (WHERE balance < 0), 0)::text AS advances
        FROM customers WHERE organization_id = ${org}::uuid AND deleted_at IS NULL`,
      this.prisma.$queryRaw<{ owed: number; payable: string; advances: string }[]>`
        SELECT count(*) FILTER (WHERE balance > 0)::int AS owed,
               COALESCE(sum(balance) FILTER (WHERE balance > 0), 0)::text AS payable,
               COALESCE(-sum(balance) FILTER (WHERE balance < 0), 0)::text AS advances
        FROM suppliers WHERE organization_id = ${org}::uuid AND deleted_at IS NULL`,
    ]);
    const summary = {
      customers: {
        owing: custTot[0]?.owing ?? 0,
        totalDue: money(custTot[0]?.due),
        advances: money(custTot[0]?.advances),
      },
      suppliers: {
        owed: suppTot[0]?.owed ?? 0,
        totalPayable: money(suppTot[0]?.payable),
        advances: money(suppTot[0]?.advances),
      },
    };

    if (q.party === 'customers') {
      const rows = await this.prisma.$queryRaw<
        {
          id: string;
          name: string;
          phone: string | null;
          balance: string;
          last_paid: Date | null;
          limit: string | null;
        }[]
      >`
        SELECT c.id, c.name, c.phone, c.balance::text AS balance, c.credit_limit::text AS "limit",
               (SELECT max(py.paid_at) FROM payments py
                 WHERE py.organization_id = c.organization_id AND py.customer_id = c.id
                   AND py.purpose = 'CUSTOMER_COLLECTION' AND py.direction = 'IN'
                   AND py.status = 'COMPLETED') AS last_paid
        FROM customers c
        WHERE c.organization_id = ${org}::uuid AND c.deleted_at IS NULL AND c.balance > 0
        ORDER BY c.balance DESC, c.name ASC, c.id ASC
        LIMIT ${pageSize} OFFSET ${offset}`;
      return new Paginated(
        rows.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          due: money(c.balance),
          creditLimit: c.limit === null ? null : money(c.limit),
          lastPaymentAt: c.last_paid ? c.last_paid.toISOString() : null,
        })),
        { page, pageSize, total: summary.customers.owing, party: 'customers', summary },
      );
    }
    const rows = await this.prisma.$queryRaw<
      { id: string; name: string; phone: string | null; balance: string }[]
    >`
      SELECT s.id, s.name, s.phone, s.balance::text AS balance FROM suppliers s
      WHERE s.organization_id = ${org}::uuid AND s.deleted_at IS NULL AND s.balance > 0
      ORDER BY s.balance DESC, s.name ASC, s.id ASC
      LIMIT ${pageSize} OFFSET ${offset}`;
    return new Paginated(
      rows.map((s) => ({ id: s.id, name: s.name, phone: s.phone, payable: money(s.balance) })),
      { page, pageSize, total: summary.suppliers.owed, party: 'suppliers', summary },
    );
  }

  /**
   * Khata collections by agent and by day. Every khata payment counts, including ones taken at the counter with no
   * agent (shown as "Shop counter"), so this always agrees with the cash book. Reversed receipts are not counted.
   */
  async collections(t: TenantContext, q: PagedRangeQuery) {
    const branchId = branchOf(t);
    const r = resolveRange(q.from, q.to);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const from = Prisma.sql`
      FROM payments p
      LEFT JOIN collection_records cr ON cr.payment_id = p.id
      LEFT JOIN collection_agents a ON a.id = cr.agent_id`;
    const where = Prisma.sql`p.organization_id = ${t.organizationId}::uuid AND p.branch_id = ${branchId}::uuid
      AND p.purpose = 'CUSTOMER_COLLECTION' AND p.direction = 'IN' AND p.status = 'COMPLETED'
      AND COALESCE(cr.collected_at, p.paid_at) >= ${ts(r.fromTs)}
      AND COALESCE(cr.collected_at, p.paid_at) < ${ts(r.toTs)}`;
    const [byAgent, daily, tot, agents] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string | null;
          name: string | null;
          receipts: number;
          amount: string;
          customers: number;
        }[]
      >`
        SELECT a.id, a.name, count(*)::int AS receipts, sum(p.amount)::text AS amount,
               count(DISTINCT p.customer_id)::int AS customers
        ${from} WHERE ${where}
        GROUP BY a.id, a.name
        ORDER BY sum(p.amount) DESC, a.name ASC NULLS LAST, a.id ASC NULLS LAST
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ day: string; receipts: number; amount: string }[]>`
        SELECT (COALESCE(cr.collected_at, p.paid_at) AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
               count(*)::int AS receipts, sum(p.amount)::text AS amount
        ${from} WHERE ${where} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ receipts: number; amount: string; customers: number }[]>`
        SELECT count(*)::int AS receipts, COALESCE(sum(p.amount), 0)::text AS amount,
               count(DISTINCT p.customer_id)::int AS customers
        ${from} WHERE ${where}`,
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(DISTINCT COALESCE(cr.agent_id, '00000000-0000-0000-0000-000000000000'::uuid))::int AS n
        ${from} WHERE ${where}`,
    ]);
    const x = tot[0]!;
    return new Paginated(
      byAgent.map((a) => ({
        agentId: a.id,
        name: a.name ?? 'Shop counter',
        receipts: a.receipts,
        customers: a.customers,
        collected: money(a.amount),
      })),
      {
        page,
        pageSize,
        total: agents[0]?.n ?? 0,
        from: r.from,
        to: r.to,
        totals: { receipts: x.receipts, customers: x.customers, collected: money(x.amount) },
        daily: daily.map((d) => ({
          date: d.day,
          receipts: d.receipts,
          collected: money(d.amount),
        })),
      },
    );
  }

  /**
   * Everything that happened in the shop on one day, oldest first: bills, returns, purchases, goods sent back to
   * suppliers, khata collections (with or without an agent), supplier payments and expenses. Reversed or cancelled items are left out.
   */
  async dayBook(t: TenantContext, q: DayBookQuery) {
    const branchId = branchOf(t);
    const date = q.date ?? todayInIndia();
    const r = resolveRange(date, date);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 100;
    const org = t.organizationId;
    const rowsSql = Prisma.sql`
      SELECT 'SALE' AS kind, s.sold_at AS at, s.sale_number AS reference, COALESCE(c.name, 'Walk-in') AS party,
             s.total AS amount, 1 AS ord
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.organization_id = ${org}::uuid AND s.branch_id = ${branchId}::uuid AND s.status = 'COMPLETED'
        AND s.sold_at >= ${ts(r.fromTs)} AND s.sold_at < ${ts(r.toTs)}
      UNION ALL
      SELECT 'SALE_RETURN', rt.created_at, rt.return_number, COALESCE(c.name, 'Walk-in'), rt.total, 2
      FROM sale_returns rt JOIN sales s ON s.id = rt.sale_id LEFT JOIN customers c ON c.id = s.customer_id
      WHERE rt.organization_id = ${org}::uuid AND rt.branch_id = ${branchId}::uuid
        AND rt.created_at >= ${ts(r.fromTs)} AND rt.created_at < ${ts(r.toTs)}
      UNION ALL
      SELECT 'PURCHASE', p.created_at, p.purchase_number, sp.name, p.billed_total, 3
      FROM purchases p JOIN suppliers sp ON sp.id = p.supplier_id
      WHERE p.organization_id = ${org}::uuid AND p.branch_id = ${branchId}::uuid
        AND p.status NOT IN ('DRAFT', 'CANCELLED') AND p.purchase_date = ${r.from}::date
      UNION ALL
      SELECT 'COLLECTION', COALESCE(cr.collected_at, py.paid_at), py.receipt_number, c.name, py.amount, 4
      FROM payments py
      LEFT JOIN collection_records cr ON cr.payment_id = py.id
      JOIN customers c ON c.id = py.customer_id
      WHERE py.organization_id = ${org}::uuid AND py.branch_id = ${branchId}::uuid
        AND py.purpose = 'CUSTOMER_COLLECTION' AND py.direction = 'IN' AND py.status = 'COMPLETED'
        AND COALESCE(cr.collected_at, py.paid_at) >= ${ts(r.fromTs)}
        AND COALESCE(cr.collected_at, py.paid_at) < ${ts(r.toTs)}
      UNION ALL
      SELECT 'PURCHASE_RETURN', pr.created_at, pr.return_number, sp.name, pr.total, 3
      FROM purchase_returns pr JOIN suppliers sp ON sp.id = pr.supplier_id
      WHERE pr.organization_id = ${org}::uuid AND pr.branch_id = ${branchId}::uuid
        AND pr.created_at >= ${ts(r.fromTs)} AND pr.created_at < ${ts(r.toTs)}
      UNION ALL
      SELECT 'SUPPLIER_PAYMENT', py.paid_at, py.receipt_number, sp.name, py.amount, 5
      FROM payments py JOIN suppliers sp ON sp.id = py.supplier_id
      WHERE py.organization_id = ${org}::uuid AND py.branch_id = ${branchId}::uuid
        AND py.purpose = 'SUPPLIER_PAYMENT' AND py.direction = 'OUT' AND py.status = 'COMPLETED'
        AND py.paid_at >= ${ts(r.fromTs)} AND py.paid_at < ${ts(r.toTs)}
      UNION ALL
      SELECT 'EXPENSE', e.created_at, NULL, ec.name, e.amount, 6
      FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
      WHERE e.organization_id = ${org}::uuid AND e.branch_id = ${branchId}::uuid AND e.cancelled_at IS NULL
        AND e.expense_date = ${r.from}::date`;
    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<
        { kind: string; at: Date; reference: string | null; party: string | null; amount: string }[]
      >`
        SELECT kind, at, reference, party, amount::text AS amount FROM (${rowsSql}) d
        ORDER BY at ASC, ord ASC, reference ASC NULLS LAST
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ kind: string; n: number; amount: string }[]>`
        SELECT kind, count(*)::int AS n, sum(amount)::text AS amount FROM (${rowsSql}) d GROUP BY kind`,
    ]);
    const byKind = Object.fromEntries(
      totals.map((x) => [x.kind, { count: x.n, amount: money(x.amount) }]),
    );
    return new Paginated(
      rows.map((x) => ({
        kind: x.kind,
        at: x.at.toISOString(),
        reference: x.reference,
        party: x.party,
        amount: money(x.amount),
      })),
      {
        page,
        pageSize,
        total: totals.reduce((n, x) => n + x.n, 0),
        date,
        totals: byKind,
      },
    );
  }
}
