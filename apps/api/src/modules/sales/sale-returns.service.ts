import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { uuidv7 } from '../../common/utils/ids';
import { DocumentNumberService } from '../../common/numbering/document-number.service';
import { Paginated } from '../../common/pagination/paginated';
import { cumulativeAmount, sum } from '../../common/utils/money';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { toBaseQuantity } from '../catalog/domain/units';
import { CustomerLedgerService } from '../customers/customer-ledger.service';
import { CashbookService } from '../finance/cashbook.service';
import { InventoryService, type StockContext } from '../inventory/inventory.service';
import { lockSale } from './sale-access';
import type { CreateSaleReturnDto, PaymentMethodName, ReturnsQuery } from './sales.dto';
import { branchOf } from './sales.service';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const dec = (v: { toString(): string }) => new Decimal(v.toString());
const m2 = (v: { toString(): string }) => dec(v).toFixed(2);

/**
 * Goods brought back by a customer.
 *  - Value comes from the ORIGINAL bill (its price and discount), never today's price: each line refunds its share of
 *    what was paid for it, and partial returns add up exactly. The bill's round-off is settled by the return that
 *    gives the last goods back, so a fully returned bill refunds exactly its total.
 *  - SALEABLE goods go back into stock (the line's latest-expiring batch, at the original cost). DAMAGED, EXPIRED and
 *    QUARANTINED goods are recorded on the return but never put back on sale.
 *  - Refund as money (never more than was actually paid on the bill and not yet refunded) or to the customer's
 *    account (reduces what they owe).
 * Lock order: sale -> stock -> document number -> customer.
 */
@Injectable()
export class SaleReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly customerLedger: CustomerLedgerService,
    private readonly cashbook: CashbookService,
    private readonly numbers: DocumentNumberService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async create(t: TenantContext, key: string, dto: CreateSaleReturnDto, meta: Meta) {
    const branchId = branchOf(t);
    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /sale-returns',
      { branchId, ...dto },
      async (tx) => {
        const locked = await lockSale(
          tx,
          { organizationId: t.organizationId, branchId },
          dto.saleId,
        );
        if (locked.status === 'CANCELLED') {
          throw new AppException(
            'SALE_CANCELLED',
            'This bill was cancelled; nothing can be returned',
            409,
          );
        }
        const sale = await tx.sale.findUniqueOrThrow({
          where: { id: dto.saleId },
          include: { items: true },
        });
        if (dto.refundTo === 'CUSTOMER_ACCOUNT' && !sale.customerId) {
          throw new DomainError(
            'REFUND_NEEDS_CUSTOMER',
            'A walk-in bill can only be refunded as money',
          );
        }
        const byId = new Map(sale.items.map((i) => [i.id, i]));
        const returnedBase = new Map(sale.items.map((i) => [i.id, dec(i.returnedBaseQuantity)]));
        const returnedAmount = new Map(sale.items.map((i) => [i.id, dec(i.returnedAmount)]));

        const returnId = uuidv7();
        const stockCtx: StockContext = {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
        };
        const ordered = dto.items
          .map((line, index) => ({ line, index }))
          .sort((a, b) => {
            const pa = byId.get(a.line.saleItemId)?.productId ?? '';
            const pb = byId.get(b.line.saleItemId)?.productId ?? '';
            return pa < pb ? -1 : pa > pb ? 1 : a.index - b.index;
          });

        const rows: Prisma.SaleReturnItemUncheckedCreateWithoutSaleReturnInput[] = [];
        for (const { line } of ordered) {
          const item = byId.get(line.saleItemId);
          if (!item) {
            throw new DomainError('ITEM_NOT_IN_SALE', 'This item is not on the bill', {
              saleItemId: line.saleItemId,
            });
          }
          const quantity = new Decimal(line.quantity);
          const base = toBaseQuantity(quantity, dec(item.conversionFactorSnapshot));
          const returnable = dec(item.baseQuantity).minus(returnedBase.get(item.id)!);
          if (base.gt(returnable)) {
            throw new DomainError(
              'RETURN_EXCEEDS_SOLD',
              'More than what is left to return was entered',
              {
                saleItemId: item.id,
                returnableBaseQuantity: returnable.toFixed(3),
                enteredBaseQuantity: base.toFixed(3),
              },
            );
          }

          let batchId: string | null = null;
          if (line.disposition === 'SALEABLE') {
            batchId = await this.returnBatch(tx, t.organizationId, dto.saleId, item.id);
            await this.inventory.receive(tx, stockCtx, {
              productId: item.productId,
              type: 'SALE_RETURN',
              baseQuantity: base,
              unitCost: dec(item.unitCostSnapshot),
              batch: batchId ? { batchId } : undefined,
              reference: { type: 'SALE_RETURN', id: returnId, lineId: item.id },
              reason: dto.reason,
            });
          }

          const nowReturned = returnedBase.get(item.id)!.plus(base);
          returnedBase.set(item.id, nowReturned);
          const target = cumulativeAmount(dec(item.lineTotal), nowReturned, dec(item.baseQuantity));
          const lineRefund = target.minus(returnedAmount.get(item.id)!);
          returnedAmount.set(item.id, target);

          rows.push({
            saleItemId: item.id,
            productId: item.productId,
            batchId,
            unitId: item.unitId,
            quantity: quantity.toFixed(3),
            baseQuantity: base.toFixed(3),
            disposition: line.disposition,
            unitPrice: m2(item.unitPrice),
            taxAmount: '0',
            lineTotal: lineRefund.toFixed(2),
            unitCostSnapshot: dec(item.unitCostSnapshot).toFixed(4),
          });
        }

        const linesRefund = sum(rows.map((r) => new Decimal(r.lineTotal as string)));
        const everythingBack = sale.items.every((i) =>
          returnedBase.get(i.id)!.equals(dec(i.baseQuantity)),
        );
        const roundOff = everythingBack ? dec(sale.roundOff) : new Decimal(0);
        const total = linesRefund.plus(roundOff);

        // ---- refund rules
        const refundMethod: PaymentMethodName | null =
          dto.refundTo === 'CUSTOMER_ACCOUNT' ? null : dto.refundTo;
        if (refundMethod) {
          const refundable = dec(sale.paidTotal).minus(dec(sale.refundedTotal));
          if (total.gt(refundable)) {
            throw new DomainError(
              'REFUND_EXCEEDS_PAID',
              sale.customerId
                ? 'More than was paid on this bill: refund the rest to the customer account'
                : 'More than was paid on this bill',
              { refundable: refundable.toFixed(2), refund: total.toFixed(2) },
            );
          }
        }

        for (const item of sale.items) {
          if (returnedBase.get(item.id)!.equals(dec(item.returnedBaseQuantity))) continue;
          await tx.saleItem.update({
            where: { id: item.id },
            data: {
              returnedBaseQuantity: returnedBase.get(item.id)!.toFixed(3),
              returnedAmount: returnedAmount.get(item.id)!.toFixed(2),
            },
          });
        }
        await tx.sale.update({
          where: { id: dto.saleId },
          data: {
            returnedTotal: dec(sale.returnedTotal).plus(total).toFixed(2),
            ...(refundMethod
              ? { refundedTotal: dec(sale.refundedTotal).plus(total).toFixed(2) }
              : {}),
          },
        });

        const number = await this.numbers.next(
          tx,
          { organizationId: t.organizationId, branchId },
          'SALE_RETURN',
          'SR',
        );
        await tx.saleReturn.create({
          data: {
            id: returnId,
            organizationId: t.organizationId,
            branchId,
            saleId: dto.saleId,
            returnNumber: number.number,
            reason: dto.reason,
            refundMethod,
            subtotal: linesRefund.toFixed(2),
            taxTotal: '0',
            roundOff: roundOff.toFixed(2),
            total: total.toFixed(2),
            createdById: t.userId,
            items: { create: rows },
          },
        });

        if (refundMethod && total.gt(0)) {
          const paymentId = uuidv7();
          await tx.payment.create({
            data: {
              id: paymentId,
              organizationId: t.organizationId,
              branchId,
              direction: 'OUT',
              purpose: 'REFUND',
              method: refundMethod,
              amount: total.toFixed(2),
              customerId: sale.customerId,
              recordedById: t.userId,
              notes: `Refund ${number.number} for ${sale.saleNumber}`,
            },
          });
          await this.cashbook.record(tx, {
            organizationId: t.organizationId,
            branchId,
            actorId: t.userId,
            kind: 'REFUND',
            method: refundMethod,
            amount: total.negated(),
            paymentId,
            referenceType: 'SALE_RETURN',
            referenceId: returnId,
            description: `Refund ${number.number} for ${sale.saleNumber}`,
          });
        } else if (!refundMethod && total.gt(0)) {
          await this.customerLedger.post(tx, {
            organizationId: t.organizationId,
            branchId,
            customerId: sale.customerId!,
            actorId: t.userId,
            type: 'SALE_RETURN',
            amount: total.negated(),
            referenceType: 'SALE_RETURN',
            referenceId: returnId,
            description: `Return ${number.number} for ${sale.saleNumber}`,
          });
        }

        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'sale_return.create',
          entityType: 'sale_return',
          entityId: returnId,
          reason: dto.reason,
          after: {
            number: number.number,
            saleId: dto.saleId,
            total: total.toFixed(2),
            refundTo: dto.refundTo,
            lines: rows.length,
          },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        });
        return this.view(tx, t.organizationId, returnId);
      },
    );
  }

  /** The batch saleable goods go back into: the latest-expiring batch the line was sold from (none if untracked). */
  private async returnBatch(
    tx: Prisma.TransactionClient,
    organizationId: string,
    saleId: string,
    lineId: string,
  ) {
    const rows = await tx.$queryRaw<{ batch_id: string | null }[]>`
      SELECT m.batch_id FROM stock_movements m
      LEFT JOIN inventory_batches b ON b.id = m.batch_id
      WHERE m.organization_id = ${organizationId}::uuid AND m.reference_type = 'SALE'
        AND m.reference_id = ${saleId}::uuid AND m.reference_line_id = ${lineId}::uuid AND m.type = 'SALE'
      ORDER BY b.expiry_date DESC NULLS LAST, m.id DESC
      LIMIT 1`;
    return rows[0]?.batch_id ?? null;
  }

  async get(t: TenantContext, id: string) {
    return this.view(this.prisma, t.organizationId, id, branchOf(t));
  }

  async list(t: TenantContext, q: ReturnsQuery) {
    const branchId = branchOf(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.SaleReturnWhereInput = {
      organizationId: t.organizationId,
      branchId,
      ...(q.saleId ? { saleId: q.saleId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.saleReturn.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { sale: { select: { saleNumber: true } } },
      }),
      this.prisma.saleReturn.count({ where }),
    ]);
    return new Paginated(
      rows.map((r) => ({
        id: r.id,
        returnNumber: r.returnNumber,
        saleId: r.saleId,
        saleNumber: r.sale.saleNumber,
        refundTo: r.refundMethod ?? 'CUSTOMER_ACCOUNT',
        total: m2(r.total),
        createdAt: r.createdAt,
      })),
      { page, pageSize, total },
    );
  }

  private async view(db: Db, organizationId: string, id: string, branchId?: string) {
    const r = await db.saleReturn.findFirst({
      where: { id, organizationId, ...(branchId ? { branchId } : {}) },
      include: { sale: { select: { saleNumber: true } }, items: { orderBy: { id: 'asc' } } },
    });
    if (!r) throw new AppException('SALE_RETURN_NOT_FOUND', 'Return not found', 404);
    return {
      id: r.id,
      returnNumber: r.returnNumber,
      saleId: r.saleId,
      saleNumber: r.sale.saleNumber,
      reason: r.reason,
      refundTo: r.refundMethod ?? 'CUSTOMER_ACCOUNT',
      subtotal: m2(r.subtotal),
      roundOff: m2(r.roundOff),
      total: m2(r.total),
      createdAt: r.createdAt,
      items: r.items.map((i) => ({
        id: i.id,
        saleItemId: i.saleItemId,
        productId: i.productId,
        batchId: i.batchId,
        quantity: dec(i.quantity).toFixed(3),
        baseQuantity: dec(i.baseQuantity).toFixed(3),
        disposition: i.disposition,
        unitPrice: m2(i.unitPrice),
        lineTotal: m2(i.lineTotal),
      })),
    };
  }
}
