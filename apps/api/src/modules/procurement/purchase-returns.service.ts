import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DocumentNumberService } from '../../common/numbering/document-number.service';
import { Paginated } from '../../common/pagination/paginated';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { toBaseQuantity } from '../catalog/domain/units';
import { InventoryService, type StockContext } from '../inventory/inventory.service';
import { cumulativeAmount } from './domain/purchase-math';
import { lockPurchase } from './purchase-access';
import type { CreatePurchaseReturnDto, ReturnsQuery } from './procurement.dto';
import { SupplierLedgerService } from './supplier-ledger.service';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const dec = (v: { toString(): string }) => new Decimal(v.toString());
const m2 = (v: { toString(): string }) => dec(v).toFixed(2);

/**
 * Sending goods back to a supplier. Stock leaves through the inventory engine and the supplier credit is posted
 * to the ledger in the same transaction. Credit is the price the shop paid for those goods (proportional to the
 * purchase line), so partial returns always add up to exactly the line's value.
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly ledger: SupplierLedgerService,
    private readonly numbers: DocumentNumberService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async create(t: TenantContext, key: string, dto: CreatePurchaseReturnDto, meta: Meta) {
    const branchId = this.branch(t);
    return this.idempotency.execute(
      { organizationId: t.organizationId, userId: t.userId },
      key,
      'POST /purchase-returns',
      { branchId, ...dto },
      async (tx) => {
        const locked = await lockPurchase(
          tx,
          { organizationId: t.organizationId, branchId },
          dto.purchaseId,
        );
        if (locked.status !== 'PARTIALLY_RECEIVED' && locked.status !== 'RECEIVED') {
          throw new AppException(
            'PURCHASE_NOT_RETURNABLE',
            'Only goods that were received can be returned to the supplier',
            409,
          );
        }
        const items = await tx.purchaseItem.findMany({ where: { purchaseId: dto.purchaseId } });
        const byId = new Map(items.map((i) => [i.id, i]));
        const products = new Map(
          (
            await tx.product.findMany({
              where: { id: { in: [...new Set(items.map((i) => i.productId))] } },
              select: { id: true, trackBatch: true, trackExpiry: true },
            })
          ).map((p) => [p.id, p]),
        );

        const returnId = randomUUID();
        const returnedBase = new Map(items.map((i) => [i.id, dec(i.returnedBaseQuantity)]));
        const returnedAmount = new Map(items.map((i) => [i.id, dec(i.returnedAmount)]));

        // Stock locks are taken in a fixed (product, line) order so concurrent returns cannot deadlock.
        const ordered = dto.items
          .map((line, index) => ({ line, index }))
          .sort((a, b) => {
            const pa = byId.get(a.line.purchaseItemId)?.productId ?? '';
            const pb = byId.get(b.line.purchaseItemId)?.productId ?? '';
            return pa < pb ? -1 : pa > pb ? 1 : a.index - b.index;
          });

        const stockCtx: StockContext = {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
        };
        const rows: Prisma.PurchaseReturnItemUncheckedCreateWithoutPurchaseReturnInput[] = [];
        let credit = new Decimal(0);
        for (const { line } of ordered) {
          const item = byId.get(line.purchaseItemId);
          if (!item) {
            throw new DomainError(
              'ITEM_NOT_IN_PURCHASE',
              'This item does not belong to the purchase',
              {
                purchaseItemId: line.purchaseItemId,
              },
            );
          }
          const base = toBaseQuantity(
            new Decimal(line.quantity),
            dec(item.conversionFactorSnapshot),
          );
          const returnable = dec(item.receivedBaseQuantity).minus(returnedBase.get(item.id)!);
          if (base.gt(returnable)) {
            throw new DomainError(
              'RETURN_EXCEEDS_RECEIVED',
              'More than what is left to return was entered',
              {
                purchaseItemId: item.id,
                returnableBaseQuantity: returnable.toFixed(3),
                enteredBaseQuantity: base.toFixed(3),
              },
            );
          }
          const product = products.get(item.productId)!;
          if ((product.trackBatch || product.trackExpiry) && !line.batchId) {
            throw new DomainError(
              'BATCH_REQUIRED',
              'Choose the batch the returned goods come from',
              {
                purchaseItemId: item.id,
              },
            );
          }

          const result = await this.inventory.issue(tx, stockCtx, {
            productId: item.productId,
            type: 'PURCHASE_RETURN',
            baseQuantity: base,
            batchId: line.batchId,
            reference: { type: 'PURCHASE_RETURN', id: returnId, lineId: item.id },
            reason: dto.reason,
          });

          const nowReturned = returnedBase.get(item.id)!.plus(base);
          returnedBase.set(item.id, nowReturned);
          const payable = dec(item.lineTotal).plus(dec(item.allocatedExtra));
          const target = cumulativeAmount(payable, nowReturned, dec(item.baseQuantity));
          const lineCredit = target.minus(returnedAmount.get(item.id)!);
          returnedAmount.set(item.id, target);
          credit = credit.plus(lineCredit);

          rows.push({
            purchaseItemId: item.id,
            productId: item.productId,
            batchId: result.movements[0]?.batchId ?? null,
            unitId: item.unitId,
            quantity: dec(line.quantity).toFixed(3),
            conversionFactorSnapshot: dec(item.conversionFactorSnapshot).toFixed(6),
            baseQuantity: base.toFixed(3),
            baseUnitCost: dec(item.baseUnitCost).toFixed(4),
            lineTotal: lineCredit.toFixed(2),
          });
        }

        // The supplier's bill carried a round-off once the last goods arrived (see PurchasesService), so the credit
        // for the LAST goods going back must carry it too. Then a purchase that is returned in full ends with
        // exactly what was billed credited: nothing left owed, and never more credited than billed.
        const givesEverythingBack =
          locked.status === 'RECEIVED' &&
          items.every((i) => returnedBase.get(i.id)!.equals(dec(i.receivedBaseQuantity)));
        const purchase = await tx.purchase.findUniqueOrThrow({
          where: { id: dto.purchaseId },
          select: { returnedTotal: true, billedTotal: true },
        });
        const cumulativeLines = items.reduce(
          (a, i) => a.plus(returnedAmount.get(i.id)!),
          new Decimal(0),
        );
        const desiredReturned = Decimal.min(
          cumulativeLines.plus(givesEverythingBack ? dec(locked.roundOff) : 0),
          dec(purchase.billedTotal),
        );
        const totalCredit = Decimal.max(desiredReturned.minus(dec(purchase.returnedTotal)), 0);
        const roundOffCredit = totalCredit.minus(credit);

        for (const item of items) {
          if (returnedBase.get(item.id)!.equals(dec(item.returnedBaseQuantity))) continue;
          await tx.purchaseItem.update({
            where: { id: item.id },
            data: {
              returnedBaseQuantity: returnedBase.get(item.id)!.toFixed(3),
              returnedAmount: returnedAmount.get(item.id)!.toFixed(2),
            },
          });
        }
        await tx.purchase.update({
          where: { id: dto.purchaseId },
          data: { returnedTotal: dec(purchase.returnedTotal).plus(totalCredit).toFixed(2) },
        });

        const number = await this.numbers.next(
          tx,
          { organizationId: t.organizationId, branchId },
          'PURCHASE_RETURN',
          'PRT',
        );
        await tx.purchaseReturn.create({
          data: {
            id: returnId,
            organizationId: t.organizationId,
            branchId,
            purchaseId: dto.purchaseId,
            supplierId: locked.supplierId,
            returnNumber: number.number,
            reason: dto.reason,
            total: totalCredit.toFixed(2),
            createdById: t.userId,
            items: { create: rows },
          },
        });

        if (totalCredit.gt(0)) {
          await this.ledger.post(tx, {
            organizationId: t.organizationId,
            branchId,
            supplierId: locked.supplierId,
            actorId: t.userId,
            type: 'PURCHASE_RETURN',
            amount: totalCredit.negated(),
            referenceType: 'PURCHASE_RETURN',
            referenceId: returnId,
            description: `Goods returned from ${locked.purchaseNumber} (${number.number})`,
          });
        }
        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'purchase_return.create',
          entityType: 'purchase_return',
          entityId: returnId,
          reason: dto.reason,
          after: {
            number: number.number,
            purchaseId: dto.purchaseId,
            credit: totalCredit.toFixed(2),
            roundOffAdjustment: roundOffCredit.toFixed(2),
            lines: rows.length,
          },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        });
        return this.view(tx, t.organizationId, returnId);
      },
    );
  }

  async get(t: TenantContext, id: string) {
    return this.view(this.prisma, t.organizationId, id, this.branch(t));
  }

  async list(t: TenantContext, q: ReturnsQuery) {
    const branchId = this.branch(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.PurchaseReturnWhereInput = {
      organizationId: t.organizationId,
      branchId,
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.purchaseId ? { purchaseId: q.purchaseId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchaseReturn.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          supplier: { select: { id: true, name: true } },
          purchase: { select: { purchaseNumber: true } },
        },
      }),
      this.prisma.purchaseReturn.count({ where }),
    ]);
    return new Paginated(
      rows.map((r) => ({
        id: r.id,
        returnNumber: r.returnNumber,
        purchaseId: r.purchaseId,
        purchaseNumber: r.purchase?.purchaseNumber ?? null,
        supplier: r.supplier,
        reason: r.reason,
        total: m2(r.total),
        createdAt: r.createdAt,
      })),
      { page, pageSize, total },
    );
  }

  private branch(t: TenantContext): string {
    if (!t.branchId)
      throw new AppException('BRANCH_REQUIRED', 'x-branch-id header is required', 400);
    return t.branchId;
  }

  private async view(db: Db, organizationId: string, id: string, branchId?: string) {
    const r = await db.purchaseReturn.findFirst({
      where: { id, organizationId, ...(branchId ? { branchId } : {}) },
      include: {
        supplier: { select: { id: true, name: true } },
        purchase: { select: { purchaseNumber: true } },
        items: { orderBy: { id: 'asc' } },
      },
    });
    if (!r) throw new AppException('PURCHASE_RETURN_NOT_FOUND', 'Purchase return not found', 404);
    const products = await db.product.findMany({
      where: { id: { in: [...new Set(r.items.map((i) => i.productId))] } },
      select: { id: true, name: true },
    });
    const name = new Map(products.map((p) => [p.id, p.name]));
    return {
      id: r.id,
      returnNumber: r.returnNumber,
      purchaseId: r.purchaseId,
      purchaseNumber: r.purchase?.purchaseNumber ?? null,
      supplier: r.supplier,
      reason: r.reason,
      total: m2(r.total),
      /** Round-off carried by the bill, credited with the return that gives the last goods back (0.00 otherwise). */
      roundOffAdjustment: dec(r.total)
        .minus(r.items.reduce((a, i) => a.plus(dec(i.lineTotal)), new Decimal(0)))
        .toFixed(2),
      createdAt: r.createdAt,
      items: r.items.map((i) => ({
        id: i.id,
        purchaseItemId: i.purchaseItemId,
        productId: i.productId,
        productName: name.get(i.productId) ?? null,
        batchId: i.batchId,
        unitId: i.unitId,
        quantity: dec(i.quantity).toFixed(3),
        baseQuantity: dec(i.baseQuantity).toFixed(3),
        baseUnitCost: dec(i.baseUnitCost).toFixed(4),
        lineTotal: m2(i.lineTotal),
      })),
    };
  }
}
