import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../database/prisma.service';

/**
 * Proves sales, stock, money and customer accounts agree. Every list should be EMPTY; a row means two records that
 * must match do not. The integration tests run it after every scenario.
 */
@Injectable()
export class SalesReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async run(t: TenantContext) {
    const org = t.organizationId;
    const [
      totals,
      settlement,
      allocations,
      creditPosted,
      customerBalance,
      returnsTotal,
      soldStock,
      returnedStock,
      cancelledStock,
      paymentCashbook,
      refunds,
      invoices,
      taxTotals,
    ] = await Promise.all([
      // 1. A bill's total is its lines plus its round-off.
      this.prisma.$queryRaw<object[]>`
        SELECT s.id AS "saleId", s.total::text AS total, (COALESCE(sum(i.line_total), 0) + s.round_off)::text AS "linesPlusRoundOff"
        FROM sales s LEFT JOIN sale_items i ON i.sale_id = s.id
        WHERE s.organization_id = ${org}::uuid
        GROUP BY s.id HAVING s.total <> COALESCE(sum(i.line_total), 0) + s.round_off LIMIT 50`,
      // 2. Paid now + on credit = total (also a database rule; checked here for the report).
      this.prisma.$queryRaw<object[]>`
        SELECT id AS "saleId" FROM sales
        WHERE organization_id = ${org}::uuid AND paid_total + credit_amount <> total LIMIT 50`,
      // 3. What a bill says was paid equals the payments allocated to it.
      this.prisma.$queryRaw<object[]>`
        SELECT s.id AS "saleId", s.paid_total::text AS "paidTotal", COALESCE(sum(sp.amount), 0)::text AS "allocated"
        FROM sales s LEFT JOIN sale_payments sp ON sp.sale_id = s.id
        WHERE s.organization_id = ${org}::uuid
        GROUP BY s.id HAVING s.paid_total <> COALESCE(sum(sp.amount), 0) LIMIT 50`,
      // 4. The credit of a bill was posted to the customer's account (and reversed if the bill was cancelled).
      this.prisma.$queryRaw<object[]>`
        SELECT s.id AS "saleId", s.credit_amount::text AS "creditAmount", s.status::text AS status,
               COALESCE(sum(l.amount) FILTER (WHERE l.entry_type = 'CREDIT_SALE'), 0)::text AS "posted",
               COALESCE(sum(l.amount) FILTER (WHERE l.entry_type = 'CANCELLATION_REVERSAL'), 0)::text AS "reversed"
        FROM sales s
        LEFT JOIN customer_ledger_entries l ON l.reference_type = 'SALE' AND l.reference_id = s.id
        WHERE s.organization_id = ${org}::uuid
        GROUP BY s.id
        HAVING s.credit_amount <> COALESCE(sum(l.amount) FILTER (WHERE l.entry_type = 'CREDIT_SALE'), 0)
            OR COALESCE(sum(l.amount) FILTER (WHERE l.entry_type = 'CANCELLATION_REVERSAL'), 0)
               <> CASE WHEN s.status = 'CANCELLED' THEN -s.credit_amount ELSE 0 END
        LIMIT 50`,
      // 5. A customer's cached balance equals the sum of their ledger lines.
      this.prisma.$queryRaw<object[]>`
        SELECT c.id AS "customerId", c.balance::text AS balance, COALESCE(sum(l.amount), 0)::text AS "ledgerSum"
        FROM customers c LEFT JOIN customer_ledger_entries l ON l.customer_id = c.id
        WHERE c.organization_id = ${org}::uuid
        GROUP BY c.id HAVING c.balance <> COALESCE(sum(l.amount), 0) LIMIT 50`,
      // 6. Returned value agrees between the bill, its lines (+ round-off once everything is back, capped at bill total) and the return documents.
      this.prisma.$queryRaw<object[]>`
        SELECT s.id AS "saleId", s.returned_total::text AS "returnedTotal",
               COALESCE((SELECT sum(total) FROM sale_returns WHERE sale_id = s.id), 0)::text AS "documents"
        FROM sales s
        WHERE s.organization_id = ${org}::uuid
          AND (s.returned_total <> COALESCE((SELECT sum(total) FROM sale_returns WHERE sale_id = s.id), 0)
            OR s.returned_total <> GREATEST(LEAST(
                 COALESCE((SELECT sum(returned_amount) FROM sale_items WHERE sale_id = s.id), 0)
                 + CASE WHEN NOT EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.returned_base_quantity <> i.base_quantity)
                        THEN s.round_off ELSE 0 END,
                 s.total), 0))
        LIMIT 50`,
      // 7. Stock that left for each bill line equals the line's quantity.
      this.prisma.$queryRaw<object[]>`
        SELECT i.id AS "saleItemId", i.base_quantity::text AS sold, COALESCE(-sum(m.quantity), 0)::text AS "stockOut"
        FROM sale_items i
        LEFT JOIN stock_movements m ON m.reference_type = 'SALE' AND m.reference_line_id = i.id AND m.type = 'SALE'
        WHERE i.organization_id = ${org}::uuid
        GROUP BY i.id HAVING i.base_quantity <> COALESCE(-sum(m.quantity), 0) LIMIT 50`,
      // 8. Saleable returns went back into stock; other dispositions did not.
      this.prisma.$queryRaw<object[]>`
        SELECT i.id AS "saleItemId",
               COALESCE((SELECT sum(ri.base_quantity) FROM sale_return_items ri WHERE ri.sale_item_id = i.id AND ri.disposition = 'SALEABLE'), 0)::text AS "saleableReturned",
               COALESCE((SELECT sum(m.quantity) FROM stock_movements m WHERE m.reference_type = 'SALE_RETURN' AND m.reference_line_id = i.id AND m.type = 'SALE_RETURN'), 0)::text AS "stockBack"
        FROM sale_items i
        WHERE i.organization_id = ${org}::uuid
          AND COALESCE((SELECT sum(ri.base_quantity) FROM sale_return_items ri WHERE ri.sale_item_id = i.id AND ri.disposition = 'SALEABLE'), 0)
              <> COALESCE((SELECT sum(m.quantity) FROM stock_movements m WHERE m.reference_type = 'SALE_RETURN' AND m.reference_line_id = i.id AND m.type = 'SALE_RETURN'), 0)
        LIMIT 50`,
      // 9. A cancelled bill put all its stock back; a live bill put none back.
      this.prisma.$queryRaw<object[]>`
        SELECT s.id AS "saleId", s.status::text AS status,
               COALESCE((SELECT sum(base_quantity) FROM sale_items WHERE sale_id = s.id), 0)::text AS sold,
               COALESCE((SELECT sum(quantity) FROM stock_movements WHERE reference_type = 'SALE_CANCELLATION' AND reference_id = s.id), 0)::text AS "putBack"
        FROM sales s
        WHERE s.organization_id = ${org}::uuid
          AND COALESCE((SELECT sum(quantity) FROM stock_movements WHERE reference_type = 'SALE_CANCELLATION' AND reference_id = s.id), 0)
              <> CASE WHEN s.status = 'CANCELLED' THEN COALESCE((SELECT sum(base_quantity) FROM sale_items WHERE sale_id = s.id), 0) ELSE 0 END
        LIMIT 50`,
      // 10. Every sale payment and refund has exactly its cashbook line (money in positive, money out negative).
      this.prisma.$queryRaw<object[]>`
        SELECT p.id AS "paymentId", p.purpose::text AS purpose, p.amount::text AS amount, COALESCE(sum(c.amount), 0)::text AS cashbook
        FROM payments p LEFT JOIN cashbook_entries c ON c.payment_id = p.id
        WHERE p.organization_id = ${org}::uuid AND p.purpose IN ('SALE', 'REFUND')
        GROUP BY p.id
        HAVING COALESCE(sum(c.amount), 0) <> CASE WHEN p.direction = 'IN' THEN p.amount ELSE -p.amount END
        LIMIT 50`,
      // 11. Money refunded on a bill equals its refund payments (returns refunded as money + cancellation reversals).
      this.prisma.$queryRaw<object[]>`
        SELECT s.id AS "saleId", s.refunded_total::text AS "refundedTotal",
               (COALESCE((SELECT sum(-c.amount) FROM cashbook_entries c
                          WHERE c.reference_type = 'SALE_RETURN' AND c.kind = 'REFUND'
                            AND c.reference_id IN (SELECT id FROM sale_returns WHERE sale_id = s.id)), 0)
                + COALESCE((SELECT sum(-c.amount) FROM cashbook_entries c
                            WHERE c.reference_type = 'SALE_CANCELLATION' AND c.reference_id = s.id), 0))::text AS "refundPayments"
        FROM sales s
        WHERE s.organization_id = ${org}::uuid
          AND s.refunded_total <> COALESCE((SELECT sum(-c.amount) FROM cashbook_entries c
                          WHERE c.reference_type = 'SALE_RETURN' AND c.kind = 'REFUND'
                            AND c.reference_id IN (SELECT id FROM sale_returns WHERE sale_id = s.id)), 0)
                + COALESCE((SELECT sum(-c.amount) FROM cashbook_entries c
                            WHERE c.reference_type = 'SALE_CANCELLATION' AND c.reference_id = s.id), 0)
        LIMIT 50`,
      // 12. Every sale has an invoice with matching number and status (ISSUED for COMPLETED, CANCELLED for CANCELLED).
      this.prisma.$queryRaw<object[]>`
        SELECT s.id AS "saleId", s.sale_number AS "saleNumber", s.status::text AS "saleStatus",
               inv.invoice_number AS "invoiceNumber", inv.status::text AS "invoiceStatus"
        FROM sales s LEFT JOIN invoices inv ON inv.sale_id = s.id
        WHERE s.organization_id = ${org}::uuid
          AND (inv.id IS NULL
            OR inv.invoice_number <> s.sale_number
            OR (s.status = 'COMPLETED' AND inv.status <> 'ISSUED')
            OR (s.status = 'CANCELLED' AND inv.status <> 'CANCELLED'))
        LIMIT 50`,
      // 13. Sale tax and taxable columns equal the sums of their line items, and taxable + tax = line_total on every line.
      this.prisma.$queryRaw<object[]>`
        SELECT s.id AS "saleId"
        FROM sales s LEFT JOIN sale_items i ON i.sale_id = s.id
        WHERE s.organization_id = ${org}::uuid
        GROUP BY s.id
        HAVING s.taxable_total <> COALESCE(sum(i.taxable_value), 0)
            OR s.cgst_total <> COALESCE(sum(i.cgst_amount), 0)
            OR s.sgst_total <> COALESCE(sum(i.sgst_amount), 0)
            OR s.igst_total <> COALESCE(sum(i.igst_amount), 0)
            OR bool_or(i.taxable_value + i.cgst_amount + i.sgst_amount + i.igst_amount <> i.line_total)
        LIMIT 50`,
    ]);
    const result = {
      billTotals: totals,
      paidPlusCredit: settlement,
      paymentAllocations: allocations,
      creditOnCustomerAccount: creditPosted,
      customerBalanceVsLedger: customerBalance,
      returnedTotals: returnsTotal,
      stockOutPerLine: soldStock,
      saleableReturnsBackInStock: returnedStock,
      cancelledBillsStockBack: cancelledStock,
      paymentsVsCashbook: paymentCashbook,
      refundsVsPayments: refunds,
      invoicesVsSales: invoices,
      taxTotalsVsLines: taxTotals,
    };
    return { consistent: Object.values(result).every((rows) => rows.length === 0), ...result };
  }
}
