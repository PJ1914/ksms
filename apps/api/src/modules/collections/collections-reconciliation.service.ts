import { Injectable } from '@nestjs/common';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class CollectionsReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcile(organizationId: string, branchId?: string, db: Db = this.prisma) {
    const pBranch = branchId ? Prisma.sql`AND p.branch_id = ${branchId}::uuid` : Prisma.empty;
    const crBranch = branchId ? Prisma.sql`AND cr.branch_id = ${branchId}::uuid` : Prisma.empty;

    const [
      customerBalanceMismatches,
      collectionLedgerMismatches,
      collectionCashbookMismatches,
      reversalMismatches,
      recordMismatches,
    ] = await Promise.all([
      db.$queryRaw<{ customer_id: string; cached: string; sum_ledger: string }[]>`
        SELECT c.id::text AS customer_id,
               c.balance::text AS cached,
               COALESCE(SUM(l.amount), 0)::text AS sum_ledger
        FROM customers c
        LEFT JOIN customer_ledger_entries l
          ON l.customer_id = c.id AND l.organization_id = c.organization_id
        WHERE c.organization_id = ${organizationId}::uuid AND c.deleted_at IS NULL
        GROUP BY c.id, c.balance
        HAVING c.balance <> COALESCE(SUM(l.amount), 0)`,

      db.$queryRaw<{ payment_id: string; expected: string; actual: string }[]>`
        SELECT p.id::text AS payment_id,
               (-p.amount)::text AS expected,
               COALESCE(SUM(l.amount), 0)::text AS actual
        FROM payments p
        LEFT JOIN customer_ledger_entries l
          ON l.reference_type = 'PAYMENT' AND l.reference_id = p.id AND l.organization_id = p.organization_id
        WHERE p.organization_id = ${organizationId}::uuid
          ${pBranch}
          AND p.purpose = 'CUSTOMER_COLLECTION' AND p.direction = 'IN'
        GROUP BY p.id, p.amount
        HAVING (-p.amount) <> COALESCE(SUM(l.amount), 0)`,

      db.$queryRaw<{ payment_id: string; expected: string; actual: string }[]>`
        SELECT p.id::text AS payment_id,
               p.amount::text AS expected,
               COALESCE(SUM(cb.amount), 0)::text AS actual
        FROM payments p
        LEFT JOIN cashbook_entries cb
          ON cb.payment_id = p.id AND cb.kind = 'CUSTOMER_COLLECTION' AND cb.organization_id = p.organization_id
        WHERE p.organization_id = ${organizationId}::uuid
          ${pBranch}
          AND p.purpose = 'CUSTOMER_COLLECTION' AND p.direction = 'IN'
        GROUP BY p.id, p.amount
        HAVING p.amount <> COALESCE(SUM(cb.amount), 0)`,

      db.$queryRaw<{ payment_id: string }[]>`
        SELECT p.id::text AS payment_id
        FROM payments p
        WHERE p.organization_id = ${organizationId}::uuid
          ${pBranch}
          AND p.purpose = 'CUSTOMER_COLLECTION' AND p.direction = 'IN' AND p.status = 'REVERSED'
          AND NOT EXISTS (
            SELECT 1 FROM payments rev
            JOIN customer_ledger_entries l
              ON l.reference_type = 'PAYMENT_REVERSAL' AND l.reference_id = rev.id AND l.amount = p.amount
            JOIN cashbook_entries cb
              ON cb.payment_id = rev.id AND cb.kind = 'REVERSAL' AND cb.amount = -p.amount
            WHERE rev.reversal_of_id = p.id AND rev.organization_id = p.organization_id
          )`,

      db.$queryRaw<{ record_id: string }[]>`
        SELECT cr.id::text AS record_id
        FROM collection_records cr
        JOIN payments p ON p.id = cr.payment_id
        WHERE cr.organization_id = ${organizationId}::uuid
          ${crBranch}
          AND (
            cr.amount <> p.amount
            OR cr.customer_id <> p.customer_id
            OR cr.receipt_number <> COALESCE(p.receipt_number, '')
            OR cr.branch_id <> p.branch_id
          )`,
    ]);

    const consistent =
      customerBalanceMismatches.length === 0 &&
      collectionLedgerMismatches.length === 0 &&
      collectionCashbookMismatches.length === 0 &&
      reversalMismatches.length === 0 &&
      recordMismatches.length === 0;

    return {
      consistent,
      customerBalanceMismatches,
      collectionLedgerMismatches,
      collectionCashbookMismatches,
      reversalMismatches,
      recordMismatches,
    };
  }
}
