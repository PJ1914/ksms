import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

export type SupplierLedgerType =
  | 'OPENING_BALANCE'
  | 'PURCHASE'
  | 'PAYMENT'
  | 'PURCHASE_RETURN'
  | 'CANCELLATION_REVERSAL'
  | 'ADJUSTMENT';

export interface LedgerPosting {
  organizationId: string;
  branchId: string;
  supplierId: string;
  actorId: string;
  type: SupplierLedgerType;
  /** Signed: positive = the shop owes more, negative = the shop owes less. */
  amount: Decimal;
  referenceType: string;
  referenceId: string;
  description?: string;
}

/**
 * The only code that changes what the shop owes a supplier. Every change is one append-only ledger row
 * carrying the running balance, written in the caller's transaction together with the cached balance.
 *
 * Locking: the supplier row is locked (SELECT ... FOR NO KEY UPDATE, so inserts that merely reference the supplier are not blocked) so two simultaneous postings cannot both read
 * the same balance. Lock order across the module is always: purchase -> stock balances/batches -> supplier,
 * so this lock is taken last and cannot deadlock with the others.
 */
@Injectable()
export class SupplierLedgerService {
  async post(tx: Tx, p: LedgerPosting): Promise<{ balanceAfter: Decimal } | null> {
    const balanceBefore = await this.lockBalance(tx, p.organizationId, p.supplierId);
    if (p.amount.isZero()) return { balanceAfter: balanceBefore }; // nothing to record (e.g. free goods)

    const balanceAfter = balanceBefore.plus(p.amount);
    await tx.supplierLedgerEntry.create({
      data: {
        organizationId: p.organizationId,
        branchId: p.branchId,
        supplierId: p.supplierId,
        entryType: p.type,
        amount: p.amount.toFixed(2),
        balanceAfter: balanceAfter.toFixed(2),
        referenceType: p.referenceType,
        referenceId: p.referenceId,
        description: p.description,
        createdById: p.actorId,
      },
    });
    await tx.supplier.update({
      where: { id: p.supplierId },
      data: { balance: balanceAfter.toFixed(2) },
    });
    return { balanceAfter };
  }

  /** Locks the supplier row and returns its current balance. Unknown or other-shop suppliers are "not found". */
  async lockBalance(tx: Tx, organizationId: string, supplierId: string): Promise<Decimal> {
    const rows = await tx.$queryRaw<{ balance: string }[]>`
      SELECT balance::text AS balance FROM suppliers
      WHERE id = ${supplierId}::uuid AND organization_id = ${organizationId}::uuid AND deleted_at IS NULL
      FOR NO KEY UPDATE`;
    if (!rows[0]) throw new AppException('SUPPLIER_NOT_FOUND', 'Supplier not found', 404);
    return new Decimal(rows[0].balance);
  }
}
