import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../database/prisma.service';

/**
 * Proves the books agree. Every list below should be EMPTY; a row means two records that must match do not.
 * Used by tests after every scenario and available to the owner as a health check.
 */
@Injectable()
export class ProcurementReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async run(t: TenantContext) {
    const org = t.organizationId;
    const [
      supplierBalance,
      purchaseBilled,
      purchaseLedger,
      returnTotals,
      returnLedger,
      paymentLedger,
      stockReceived,
      stockReturned,
    ] = await Promise.all([
      // 1. A supplier's cached balance equals the sum of its ledger lines.
      this.prisma.$queryRaw<object[]>`
        SELECT s.id AS "supplierId", s.balance::text AS "cachedBalance", COALESCE(sum(l.amount), 0)::text AS "ledgerSum"
        FROM suppliers s LEFT JOIN supplier_ledger_entries l ON l.supplier_id = s.id
        WHERE s.organization_id = ${org}::uuid
        GROUP BY s.id HAVING s.balance <> COALESCE(sum(l.amount), 0) LIMIT 50`,
      // 2. A purchase's billed total equals its lines' billed amounts (+ round-off once fully received).
      this.prisma.$queryRaw<object[]>`
        SELECT p.id AS "purchaseId", p.billed_total::text AS "billedTotal",
               (COALESCE(sum(i.billed_amount), 0) + CASE WHEN p.status = 'RECEIVED' THEN p.round_off ELSE 0 END)::text AS "expected"
        FROM purchases p LEFT JOIN purchase_items i ON i.purchase_id = p.id
        WHERE p.organization_id = ${org}::uuid
        GROUP BY p.id HAVING p.billed_total <> COALESCE(sum(i.billed_amount), 0) + CASE WHEN p.status = 'RECEIVED' THEN p.round_off ELSE 0 END
        LIMIT 50`,
      // 3. What the ledger says was billed for a purchase equals its billed total.
      this.prisma.$queryRaw<object[]>`
        SELECT p.id AS "purchaseId", p.billed_total::text AS "billedTotal", COALESCE(sum(l.amount), 0)::text AS "ledgerSum"
        FROM purchases p
        LEFT JOIN supplier_ledger_entries l ON l.reference_type = 'PURCHASE' AND l.reference_id = p.id AND l.entry_type = 'PURCHASE'
        WHERE p.organization_id = ${org}::uuid
        GROUP BY p.id HAVING p.billed_total <> COALESCE(sum(l.amount), 0) LIMIT 50`,
      // 4. A purchase's returned total equals its lines' returned amounts (+ round-off once everything is returned, capped at billed total)
      //    and the totals of its return documents.
      this.prisma.$queryRaw<object[]>`
        SELECT p.id AS "purchaseId", p.returned_total::text AS "returnedTotal",
               GREATEST(LEAST(
                 COALESCE((SELECT sum(returned_amount) FROM purchase_items WHERE purchase_id = p.id), 0)
                 + CASE WHEN p.status = 'RECEIVED' AND NOT EXISTS (
                     SELECT 1 FROM purchase_items i WHERE i.purchase_id = p.id AND i.returned_base_quantity <> i.received_base_quantity)
                   THEN p.round_off ELSE 0 END,
                 p.billed_total), 0)::text AS "expectedFromLines",
               COALESCE((SELECT sum(total) FROM purchase_returns WHERE purchase_id = p.id), 0)::text AS "documentSum"
        FROM purchases p
        WHERE p.organization_id = ${org}::uuid
          AND (p.returned_total <> GREATEST(LEAST(
                 COALESCE((SELECT sum(returned_amount) FROM purchase_items WHERE purchase_id = p.id), 0)
                 + CASE WHEN p.status = 'RECEIVED' AND NOT EXISTS (
                     SELECT 1 FROM purchase_items i WHERE i.purchase_id = p.id AND i.returned_base_quantity <> i.received_base_quantity)
                   THEN p.round_off ELSE 0 END,
                 p.billed_total), 0)
            OR p.returned_total <> COALESCE((SELECT sum(total) FROM purchase_returns WHERE purchase_id = p.id), 0))
        LIMIT 50`,
      // 5. Each return document's credit is mirrored by a ledger line.
      this.prisma.$queryRaw<object[]>`
        SELECT r.id AS "returnId", r.total::text AS "total", COALESCE(sum(-l.amount), 0)::text AS "ledgerCredit"
        FROM purchase_returns r
        LEFT JOIN supplier_ledger_entries l ON l.reference_type = 'PURCHASE_RETURN' AND l.reference_id = r.id
        WHERE r.organization_id = ${org}::uuid
        GROUP BY r.id HAVING r.total <> COALESCE(sum(-l.amount), 0) LIMIT 50`,
      // 6. Per supplier, ledger payment lines equal the payments table (money out is negative, reversals positive).
      this.prisma.$queryRaw<object[]>`
        SELECT s.id AS "supplierId",
               COALESCE((SELECT sum(amount) FROM supplier_ledger_entries WHERE supplier_id = s.id AND entry_type IN ('PAYMENT', 'CANCELLATION_REVERSAL')), 0)::text AS "ledgerPayments",
               COALESCE((SELECT sum(CASE WHEN direction = 'OUT' THEN -amount ELSE amount END) FROM payments
                         WHERE supplier_id = s.id AND purpose = 'SUPPLIER_PAYMENT'), 0)::text AS "paymentsTable"
        FROM suppliers s
        WHERE s.organization_id = ${org}::uuid
          AND COALESCE((SELECT sum(amount) FROM supplier_ledger_entries WHERE supplier_id = s.id AND entry_type IN ('PAYMENT', 'CANCELLATION_REVERSAL')), 0)
              <> COALESCE((SELECT sum(CASE WHEN direction = 'OUT' THEN -amount ELSE amount END) FROM payments
                           WHERE supplier_id = s.id AND purpose = 'SUPPLIER_PAYMENT'), 0)
        LIMIT 50`,
      // 7. Stock received through a purchase line equals what the line says was received.
      this.prisma.$queryRaw<object[]>`
        SELECT i.id AS "purchaseItemId", i.received_base_quantity::text AS "received",
               COALESCE(sum(m.quantity), 0)::text AS "stockMovements"
        FROM purchase_items i
        LEFT JOIN stock_movements m ON m.reference_line_id = i.id AND m.type = 'PURCHASE_RECEIPT' AND m.reference_type = 'PURCHASE'
        WHERE i.organization_id = ${org}::uuid
        GROUP BY i.id HAVING i.received_base_quantity <> COALESCE(sum(m.quantity), 0) LIMIT 50`,
      // 8. Stock sent back through returns equals what the line says was returned.
      this.prisma.$queryRaw<object[]>`
        SELECT i.id AS "purchaseItemId", i.returned_base_quantity::text AS "returned",
               COALESCE(sum(-m.quantity), 0)::text AS "stockMovements"
        FROM purchase_items i
        LEFT JOIN stock_movements m ON m.reference_line_id = i.id AND m.type = 'PURCHASE_RETURN' AND m.reference_type = 'PURCHASE_RETURN'
        WHERE i.organization_id = ${org}::uuid
        GROUP BY i.id HAVING i.returned_base_quantity <> COALESCE(sum(-m.quantity), 0) LIMIT 50`,
    ]);
    const result = {
      supplierBalanceVsLedger: supplierBalance,
      purchaseBilledVsLines: purchaseBilled,
      purchaseBilledVsLedger: purchaseLedger,
      purchaseReturnedTotals: returnTotals,
      returnCreditVsLedger: returnLedger,
      paymentsVsLedger: paymentLedger,
      stockReceivedVsLines: stockReceived,
      stockReturnedVsLines: stockReturned,
    };
    return {
      consistent: Object.values(result).every((rows) => rows.length === 0),
      ...result,
    };
  }
}
