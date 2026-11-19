import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { DailyClosingService } from './daily-closing.service';

@Injectable()
export class FinanceReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly closing: DailyClosingService,
  ) {}

  async reconcile(organizationId: string, branchId?: string) {
    const eBranch = branchId ? Prisma.sql`AND e.branch_id = ${branchId}::uuid` : Prisma.empty;
    const cbBranch = branchId ? Prisma.sql`AND cb.branch_id = ${branchId}::uuid` : Prisma.empty;

    const [expenseCashbookMismatches, cancelledExpenseMismatches, manualSignMismatches, closings] =
      await Promise.all([
        this.prisma.$queryRaw<{ expense_id: string; expected: string; actual: string }[]>`
          SELECT e.id::text AS expense_id,
                 (-e.amount)::text AS expected,
                 COALESCE(SUM(cb.amount), 0)::text AS actual
          FROM expenses e
          LEFT JOIN cashbook_entries cb
            ON cb.reference_type = 'EXPENSE' AND cb.reference_id = e.id AND cb.organization_id = e.organization_id
          WHERE e.organization_id = ${organizationId}::uuid ${eBranch}
          GROUP BY e.id, e.amount
          HAVING (-e.amount) <> COALESCE(SUM(cb.amount), 0)`,

        this.prisma.$queryRaw<{ expense_id: string; expected: string; actual: string }[]>`
          SELECT e.id::text AS expense_id,
                 e.amount::text AS expected,
                 COALESCE(SUM(cb.amount), 0)::text AS actual
          FROM expenses e
          LEFT JOIN cashbook_entries cb
            ON cb.reference_type = 'EXPENSE_CANCELLATION' AND cb.reference_id = e.id AND cb.organization_id = e.organization_id
          WHERE e.organization_id = ${organizationId}::uuid ${eBranch}
            AND e.cancelled_at IS NOT NULL
          GROUP BY e.id, e.amount
          HAVING e.amount <> COALESCE(SUM(cb.amount), 0)`,

        this.prisma.$queryRaw<{ entry_id: string }[]>`
          SELECT cb.id::text AS entry_id
          FROM cashbook_entries cb
          WHERE cb.organization_id = ${organizationId}::uuid ${cbBranch}
            AND (
              (cb.kind = 'CASH_IN' AND cb.amount <= 0)
              OR (cb.kind = 'CASH_OUT' AND cb.amount >= 0)
            )`,

        this.prisma.dailyClosing.findMany({
          where: {
            organizationId,
            ...(branchId ? { branchId } : {}),
            status: 'CLOSED',
          },
          orderBy: [{ registerId: 'asc' }, { businessDate: 'asc' }],
        }),
      ]);

    const closingMismatches: { closingId: string; businessDate: string; reason: string }[] = [];

    for (const c of closings) {
      // The same rule the closing used: the last counted cash plus the cash of any never-closed days since.
      const expectedOpening = await this.closing.openingCash(
        this.prisma,
        organizationId,
        c.registerId,
        c.businessDate,
      );
      const opening = new Decimal(c.openingCash.toString());
      if (!opening.eq(expectedOpening)) {
        closingMismatches.push({
          closingId: c.id,
          businessDate: c.businessDate.toISOString().slice(0, 10),
          reason: `openingCash ${opening.toFixed(2)} != expected ${expectedOpening.toFixed(2)} (last counted cash plus unclosed days)`,
        });
      }

      const cashAgg = await this.prisma.cashbookEntry.aggregate({
        where: {
          organizationId,
          registerId: c.registerId,
          businessDate: c.businessDate,
          method: 'CASH',
        },
        _sum: { amount: true },
      });
      const cashNet = cashAgg._sum.amount
        ? new Decimal(cashAgg._sum.amount.toString())
        : new Decimal(0);
      const calcExpected = opening.plus(cashNet);
      const storedExpected = new Decimal(c.expectedCash.toString());
      if (!storedExpected.eq(calcExpected)) {
        closingMismatches.push({
          closingId: c.id,
          businessDate: c.businessDate.toISOString().slice(0, 10),
          reason: `expectedCash ${storedExpected.toFixed(2)} != calculated ${calcExpected.toFixed(2)}`,
        });
      }

      const actual = c.actualCash ? new Decimal(c.actualCash.toString()) : new Decimal(0);
      const storedDiff = c.difference ? new Decimal(c.difference.toString()) : new Decimal(0);
      if (!storedDiff.eq(actual.minus(storedExpected))) {
        closingMismatches.push({
          closingId: c.id,
          businessDate: c.businessDate.toISOString().slice(0, 10),
          reason: 'difference != actualCash - expectedCash',
        });
      }
    }

    const consistent =
      expenseCashbookMismatches.length === 0 &&
      cancelledExpenseMismatches.length === 0 &&
      manualSignMismatches.length === 0 &&
      closingMismatches.length === 0;

    return {
      consistent,
      expenseCashbookMismatches,
      cancelledExpenseMismatches,
      manualSignMismatches,
      closingMismatches,
    };
  }
}
