import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import type { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

export type CustomerLedgerType =
  | 'OPENING_BALANCE'
  | 'CREDIT_SALE'
  | 'PAYMENT'
  | 'SALE_RETURN'
  | 'CANCELLATION_REVERSAL'
  | 'ADJUSTMENT';

export interface CustomerPosting {
  organizationId: string;
  branchId: string;
  customerId: string;
  actorId: string;
  type: CustomerLedgerType;
  /** Signed: positive = the customer owes more, negative = owes less. */
  amount: Decimal;
  referenceType: string;
  referenceId: string;
  description?: string;
  /** Set for new credit: refuse when the customer would go over their credit limit (unless allowed). */
  creditCheck?: { mayExceedLimit: boolean };
}

/**
 * The only code that changes what a customer owes (khata). Every change is one append-only ledger row carrying the
 * running balance, written in the caller's transaction together with the cached balance.
 *
 * Locking: the customer row is locked (FOR NO KEY UPDATE) so two bills for the same customer cannot both pass the
 * credit limit with the same old balance. Lock order in Sales: sale/document -> stock -> customer (LAST).
 */
@Injectable()
export class CustomerLedgerService {
  async post(tx: Tx, p: CustomerPosting): Promise<{ balanceAfter: Decimal }> {
    const c = await this.lock(tx, p.organizationId, p.customerId);
    if (p.amount.isZero()) return { balanceAfter: c.balance };
    const balanceAfter = c.balance.plus(p.amount);

    if (p.creditCheck) {
      if (!c.isActive) throw new DomainError('CUSTOMER_INACTIVE', 'This customer is switched off');
      if (
        c.creditLimit !== null &&
        balanceAfter.gt(c.creditLimit) &&
        !p.creditCheck.mayExceedLimit
      ) {
        throw new DomainError(
          'CREDIT_LIMIT_EXCEEDED',
          'This bill would take the customer over their credit limit',
          {
            creditLimit: c.creditLimit.toFixed(2),
            balance: c.balance.toFixed(2),
            credit: p.amount.toFixed(2),
            available: Decimal.max(c.creditLimit.minus(c.balance), 0).toFixed(2),
          },
        );
      }
    }

    await tx.customerLedgerEntry.create({
      data: {
        organizationId: p.organizationId,
        branchId: p.branchId,
        customerId: p.customerId,
        entryType: p.type,
        amount: p.amount.toFixed(2),
        balanceAfter: balanceAfter.toFixed(2),
        referenceType: p.referenceType,
        referenceId: p.referenceId,
        description: p.description,
        createdById: p.actorId,
      },
    });
    await tx.customer.update({
      where: { id: p.customerId },
      data: { balance: balanceAfter.toFixed(2) },
    });
    return { balanceAfter };
  }

  private async lock(tx: Tx, organizationId: string, customerId: string) {
    const rows = await tx.$queryRaw<
      { balance: string; credit_limit: string | null; is_active: boolean }[]
    >`
      SELECT balance::text AS balance, credit_limit::text AS credit_limit, is_active FROM customers
      WHERE id = ${customerId}::uuid AND organization_id = ${organizationId}::uuid AND deleted_at IS NULL
      FOR NO KEY UPDATE`;
    const r = rows[0];
    if (!r) throw new AppException('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    return {
      balance: new Decimal(r.balance),
      creditLimit: r.credit_limit === null ? null : new Decimal(r.credit_limit),
      isActive: r.is_active,
    };
  }
}
