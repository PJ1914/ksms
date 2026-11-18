import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { RolePermissionService } from '../../common/auth/role-permission.service';
import { AppException } from '../../common/errors/app.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { uuidv7 } from '../../common/utils/ids';
import { todayInIndia } from '../../common/utils/dates';
import { AuditService } from '../audit/audit.service';
import { CustomerLedgerService } from '../customers/customer-ledger.service';
import { CashbookService } from '../finance/cashbook.service';
import { InventoryService, type StockContext } from '../inventory/inventory.service';
import { lockSale } from './sale-access';
import type { CancelSaleDto } from './sales.dto';
import { SalesService, branchOf } from './sales.service';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const dec = (v: { toString(): string }) => new Decimal(v.toString());

/**
 * Cancelling a completed bill. Nothing is deleted: in ONE transaction the goods go back into stock (same batches,
 * original cost), every payment is reversed with an opposite payment and cashbook line, the credit comes off the
 * customer's account, and the sale is marked CANCELLED with the reason.
 *
 * Allowed on the day of the sale for roles with sale.cancel; an older bill needs the Owner (daily closing in
 * Phase 12 will make this "before the day is closed"). A bill with returns must be corrected with more returns.
 */
@Injectable()
export class SaleCancellationService {
  constructor(
    private readonly sales: SalesService,
    private readonly inventory: InventoryService,
    private readonly customerLedger: CustomerLedgerService,
    private readonly cashbook: CashbookService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly rolePerms: RolePermissionService,
  ) {}

  async cancel(t: TenantContext, key: string, saleId: string, dto: CancelSaleDto, meta: Meta) {
    const branchId = branchOf(t);
    const perms = await this.rolePerms.get(t.roleId);

    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /sales/:id/cancel',
      { branchId, saleId, ...dto },
      async (tx) => {
        const locked = await lockSale(tx, { organizationId: t.organizationId, branchId }, saleId);
        if (locked.status === 'CANCELLED') {
          throw new AppException('SALE_ALREADY_CANCELLED', 'This bill is already cancelled', 409);
        }
        if (locked.soldOn !== todayInIndia() && !perms.isOwner) {
          throw new AppException(
            'SALE_CANCEL_WINDOW_CLOSED',
            'Only the owner can cancel a bill from an earlier day',
            403,
            {
              soldOn: locked.soldOn,
            },
          );
        }
        const sale = await tx.sale.findUniqueOrThrow({
          where: { id: saleId },
          include: {
            payments: { include: { payment: true } },
            _count: { select: { returns: true } },
          },
        });
        if (sale._count.returns > 0) {
          throw new AppException(
            'SALE_HAS_RETURNS',
            'Goods from this bill were already returned. Return the rest instead of cancelling',
            409,
          );
        }

        // ---- goods back into stock, exactly as they left (batch and cost), in product order
        const moves = await tx.stockMovement.findMany({
          where: {
            organizationId: t.organizationId,
            referenceType: 'SALE',
            referenceId: saleId,
            type: 'SALE',
          },
          orderBy: [{ productId: 'asc' }, { id: 'asc' }],
        });
        const stockCtx: StockContext = {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
        };
        for (const m of moves) {
          await this.inventory.receive(tx, stockCtx, {
            productId: m.productId,
            type: 'CANCELLATION_REVERSAL',
            baseQuantity: dec(m.quantity).negated(),
            unitCost: dec(m.unitCost),
            batch: m.batchId ? { batchId: m.batchId } : undefined,
            reference: {
              type: 'SALE_CANCELLATION',
              id: saleId,
              lineId: m.referenceLineId ?? undefined,
            },
            reason: dto.reason,
          });
        }

        // ---- every payment reversed: money goes back out
        let refunded = new Decimal(0);
        for (const sp of sale.payments) {
          const original = sp.payment;
          if (original.status !== 'COMPLETED') continue;
          const reversalId = uuidv7();
          await tx.payment.update({
            where: { id: original.id },
            data: { status: 'REVERSED', reversedAt: new Date() },
          });
          await tx.payment.create({
            data: {
              id: reversalId,
              organizationId: t.organizationId,
              branchId,
              direction: 'OUT',
              purpose: 'REFUND',
              method: original.method,
              amount: original.amount,
              customerId: original.customerId,
              referenceNo: original.referenceNo,
              recordedById: t.userId,
              reversalOfId: original.id,
              notes: `Cancelled ${sale.saleNumber}: ${dto.reason}`,
            },
          });
          await this.cashbook.record(tx, {
            organizationId: t.organizationId,
            branchId,
            actorId: t.userId,
            kind: 'REVERSAL',
            method: original.method,
            amount: dec(original.amount).negated(),
            paymentId: reversalId,
            referenceType: 'SALE_CANCELLATION',
            referenceId: saleId,
            description: `Cancelled ${sale.saleNumber}`,
          });
          refunded = refunded.plus(dec(original.amount));
        }

        await tx.sale.update({
          where: { id: saleId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledById: t.userId,
            cancelReason: dto.reason,
            refundedTotal: refunded.toFixed(2),
          },
        });
        await tx.invoice.updateMany({
          where: { saleId, organizationId: t.organizationId, branchId },
          data: { status: 'CANCELLED' },
        });

        // ---- credit comes off the customer's account (customer lock last)
        if (sale.customerId && dec(sale.creditAmount).gt(0)) {
          await this.customerLedger.post(tx, {
            organizationId: t.organizationId,
            branchId,
            customerId: sale.customerId,
            actorId: t.userId,
            type: 'CANCELLATION_REVERSAL',
            amount: dec(sale.creditAmount).negated(),
            referenceType: 'SALE',
            referenceId: saleId,
            description: `Cancelled ${sale.saleNumber}`,
          });
        }

        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'sale.cancel',
          entityType: 'sale',
          entityId: saleId,
          reason: dto.reason,
          after: {
            number: sale.saleNumber,
            refunded: refunded.toFixed(2),
            creditReversed: dec(sale.creditAmount).toFixed(2),
            stockLines: moves.length,
            earlierDay: locked.soldOn !== todayInIndia(),
          },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        });
        return this.sales.view(tx, t.organizationId, saleId);
      },
    );
  }
}
