import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DocumentNumberService } from '../../common/numbering/document-number.service';
import { Paginated } from '../../common/pagination/paginated';
import { dateOnly } from '../../common/utils/dates';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { assertStockBaseQuantity, toBaseQuantity } from '../catalog/domain/units';
import { ProductsService } from '../catalog/products.service';
import { isRealIsoDate, todayInIndia } from '../inventory/domain/stock';
import { InventoryService, type StockContext } from '../inventory/inventory.service';
import { type PurchaseLineInput, computePurchase, cumulativeAmount } from './domain/purchase-math';
import { lockPurchase } from './purchase-access';
import type {
  CancelPurchaseDto,
  CreatePurchaseDto,
  PurchaseItemDto,
  PurchasesQuery,
  ReceivePurchaseDto,
  UpdatePurchaseDto,
} from './procurement.dto';
import { SupplierLedgerService } from './supplier-ledger.service';

type Tx = Prisma.TransactionClient;
interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const dec = (v: { toString(): string }) => new Decimal(v.toString());
const m2 = (v: { toString(): string }) => dec(v).toFixed(2);
const day = (d: Date) => d.toISOString().slice(0, 10);

type PurchaseWithItems = Prisma.PurchaseGetPayload<{
  include: {
    items: { include: { product: { select: { name: true; sku: true } } } };
    supplier: { select: { id: true; name: true } };
    payments: { include: { payment: true } };
  };
}>;

/** What a purchase line looks like after validation, before it is saved. */
interface PreparedLine {
  item: PurchaseItemDto;
  factor: Decimal;
  quantity: Decimal;
  baseQuantity: Decimal;
  input: PurchaseLineInput;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: ProductsService,
    private readonly inventory: InventoryService,
    private readonly ledger: SupplierLedgerService,
    private readonly numbers: DocumentNumberService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ create

  async create(t: TenantContext, key: string, dto: CreatePurchaseDto, meta: Meta) {
    const branchId = this.branch(t);
    return this.idempotency.execute(
      { organizationId: t.organizationId, userId: t.userId },
      key,
      'POST /purchases',
      { branchId, ...dto },
      async (tx) => {
        const supplier = await tx.supplier.findFirst({
          where: { id: dto.supplierId, organizationId: t.organizationId, deletedAt: null },
          select: { id: true, isActive: true },
        });
        if (!supplier) throw new AppException('SUPPLIER_NOT_FOUND', 'Supplier not found', 404);
        if (!supplier.isActive) {
          throw new DomainError(
            'SUPPLIER_INACTIVE',
            'This supplier is switched off. Reactivate it first',
          );
        }
        const date = this.purchaseDate(dto.purchaseDate);
        await this.assertInvoiceNoFree(tx, t.organizationId, dto.supplierId, dto.supplierInvoiceNo);

        const org = await tx.organization.findUniqueOrThrow({
          where: { id: t.organizationId },
          select: { gstEnabled: true },
        });
        const prepared = await this.prepareLines(tx, t.organizationId, dto.items);
        const figures = computePurchase(
          prepared.map((p) => p.input),
          new Decimal(dto.additionalCosts ?? 0),
          new Decimal(dto.roundOff ?? 0),
          org.gstEnabled,
        );
        const number = await this.numbers.next(
          tx,
          { organizationId: t.organizationId, branchId },
          'PURCHASE',
          'PUR',
          new Date(`${date}T00:00:00+05:30`),
        );

        const purchase = await tx.purchase.create({
          data: {
            organizationId: t.organizationId,
            branchId,
            supplierId: dto.supplierId,
            purchaseNumber: number.number,
            supplierInvoiceNo: dto.supplierInvoiceNo,
            status: 'DRAFT',
            purchaseDate: new Date(date),
            subtotal: figures.subtotal.toFixed(2),
            discountTotal: figures.discountTotal.toFixed(2),
            additionalCosts: figures.additionalCosts.toFixed(2),
            taxTotal: figures.taxTotal.toFixed(2),
            roundOff: figures.roundOff.toFixed(2),
            total: figures.total.toFixed(2),
            notes: dto.notes,
            createdById: t.userId,
            items: {
              create: prepared.map((p, i) => this.itemData(t.organizationId, p, figures.lines[i]!)),
            },
          },
        });
        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'purchase.create',
          entityType: 'purchase',
          entityId: purchase.id,
          after: {
            number: purchase.purchaseNumber,
            supplierId: dto.supplierId,
            lines: prepared.length,
            total: figures.total.toFixed(2),
          },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        });

        if (dto.receiveNow) await this.receiveInTx(tx, t, purchase.id, undefined, meta);
        return this.view(tx, t.organizationId, purchase.id);
      },
    );
  }

  // ------------------------------------------------------------------ edit / confirm / cancel

  async update(t: TenantContext, id: string, dto: UpdatePurchaseDto, meta: Meta) {
    const branchId = this.branch(t);
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockPurchase(tx, { organizationId: t.organizationId, branchId }, id);
      if (locked.status !== 'DRAFT') {
        throw new AppException(
          'PURCHASE_NOT_EDITABLE',
          'Only a draft purchase can be edited. Cancel it or process a purchase return instead',
          409,
        );
      }
      const current = await tx.purchase.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });

      if (dto.supplierId && dto.supplierId !== current.supplierId) {
        const s = await tx.supplier.findFirst({
          where: {
            id: dto.supplierId,
            organizationId: t.organizationId,
            deletedAt: null,
            isActive: true,
          },
          select: { id: true },
        });
        if (!s)
          throw new AppException('SUPPLIER_NOT_FOUND', 'Supplier not found or switched off', 404);
      }
      const supplierId = dto.supplierId ?? current.supplierId;
      if (dto.supplierInvoiceNo) {
        await this.assertInvoiceNoFree(tx, t.organizationId, supplierId, dto.supplierInvoiceNo, id);
      }
      const date = dto.purchaseDate
        ? this.purchaseDate(dto.purchaseDate)
        : day(current.purchaseDate);

      const org = await tx.organization.findUniqueOrThrow({
        where: { id: t.organizationId },
        select: { gstEnabled: true },
      });
      const prepared = dto.items ? await this.prepareLines(tx, t.organizationId, dto.items) : null;
      const inputs: PurchaseLineInput[] = prepared
        ? prepared.map((p) => p.input)
        : current.items.map((i) => ({
            quantity: dec(i.quantity),
            baseQuantity: dec(i.baseQuantity),
            unitCost: dec(i.unitCost),
            discount: dec(i.discountAmount),
            taxRatePercent: dec(i.taxRatePercent),
          }));
      const figures = computePurchase(
        inputs,
        new Decimal(dto.additionalCosts ?? current.additionalCosts.toString()),
        new Decimal(dto.roundOff ?? current.roundOff.toString()),
        org.gstEnabled,
      );

      if (prepared) {
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } }); // allowed for drafts only (database guard)
        await tx.purchaseItem.createMany({
          data: prepared.map((p, i) => ({
            purchaseId: id,
            ...this.itemData(t.organizationId, p, figures.lines[i]!),
          })),
        });
      } else {
        for (const [i, item] of current.items.entries()) {
          const f = figures.lines[i]!;
          await tx.purchaseItem.update({
            where: { id: item.id },
            data: {
              baseUnitCost: f.baseUnitCost.toFixed(4),
              allocatedExtra: f.extra.toFixed(2),
              taxAmount: f.tax.toFixed(2),
              lineTotal: f.lineTotal.toFixed(2),
            },
          });
        }
      }
      await tx.purchase.update({
        where: { id },
        data: {
          supplierId,
          purchaseDate: new Date(date),
          ...(dto.supplierInvoiceNo !== undefined
            ? { supplierInvoiceNo: dto.supplierInvoiceNo }
            : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          subtotal: figures.subtotal.toFixed(2),
          discountTotal: figures.discountTotal.toFixed(2),
          additionalCosts: figures.additionalCosts.toFixed(2),
          taxTotal: figures.taxTotal.toFixed(2),
          roundOff: figures.roundOff.toFixed(2),
          total: figures.total.toFixed(2),
        },
      });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId,
        actorId: t.userId,
        action: 'purchase.update',
        entityType: 'purchase',
        entityId: id,
        before: { total: m2(current.total), lines: current.items.length },
        after: { total: figures.total.toFixed(2), lines: inputs.length },
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return this.view(tx, t.organizationId, id);
    });
  }

  async confirm(t: TenantContext, id: string, meta: Meta) {
    const branchId = this.branch(t);
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockPurchase(tx, { organizationId: t.organizationId, branchId }, id);
      if (locked.status !== 'DRAFT') {
        throw new AppException(
          'PURCHASE_NOT_DRAFT',
          `This purchase is already ${locked.status.toLowerCase()}`,
          409,
        );
      }
      await tx.purchase.update({ where: { id }, data: { status: 'CONFIRMED' } });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId,
        actorId: t.userId,
        action: 'purchase.confirm',
        entityType: 'purchase',
        entityId: id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return this.view(tx, t.organizationId, id);
    });
  }

  /** Cancels an order nothing has been received for. Received goods are undone with a purchase return instead. */
  async cancel(t: TenantContext, id: string, dto: CancelPurchaseDto, meta: Meta) {
    const branchId = this.branch(t);
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockPurchase(tx, { organizationId: t.organizationId, branchId }, id);
      if (locked.status === 'CANCELLED') {
        throw new AppException('PURCHASE_CANCELLED', 'This purchase is already cancelled', 409);
      }
      if (locked.status === 'PARTIALLY_RECEIVED' || locked.status === 'RECEIVED') {
        throw new AppException(
          'PURCHASE_HAS_RECEIPTS',
          'Goods were already received. Use a purchase return to send them back',
          409,
        );
      }
      await tx.purchase.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: dto.reason },
      });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId,
        actorId: t.userId,
        action: 'purchase.cancel',
        entityType: 'purchase',
        entityId: id,
        reason: dto.reason,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return this.view(tx, t.organizationId, id);
    });
  }

  // ------------------------------------------------------------------ receive

  async receive(t: TenantContext, key: string, id: string, dto: ReceivePurchaseDto, meta: Meta) {
    const branchId = this.branch(t);
    return this.idempotency.execute(
      { organizationId: t.organizationId, userId: t.userId },
      key,
      'POST /purchases/:id/receive',
      { branchId, id, ...dto },
      async (tx) => {
        await this.receiveInTx(tx, t, id, dto.lines, meta);
        return this.view(tx, t.organizationId, id);
      },
    );
  }

  /**
   * Receives goods into stock and posts the matching payable, in the caller's transaction.
   * Stock and money move together: if either fails, neither happens.
   * Only goods actually received increase stock and what the shop owes.
   */
  private async receiveInTx(
    tx: Tx,
    t: TenantContext,
    purchaseId: string,
    lines: ReceivePurchaseDto['lines'],
    meta: Meta,
  ): Promise<void> {
    const branchId = this.branch(t);
    const locked = await lockPurchase(
      tx,
      { organizationId: t.organizationId, branchId },
      purchaseId,
    );
    if (locked.status === 'CANCELLED') {
      throw new AppException('PURCHASE_CANCELLED', 'This purchase was cancelled', 409);
    }
    if (locked.status === 'RECEIVED') {
      throw new AppException(
        'PURCHASE_ALREADY_RECEIVED',
        'All goods of this purchase were already received',
        409,
      );
    }

    const items = await tx.purchaseItem.findMany({ where: { purchaseId }, orderBy: { id: 'asc' } });
    const byId = new Map(items.map((i) => [i.id, i]));

    interface Receipt {
      itemId: string;
      base: Decimal;
      batchNumber?: string;
      expiryDate?: string;
    }
    const receipts: Receipt[] = [];
    if (!lines) {
      for (const i of items) {
        const remaining = dec(i.baseQuantity).minus(dec(i.receivedBaseQuantity));
        if (remaining.gt(0)) {
          receipts.push({
            itemId: i.id,
            base: remaining,
            batchNumber: i.batchNumber ?? undefined,
            expiryDate: i.expiryDate ? day(i.expiryDate) : undefined,
          });
        }
      }
    } else {
      const seen = new Set<string>();
      for (const l of lines) {
        const i = byId.get(l.itemId);
        if (!i)
          throw new DomainError(
            'ITEM_NOT_IN_PURCHASE',
            'This item does not belong to the purchase',
            { itemId: l.itemId },
          );
        if (seen.has(l.itemId))
          throw new DomainError('DUPLICATE_RECEIPT_LINE', 'List each item once per receipt');
        seen.add(l.itemId);
        if (l.expiryDate && !isRealIsoDate(l.expiryDate)) {
          throw new DomainError('EXPIRY_INVALID', 'expiryDate must be a real date, YYYY-MM-DD');
        }
        const base = toBaseQuantity(new Decimal(l.quantity), dec(i.conversionFactorSnapshot));
        const remaining = dec(i.baseQuantity).minus(dec(i.receivedBaseQuantity));
        if (base.gt(remaining)) {
          throw new DomainError(
            'RECEIPT_EXCEEDS_ORDER',
            'More than the outstanding quantity was entered',
            {
              itemId: l.itemId,
              remainingBaseQuantity: remaining.toFixed(3),
              enteredBaseQuantity: base.toFixed(3),
            },
          );
        }
        receipts.push({
          itemId: l.itemId,
          base,
          batchNumber: l.batchNumber ?? i.batchNumber ?? undefined,
          expiryDate: l.expiryDate ?? (i.expiryDate ? day(i.expiryDate) : undefined),
        });
      }
    }
    if (receipts.length === 0)
      throw new DomainError('NOTHING_TO_RECEIVE', 'There is nothing left to receive');

    // Fixed order (product, then line) so concurrent receipts take stock locks in the same order.
    receipts.sort((a, b) => {
      const pa = byId.get(a.itemId)!.productId;
      const pb = byId.get(b.itemId)!.productId;
      return pa < pb ? -1 : pa > pb ? 1 : a.itemId < b.itemId ? -1 : 1;
    });

    const stockCtx: StockContext = {
      organizationId: t.organizationId,
      branchId,
      actorId: t.userId,
    };
    let billedDelta = new Decimal(0);
    const receivedSoFar = new Map(items.map((i) => [i.id, dec(i.receivedBaseQuantity)]));
    for (const r of receipts) {
      const i = byId.get(r.itemId)!;
      await this.inventory.receive(tx, stockCtx, {
        productId: i.productId,
        type: 'PURCHASE_RECEIPT',
        baseQuantity: r.base,
        unitCost: dec(i.baseUnitCost),
        batch:
          r.batchNumber || r.expiryDate
            ? { batchNumber: r.batchNumber, expiryDate: r.expiryDate }
            : undefined,
        reference: { type: 'PURCHASE', id: purchaseId, lineId: i.id },
      });

      const ordered = dec(i.baseQuantity);
      const receivedNow = receivedSoFar.get(i.id)!.plus(r.base);
      receivedSoFar.set(i.id, receivedNow);
      const payable = dec(i.lineTotal).plus(dec(i.allocatedExtra));
      const billedTarget = cumulativeAmount(payable, receivedNow, ordered);
      billedDelta = billedDelta.plus(billedTarget.minus(dec(i.billedAmount)));
      await tx.purchaseItem.update({
        where: { id: i.id },
        data: {
          receivedBaseQuantity: receivedNow.toFixed(3),
          billedAmount: billedTarget.toFixed(2),
        },
      });
    }

    const fullyReceived = items.every((i) => receivedSoFar.get(i.id)!.equals(dec(i.baseQuantity)));
    if (fullyReceived) billedDelta = billedDelta.plus(dec(locked.roundOff)); // round-off settles with the last receipt
    const purchase = await tx.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      select: { billedTotal: true },
    });
    await tx.purchase.update({
      where: { id: purchaseId },
      data: {
        status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
        receivedAt: fullyReceived ? new Date() : null,
        billedTotal: dec(purchase.billedTotal).plus(billedDelta).toFixed(2),
      },
    });

    // Posted last: the supplier lock is always the final lock (see SupplierLedgerService).
    await this.ledger.post(tx, {
      organizationId: t.organizationId,
      branchId,
      supplierId: locked.supplierId,
      actorId: t.userId,
      type: 'PURCHASE',
      amount: billedDelta,
      referenceType: 'PURCHASE',
      referenceId: purchaseId,
      description: `Goods received on ${locked.purchaseNumber}`,
    });
    await this.audit.record(tx, {
      organizationId: t.organizationId,
      branchId,
      actorId: t.userId,
      action: 'purchase.receive',
      entityType: 'purchase',
      entityId: purchaseId,
      after: {
        lines: receipts.length,
        payableAdded: billedDelta.toFixed(2),
        status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
      },
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
    });
  }

  // ------------------------------------------------------------------ reads

  async get(t: TenantContext, id: string) {
    return this.view(this.prisma, t.organizationId, id, this.branch(t));
  }

  async list(t: TenantContext, q: PurchasesQuery) {
    const branchId = this.branch(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    let idFilter: { id: { in: string[] } } | undefined;
    if (q.unpaid) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM purchases p
        WHERE p.organization_id = ${t.organizationId}::uuid AND p.branch_id = ${branchId}::uuid
          AND p.status IN ('PARTIALLY_RECEIVED', 'RECEIVED')
          AND p.billed_total - p.returned_total - COALESCE((
            SELECT sum(pp.amount) FROM purchase_payments pp JOIN payments pay ON pay.id = pp.payment_id
            WHERE pp.purchase_id = p.id AND pay.status = 'COMPLETED'), 0) > 0`;
      idFilter = { id: { in: rows.map((r) => r.id) } };
    }
    const where: Prisma.PurchaseWhereInput = {
      organizationId: t.organizationId,
      branchId,
      ...(idFilter ?? {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.from || q.to
        ? {
            purchaseDate: {
              ...(q.from ? { gte: dateOnly(q.from, 'from') } : {}),
              ...(q.to ? { lte: dateOnly(q.to, 'to') } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { purchaseNumber: { contains: q.q, mode: 'insensitive' } },
              { supplierInvoiceNo: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { supplier: { select: { id: true, name: true } } },
      }),
      this.prisma.purchase.count({ where }),
    ]);
    const paid = await this.paidByPurchase(
      this.prisma,
      rows.map((r) => r.id),
    );
    const items = rows.map((p) => {
      const paidTotal = paid.get(p.id) ?? new Decimal(0);
      return {
        id: p.id,
        purchaseNumber: p.purchaseNumber,
        supplierInvoiceNo: p.supplierInvoiceNo,
        status: p.status,
        purchaseDate: day(p.purchaseDate),
        supplier: p.supplier,
        total: m2(p.total),
        billedTotal: m2(p.billedTotal),
        paidTotal: paidTotal.toFixed(2),
        outstanding: Decimal.max(
          dec(p.billedTotal).minus(dec(p.returnedTotal)).minus(paidTotal),
          0,
        ).toFixed(2),
      };
    });
    return new Paginated(items, { page, pageSize, total });
  }

  // ------------------------------------------------------------------ helpers

  private branch(t: TenantContext): string {
    if (!t.branchId)
      throw new AppException('BRANCH_REQUIRED', 'x-branch-id header is required', 400);
    return t.branchId;
  }

  private purchaseDate(input?: string): string {
    const today = todayInIndia();
    if (!input) return today;
    if (!isRealIsoDate(input))
      throw new DomainError(
        'PURCHASE_DATE_INVALID',
        'purchaseDate must be a real date, YYYY-MM-DD',
      );
    if (input > today)
      throw new DomainError('PURCHASE_DATE_FUTURE', 'A purchase cannot be dated in the future');
    return input;
  }

  private async assertInvoiceNoFree(
    tx: Tx,
    organizationId: string,
    supplierId: string,
    invoiceNo: string | undefined | null,
    exceptId?: string,
  ) {
    if (!invoiceNo) return;
    const clash = await tx.purchase.findFirst({
      where: {
        organizationId,
        supplierId,
        supplierInvoiceNo: { equals: invoiceNo, mode: 'insensitive' },
        status: { not: 'CANCELLED' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, purchaseNumber: true },
    });
    if (clash) {
      throw new AppException(
        'SUPPLIER_INVOICE_DUPLICATE',
        `This supplier bill was already entered as ${clash.purchaseNumber}`,
        409,
        { purchaseId: clash.id },
      );
    }
  }

  /** Checks every line against the catalogue (active product, purchase-enabled unit, exact base quantity). */
  private async prepareLines(
    db: Tx,
    organizationId: string,
    items: PurchaseItemDto[],
  ): Promise<PreparedLine[]> {
    const rulesCache = new Map<string, Awaited<ReturnType<ProductsService['stockRules']>>>();
    const out: PreparedLine[] = [];
    for (const [index, it] of items.entries()) {
      const line = index + 1;
      let rules = rulesCache.get(it.productId);
      if (!rules) {
        rules = await this.catalog.stockRules(db, organizationId, it.productId);
        rulesCache.set(it.productId, rules);
      }
      if (rules.status !== 'ACTIVE') {
        throw new DomainError('PRODUCT_NOT_ACTIVE', `${rules.name} is not active`, { line });
      }
      const conv = rules.conversions.get(it.unitId);
      if (!conv) {
        throw new DomainError('UNIT_NOT_CONFIGURED', `This unit is not set up for ${rules.name}`, {
          line,
        });
      }
      if (!conv.isPurchaseUnit) {
        throw new DomainError(
          'UNIT_NOT_PURCHASE_ENABLED',
          `${conv.unitCode} is not a purchase unit for ${rules.name}`,
          { line },
        );
      }
      if ((it.batchNumber || it.expiryDate) && !(rules.trackBatch || rules.trackExpiry)) {
        throw new DomainError(
          'BATCH_NOT_TRACKED',
          `${rules.name} does not track batches or expiry dates`,
          { line },
        );
      }
      if (it.expiryDate && !isRealIsoDate(it.expiryDate)) {
        throw new DomainError('EXPIRY_INVALID', 'expiryDate must be a real date, YYYY-MM-DD', {
          line,
        });
      }
      const quantity = new Decimal(it.quantity);
      const baseQuantity = toBaseQuantity(quantity, conv.factorToBase);
      assertStockBaseQuantity(rules.rules, baseQuantity);
      out.push({
        item: it,
        factor: conv.factorToBase,
        quantity,
        baseQuantity,
        input: {
          quantity,
          baseQuantity,
          unitCost: new Decimal(it.unitCost),
          discount: new Decimal(it.discount ?? 0),
          taxRatePercent: new Decimal(it.taxRatePercent ?? 0),
        },
      });
    }
    return out;
  }

  private itemData(
    organizationId: string,
    p: PreparedLine,
    f: ReturnType<typeof computePurchase>['lines'][number],
  ) {
    return {
      organizationId,
      productId: p.item.productId,
      unitId: p.item.unitId,
      quantity: p.quantity.toFixed(3),
      conversionFactorSnapshot: p.factor.toFixed(6),
      baseQuantity: p.baseQuantity.toFixed(3),
      unitCost: p.input.unitCost.toFixed(4),
      baseUnitCost: f.baseUnitCost.toFixed(4),
      allocatedExtra: f.extra.toFixed(2),
      discountAmount: f.discount.toFixed(2),
      taxRatePercent: p.input.taxRatePercent.toFixed(4),
      taxAmount: f.tax.toFixed(2),
      lineTotal: f.lineTotal.toFixed(2),
      batchNumber: p.item.batchNumber,
      expiryDate: p.item.expiryDate ? new Date(p.item.expiryDate) : undefined,
    };
  }

  private async paidByPurchase(db: Db, ids: string[]): Promise<Map<string, Decimal>> {
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRaw<{ purchase_id: string; paid: string }[]>`
      SELECT pp.purchase_id, sum(pp.amount)::text AS paid
      FROM purchase_payments pp JOIN payments pay ON pay.id = pp.payment_id
      WHERE pp.purchase_id = ANY(${ids}::uuid[]) AND pay.status = 'COMPLETED'
      GROUP BY pp.purchase_id`;
    return new Map(rows.map((r) => [r.purchase_id, new Decimal(r.paid)]));
  }

  /** Full purchase with items, payments and what is still owed. Branch-scoped when `branchId` is given. */
  async view(db: Db, organizationId: string, id: string, branchId?: string) {
    const p: PurchaseWithItems | null = await db.purchase.findFirst({
      where: { id, organizationId, ...(branchId ? { branchId } : {}) },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: { product: { select: { name: true, sku: true } } },
        },
        supplier: { select: { id: true, name: true } },
        payments: { include: { payment: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!p) throw new AppException('PURCHASE_NOT_FOUND', 'Purchase not found', 404);
    const units = await db.unitOfMeasurement.findMany({
      where: { id: { in: [...new Set(p.items.map((i) => i.unitId))] } },
      select: { id: true, code: true },
    });
    const unitCode = new Map(units.map((u) => [u.id, u.code]));
    const paid = p.payments
      .filter((x) => x.payment.status === 'COMPLETED')
      .reduce((a, x) => a.plus(dec(x.amount)), new Decimal(0));
    return {
      id: p.id,
      purchaseNumber: p.purchaseNumber,
      supplierInvoiceNo: p.supplierInvoiceNo,
      status: p.status,
      purchaseDate: day(p.purchaseDate),
      receivedAt: p.receivedAt,
      supplier: p.supplier,
      subtotal: m2(p.subtotal),
      discountTotal: m2(p.discountTotal),
      additionalCosts: m2(p.additionalCosts),
      taxTotal: m2(p.taxTotal),
      roundOff: m2(p.roundOff),
      total: m2(p.total),
      billedTotal: m2(p.billedTotal),
      returnedTotal: m2(p.returnedTotal),
      paidTotal: paid.toFixed(2),
      outstanding: Decimal.max(
        dec(p.billedTotal).minus(dec(p.returnedTotal)).minus(paid),
        0,
      ).toFixed(2),
      notes: p.notes,
      cancelReason: p.cancelReason,
      createdAt: p.createdAt,
      items: p.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.product.name,
        sku: i.product.sku,
        unitId: i.unitId,
        unitCode: unitCode.get(i.unitId) ?? null,
        quantity: dec(i.quantity).toFixed(3),
        baseQuantity: dec(i.baseQuantity).toFixed(3),
        receivedBaseQuantity: dec(i.receivedBaseQuantity).toFixed(3),
        remainingBaseQuantity: dec(i.baseQuantity).minus(dec(i.receivedBaseQuantity)).toFixed(3),
        returnedBaseQuantity: dec(i.returnedBaseQuantity).toFixed(3),
        unitCost: dec(i.unitCost).toFixed(4),
        baseUnitCost: dec(i.baseUnitCost).toFixed(4),
        discountAmount: m2(i.discountAmount),
        taxRatePercent: dec(i.taxRatePercent).toFixed(4),
        taxAmount: m2(i.taxAmount),
        allocatedExtra: m2(i.allocatedExtra),
        lineTotal: m2(i.lineTotal),
        billedAmount: m2(i.billedAmount),
        returnedAmount: m2(i.returnedAmount),
        batchNumber: i.batchNumber,
        expiryDate: i.expiryDate ? day(i.expiryDate) : null,
      })),
      payments: p.payments.map((x) => ({
        paymentId: x.paymentId,
        amount: m2(x.amount),
        status: x.payment.status,
        method: x.payment.method,
        paidAt: x.payment.paidAt,
        receiptNumber: x.payment.receiptNumber,
      })),
    };
  }
}
