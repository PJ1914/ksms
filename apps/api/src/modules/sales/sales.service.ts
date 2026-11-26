import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { RolePermissionService } from '../../common/auth/role-permission.service';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DocumentNumberService } from '../../common/numbering/document-number.service';
import { Paginated } from '../../common/pagination/paginated';
import { timestampRange } from '../../common/utils/dates';
import { uuidv7 } from '../../common/utils/ids';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { ProductsService, requireForSale } from '../catalog/products.service';
import { CustomerLedgerService } from '../customers/customer-ledger.service';
import { CashbookService } from '../finance/cashbook.service';
import { InventoryService, type StockContext } from '../inventory/inventory.service';
import { computeSale, effectiveUnitPrice, grossFromUnitPrice, settle } from './domain/sale-math';
import type { CreateSaleDto, PreviewSaleDto, SaleItemDto, SalesQuery } from './sales.dto';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const dec = (v: { toString(): string }) => new Decimal(v.toString());
const m2 = (v: { toString(): string }) => dec(v).toFixed(2);

export interface Permissions {
  isOwner: boolean;
  keys: ReadonlySet<string>;
}
/** Longest a checkout may take before it is rolled back (nothing is saved on a timeout). */
const CHECKOUT_TIMEOUT_MS = 60_000;

export const may = (p: Permissions, key: string) => p.isOwner || p.keys.has(key);

/**
 * Checkout. ONE database transaction does everything, or nothing:
 *   prices (from the catalogue) -> discounts and limits -> rounding -> stock out (inventory engine, FEFO, never
 *   below zero) -> bill number -> sale and lines with snapshots -> payments and cashbook lines -> credit on the
 *   customer's account (credit limit checked under the customer lock) -> audit.
 * The Idempotency-Key makes a retried or double-tapped checkout return the first result instead of selling twice.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: ProductsService,
    private readonly inventory: InventoryService,
    private readonly customerLedger: CustomerLedgerService,
    private readonly cashbook: CashbookService,
    private readonly numbers: DocumentNumberService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly rolePerms: RolePermissionService,
  ) {}

  async checkout(t: TenantContext, key: string, dto: CreateSaleDto, meta: Meta) {
    const branchId = branchOf(t);
    const perms = await this.rolePerms.get(t.roleId);

    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /sales',
      { branchId, ...dto },
      async (tx) => {
        const [org, branch] = await Promise.all([
          tx.organization.findUniqueOrThrow({
            where: { id: t.organizationId },
            select: {
              name: true,
              legalName: true,
              pan: true,
              phone: true,
              gstEnabled: true,
              defaultTaxMode: true,
              maxCashierDiscountPercent: true,
            },
          }),
          tx.branch.findUniqueOrThrow({
            where: { id: branchId },
            select: {
              id: true,
              code: true,
              name: true,
              addressLine: true,
              city: true,
              state: true,
              pincode: true,
              stateCode: true,
              gstin: true,
              phone: true,
            },
          }),
        ]);

        const priced = await this.priceBill(tx, t, dto, perms, org, branch);
        const { customer, lines, figures, overrides, placeOfSupplyStateCode, interState } = priced;

        // ---- how it is paid
        const payments = dto.payments.map((p) => ({ ...p, amount: new Decimal(p.amount) }));
        const { paid, credit } = settle(figures.total, payments);
        // Going over a customer's credit limit must be asked for explicitly AND be allowed: even the owner's
        // counter is stopped by the limit unless the bill says so (overrideCreditLimit).
        const overrideLimit = dto.overrideCreditLimit === true;
        if (overrideLimit && !may(perms, 'credit.override_limit')) {
          throw new AppException(
            'FORBIDDEN',
            'You may not sell beyond a customer credit limit',
            403,
            {
              required: ['credit.override_limit'],
            },
          );
        }
        if (credit.gt(0) && !customer) {
          throw new DomainError(
            'CREDIT_NEEDS_CUSTOMER',
            'Choose the customer to put the unpaid amount on their account',
            {
              unpaid: credit.toFixed(2),
            },
          );
        }

        // ---- stock out (inventory engine: locks, FEFO, never below zero). Lines in product order, no deadlocks.
        // Time-ordered ids: the bill keeps its lines in the order they were rung up.
        const saleId = uuidv7();
        const itemIds = lines.map(() => uuidv7());
        const stockCtx: StockContext = {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
        };
        const stock = await this.inventory.issueMany(
          tx,
          stockCtx,
          lines.map((l, i) => ({
            productId: l.item.productId,
            type: 'SALE' as const,
            baseQuantity: l.price.baseQuantity,
            reference: { type: 'SALE', id: saleId, lineId: itemIds[i]! },
          })),
        );

        // ---- invoice & bill number (taken after stock, so refused bills waste no number)
        const invoiceType = !org.gstEnabled
          ? 'NORMAL'
          : figures.taxTotal.gt(0)
            ? 'GST'
            : 'BILL_OF_SUPPLY';
        const series = !org.gstEnabled ? 'B' : invoiceType === 'GST' ? 'INV' : 'BOS';
        const number = await this.numbers.next(
          tx,
          { organizationId: t.organizationId, branchId },
          'INVOICE',
          series,
          undefined,
          // GST documents must fit the 16-character limit of Rule 46; plain retail bills keep the long form
          org.gstEnabled ? 'compact' : 'full',
        );
        await tx.sale.create({
          data: {
            id: saleId,
            organizationId: t.organizationId,
            branchId,
            customerId: customer?.id ?? null,
            status: 'COMPLETED',
            saleNumber: number.number,
            subtotal: figures.subtotal.toFixed(2),
            discountTotal: figures.discountTotal.toFixed(2),
            taxableTotal: figures.taxableTotal.toFixed(2),
            cgstTotal: figures.cgstTotal.toFixed(2),
            sgstTotal: figures.sgstTotal.toFixed(2),
            igstTotal: figures.igstTotal.toFixed(2),
            roundOff: figures.roundOff.toFixed(2),
            total: figures.total.toFixed(2),
            paidTotal: paid.toFixed(2),
            creditAmount: credit.toFixed(2),
            taxMode: org.defaultTaxMode,
            placeOfSupplyStateCode,
            soldById: t.userId,
            items: {
              create: lines.map((l, i) => {
                const f = figures.lines[i]!;
                return {
                  id: itemIds[i]!,
                  organizationId: t.organizationId,
                  productId: l.price.productId,
                  productNameSnapshot: l.price.name,
                  skuSnapshot: l.price.sku,
                  hsnSnapshot: l.price.hsnCode,
                  unitId: l.price.unitId,
                  unitCodeSnapshot: l.price.unitCode,
                  quantity: l.quantity.toFixed(3),
                  conversionFactorSnapshot: l.price.factor.toFixed(6),
                  baseQuantity: l.price.baseQuantity.toFixed(3),
                  unitPrice: effectiveUnitPrice(f.gross, l.quantity).toFixed(2),
                  mrpSnapshot: l.price.mrp?.toFixed(2) ?? null,
                  discountAmount: f.discount.toFixed(2),
                  taxRatePercent: f.taxRatePercent.toFixed(4),
                  taxableValue: f.taxableValue.toFixed(2),
                  cgstAmount: f.cgst.toFixed(2),
                  sgstAmount: f.sgst.toFixed(2),
                  igstAmount: f.igst.toFixed(2),
                  lineTotal: f.net.toFixed(2),
                  unitCostSnapshot: stock[i]!.averageCost,
                };
              }),
            },
          },
        });

        await tx.invoice.create({
          data: {
            id: uuidv7(),
            organizationId: t.organizationId,
            branchId,
            saleId,
            type: invoiceType,
            status: 'ISSUED',
            series: number.series,
            sequenceNumber: number.sequence,
            invoiceNumber: number.number,
            sellerSnapshot: {
              organizationName: org.name,
              legalName: org.legalName,
              branchName: branch.name,
              branchCode: branch.code,
              addressLine: branch.addressLine,
              city: branch.city,
              state: branch.state,
              pincode: branch.pincode,
              stateCode: branch.stateCode,
              gstin: branch.gstin,
              pan: org.pan,
              phone: branch.phone ?? org.phone,
            },
            buyerSnapshot: customer
              ? {
                  id: customer.id,
                  name: customer.name,
                  phone: customer.phone,
                  gstin: customer.gstin,
                  stateCode: customer.stateCode,
                  addressLine: customer.addressLine,
                }
              : Prisma.JsonNull,
            totalsSnapshot: {
              subtotal: figures.subtotal.toFixed(2),
              discountTotal: figures.discountTotal.toFixed(2),
              taxableTotal: figures.taxableTotal.toFixed(2),
              cgstTotal: figures.cgstTotal.toFixed(2),
              sgstTotal: figures.sgstTotal.toFixed(2),
              igstTotal: figures.igstTotal.toFixed(2),
              taxTotal: figures.taxTotal.toFixed(2),
              roundOff: figures.roundOff.toFixed(2),
              total: figures.total.toFixed(2),
              paidTotal: paid.toFixed(2),
              creditAmount: credit.toFixed(2),
              taxMode: org.defaultTaxMode,
              placeOfSupplyStateCode,
              interState,
              lines: lines.map((l, i) => {
                const f = figures.lines[i]!;
                return {
                  saleItemId: itemIds[i]!,
                  productId: l.price.productId,
                  name: l.price.name,
                  sku: l.price.sku,
                  hsn: l.price.hsnCode,
                  unitCode: l.price.unitCode,
                  quantity: l.quantity.toFixed(3),
                  unitPrice: effectiveUnitPrice(f.gross, l.quantity).toFixed(2),
                  gross: f.gross.toFixed(2),
                  discount: f.discount.toFixed(2),
                  taxMode: f.taxMode,
                  taxRatePercent: f.taxRatePercent.toFixed(4),
                  taxableValue: f.taxableValue.toFixed(2),
                  cgst: f.cgst.toFixed(2),
                  sgst: f.sgst.toFixed(2),
                  igst: f.igst.toFixed(2),
                  lineTotal: f.net.toFixed(2),
                };
              }),
            },
          },
        });

        // ---- money received now: one payment per method, each with its cashbook line
        for (const p of payments) {
          const paymentId = uuidv7();
          await tx.payment.create({
            data: {
              id: paymentId,
              organizationId: t.organizationId,
              branchId,
              direction: 'IN',
              purpose: 'SALE',
              method: p.method,
              amount: p.amount.toFixed(2),
              customerId: customer?.id ?? null,
              referenceNo: p.referenceNo,
              recordedById: t.userId,
            },
          });
          await tx.salePayment.create({
            data: {
              organizationId: t.organizationId,
              saleId,
              paymentId,
              amount: p.amount.toFixed(2),
            },
          });
          await this.cashbook.record(tx, {
            organizationId: t.organizationId,
            branchId,
            actorId: t.userId,
            kind: 'SALE_RECEIPT',
            method: p.method,
            amount: p.amount,
            paymentId,
            referenceType: 'SALE',
            referenceId: saleId,
            description: `Bill ${number.number}`,
          });
        }

        // ---- the unpaid part goes on the customer's account (customer lock LAST; credit limit checked under it)
        if (credit.gt(0)) {
          await this.customerLedger.post(tx, {
            organizationId: t.organizationId,
            branchId,
            customerId: customer!.id,
            actorId: t.userId,
            type: 'CREDIT_SALE',
            amount: credit,
            referenceType: 'SALE',
            referenceId: saleId,
            description: `Bill ${number.number}`,
            creditCheck: { mayExceedLimit: overrideLimit },
          });
        }

        if (dto.heldBillId) {
          await tx.heldBill.updateMany({
            where: {
              id: dto.heldBillId,
              organizationId: t.organizationId,
              branchId,
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          });
        }

        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'sale.create',
          entityType: 'sale',
          entityId: saleId,
          after: {
            number: number.number,
            total: figures.total.toFixed(2),
            paid: paid.toFixed(2),
            credit: credit.toFixed(2),
            discount: figures.discountTotal.toFixed(2),
            lines: lines.length,
            ...(overrideLimit ? { creditLimitOverride: true } : {}),
            ...(overrides.length ? { priceOverrides: overrides } : {}),
          },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        });
        return this.view(tx, t.organizationId, saleId);
      },
      // A bill is about 15 database calls per line, so a long bill on a slow link needs more than the usual 20 seconds.
      { timeoutMs: CHECKOUT_TIMEOUT_MS },
    );
  }

  /**
   * The cart as the counter should show it: every figure comes from the same code as checkout (catalogue prices,
   * discounts and their limits, rounding), but nothing is saved and no stock moves. Stock and credit-limit
   * problems are reported as warnings so the screen can say so before the customer pays.
   */
  async preview(t: TenantContext, dto: PreviewSaleDto) {
    const branchId = branchOf(t);
    const perms = await this.rolePerms.get(t.roleId);
    const [org, branch] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: t.organizationId },
        select: { gstEnabled: true, defaultTaxMode: true, maxCashierDiscountPercent: true },
      }),
      this.prisma.branch.findUniqueOrThrow({
        where: { id: branchId },
        select: { stateCode: true, gstin: true },
      }),
    ]);
    const { customer, lines, figures, placeOfSupplyStateCode, interState } = await this.priceBill(
      this.prisma,
      t,
      dto,
      perms,
      org,
      branch,
    );
    const payments = (dto.payments ?? []).map((p) => ({ ...p, amount: new Decimal(p.amount) }));
    const { paid, credit } = settle(figures.total, payments);

    // stock: total wanted per product against what is on the shelf (an early warning, not a guarantee)
    const wanted = new Map<string, Decimal>();
    for (const l of lines) {
      wanted.set(
        l.price.productId,
        (wanted.get(l.price.productId) ?? new Decimal(0)).plus(l.price.baseQuantity),
      );
    }
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { branchId, productId: { in: [...wanted.keys()] } },
      select: { productId: true, quantityOnHand: true, reservedQty: true },
    });
    const have = new Map(
      balances.map((b) => [b.productId, dec(b.quantityOnHand).minus(dec(b.reservedQty))]),
    );
    const stockWarnings = [...wanted.entries()]
      .map(([productId, requested]) => ({
        productId,
        requested,
        available: have.get(productId) ?? new Decimal(0),
      }))
      .filter((w) => w.requested.gt(w.available))
      .map((w) => ({
        productId: w.productId,
        requestedBaseQuantity: w.requested.toFixed(3),
        availableBaseQuantity: Decimal.max(w.available, 0).toFixed(3),
      }));

    let creditWarning: { creditLimit: string; balance: string; available: string } | null = null;
    if (customer && credit.gt(0)) {
      const c = await this.prisma.customer.findUniqueOrThrow({
        where: { id: customer.id },
        select: { creditLimit: true, balance: true },
      });
      if (c.creditLimit !== null && dec(c.balance).plus(credit).gt(dec(c.creditLimit))) {
        creditWarning = {
          creditLimit: m2(c.creditLimit),
          balance: m2(c.balance),
          available: Decimal.max(dec(c.creditLimit).minus(dec(c.balance)), 0).toFixed(2),
        };
      }
    }

    return {
      customer,
      lines: lines.map((l, i) => {
        const f = figures.lines[i]!;
        return {
          productId: l.price.productId,
          name: l.price.name,
          unitId: l.price.unitId,
          unitCode: l.price.unitCode,
          quantity: l.quantity.toFixed(3),
          baseQuantity: l.price.baseQuantity.toFixed(3),
          unitPrice: effectiveUnitPrice(f.gross, l.quantity).toFixed(2),
          priceSource: l.price.priceSource,
          gross: f.gross.toFixed(2),
          discount: f.discount.toFixed(2),
          taxRatePercent: f.taxRatePercent.toFixed(4),
          taxableValue: f.taxableValue.toFixed(2),
          cgst: f.cgst.toFixed(2),
          sgst: f.sgst.toFixed(2),
          igst: f.igst.toFixed(2),
          tax: f.tax.toFixed(2),
          net: f.net.toFixed(2),
        };
      }),
      subtotal: figures.subtotal.toFixed(2),
      discountTotal: figures.discountTotal.toFixed(2),
      taxableTotal: figures.taxableTotal.toFixed(2),
      cgstTotal: figures.cgstTotal.toFixed(2),
      sgstTotal: figures.sgstTotal.toFixed(2),
      igstTotal: figures.igstTotal.toFixed(2),
      taxTotal: figures.taxTotal.toFixed(2),
      roundOff: figures.roundOff.toFixed(2),
      total: figures.total.toFixed(2),
      paid: paid.toFixed(2),
      credit: credit.toFixed(2),
      placeOfSupplyStateCode,
      interState,
      warnings: { stock: stockWarnings, creditLimit: creditWarning },
    };
  }

  /**
   * Prices a bill exactly as checkout does: the customer, every line from the catalogue (or an allowed typed price),
   * the discounts and their limits, GST (when enabled) and the rounded total. Read-only, so the preview can use it too.
   */
  private async priceBill(
    db: Db,
    t: TenantContext,
    dto: {
      customerId?: string;
      items: SaleItemDto[];
      billDiscount?: string;
      placeOfSupplyStateCode?: string;
    },
    perms: Permissions,
    org: {
      gstEnabled: boolean;
      defaultTaxMode: 'INCLUSIVE' | 'EXCLUSIVE';
      maxCashierDiscountPercent: { toString(): string };
    },
    branch: { stateCode: string | null; gstin: string | null },
  ) {
    if (org.gstEnabled && (!branch.gstin || !branch.stateCode)) {
      throw new DomainError(
        'BRANCH_GST_INCOMPLETE',
        'Set the branch GSTIN and 2-digit state code before billing with GST enabled',
      );
    }

    let customer: {
      id: string;
      name: string;
      phone: string | null;
      gstin: string | null;
      stateCode: string | null;
      addressLine: string | null;
    } | null = null;
    if (dto.customerId) {
      customer = await db.customer.findFirst({
        where: { id: dto.customerId, organizationId: t.organizationId, deletedAt: null },
        select: {
          id: true,
          name: true,
          phone: true,
          gstin: true,
          stateCode: true,
          addressLine: true,
        },
      });
      if (!customer) throw new AppException('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    }

    // ---- price every line from the catalogue (or an allowed typed price)
    const overrides: { line: number; catalogue: string; typed: string }[] = [];
    const lines = [];
    // One query for every product on the bill, then each line is priced from memory (FIXES F8).
    const products = await this.catalog.loadForSale(
      db,
      t.organizationId,
      dto.items.map((i) => i.productId),
    );
    for (const [index, item] of dto.items.entries()) {
      const quantity = new Decimal(item.quantity);
      const price = this.catalog.priceLine(
        requireForSale(products, item.productId),
        item.unitId,
        quantity,
      );
      let gross = price.amount;
      if (item.unitPrice !== undefined) {
        if (!may(perms, 'price.override')) {
          throw new AppException('FORBIDDEN', 'You may not change the selling price', 403, {
            required: ['price.override'],
          });
        }
        gross = grossFromUnitPrice(quantity, new Decimal(item.unitPrice));
        overrides.push({
          line: index + 1,
          catalogue: price.amount.toFixed(2),
          typed: gross.toFixed(2),
        });
      }
      if (org.gstEnabled && price.isTaxable && price.gstRatePercent === null) {
        // never bill a taxable product at 0% because its rate was left empty
        throw new DomainError(
          'PRODUCT_GST_RATE_MISSING',
          `${price.name} is marked taxable but has no GST rate. Set its GST rate first`,
          { line: index + 1, productId: price.productId },
        );
      }
      const taxRatePercent =
        org.gstEnabled && price.isTaxable
          ? (price.gstRatePercent ?? new Decimal(0))
          : new Decimal(0);
      const taxMode = price.taxMode ?? org.defaultTaxMode;
      lines.push({
        item,
        quantity,
        price,
        gross,
        lineDiscount: new Decimal(item.discount ?? 0),
        taxRatePercent,
        taxMode,
      });
    }

    // ---- place of supply & intra/inter-state GST
    const customerStateFromGstin = customer?.gstin ? customer.gstin.slice(0, 2) : null;
    const placeOfSupplyStateCode =
      dto.placeOfSupplyStateCode ??
      customer?.stateCode ??
      customerStateFromGstin ??
      branch.stateCode ??
      null;
    const interState = Boolean(
      org.gstEnabled &&
      branch.stateCode &&
      placeOfSupplyStateCode &&
      placeOfSupplyStateCode !== branch.stateCode,
    );

    // ---- discounts and their limit
    const billDiscount = new Decimal(dto.billDiscount ?? 0);
    const anyDiscount = billDiscount.gt(0) || lines.some((l) => l.lineDiscount.gt(0));
    if (anyDiscount && !may(perms, 'discount.apply')) {
      throw new AppException('FORBIDDEN', 'You may not give discounts', 403, {
        required: ['discount.apply'],
      });
    }
    const figures = computeSale(
      lines.map((l) => ({
        gross: l.gross,
        lineDiscount: l.lineDiscount,
        taxRatePercent: l.taxRatePercent,
        taxMode: l.taxMode,
      })),
      billDiscount,
      { gstEnabled: org.gstEnabled, interState },
    );
    const limit = dec(org.maxCashierDiscountPercent);
    if (figures.discountPercent.gt(limit) && !may(perms, 'discount.override_limit')) {
      throw new AppException(
        'DISCOUNT_LIMIT_EXCEEDED',
        `Discounts above ${limit.toFixed(2)}% need a manager`,
        403,
        {
          limitPercent: limit.toFixed(2),
          requestedPercent: figures.discountPercent
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            .toFixed(2),
          required: ['discount.override_limit'],
        },
      );
    }

    return { customer, lines, figures, overrides, placeOfSupplyStateCode, interState };
  }

  async get(t: TenantContext, id: string) {
    return this.view(this.prisma, t.organizationId, id, branchOf(t));
  }

  async list(t: TenantContext, q: SalesQuery) {
    const branchId = branchOf(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.SaleWhereInput = {
      organizationId: t.organizationId,
      branchId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.q ? { saleNumber: { contains: q.q, mode: 'insensitive' } } : {}),
      ...(q.from || q.to ? { soldAt: timestampRange(q.from, q.to) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: [{ soldAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);
    return new Paginated(
      rows.map((s) => ({
        id: s.id,
        saleNumber: s.saleNumber,
        status: s.status,
        soldAt: s.soldAt,
        customer: s.customer,
        lines: s._count.items,
        total: m2(s.total),
        paidTotal: m2(s.paidTotal),
        creditAmount: m2(s.creditAmount),
        returnedTotal: m2(s.returnedTotal),
      })),
      { page, pageSize, total },
    );
  }

  /** The bill as stored. Purchase cost is NOT shown here (it belongs to reports). */
  async view(db: Db, organizationId: string, id: string, branchId?: string) {
    const s = await db.sale.findFirst({
      where: { id, organizationId, ...(branchId ? { branchId } : {}) },
      include: {
        items: { orderBy: { id: 'asc' } },
        customer: { select: { id: true, name: true, phone: true, gstin: true, stateCode: true } },
        soldBy: { select: { id: true, fullName: true } },
        payments: { include: { payment: true }, orderBy: { createdAt: 'asc' } },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            type: true,
            status: true,
            series: true,
            sequenceNumber: true,
            issuedAt: true,
          },
        },
      },
    });
    if (!s) throw new AppException('SALE_NOT_FOUND', 'Sale not found', 404);
    const cgstTotal = dec(s.cgstTotal);
    const sgstTotal = dec(s.sgstTotal);
    const igstTotal = dec(s.igstTotal);
    const taxTotal = cgstTotal.plus(sgstTotal).plus(igstTotal);
    return {
      id: s.id,
      saleNumber: s.saleNumber,
      status: s.status,
      soldAt: s.soldAt,
      soldBy: s.soldBy,
      customer: s.customer,
      invoice: s.invoice,
      taxMode: s.taxMode,
      placeOfSupplyStateCode: s.placeOfSupplyStateCode,
      subtotal: m2(s.subtotal),
      discountTotal: m2(s.discountTotal),
      taxableTotal: m2(s.taxableTotal),
      cgstTotal: cgstTotal.toFixed(2),
      sgstTotal: sgstTotal.toFixed(2),
      igstTotal: igstTotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      roundOff: m2(s.roundOff),
      total: m2(s.total),
      paidTotal: m2(s.paidTotal),
      creditAmount: m2(s.creditAmount),
      returnedTotal: m2(s.returnedTotal),
      refundedTotal: m2(s.refundedTotal),
      cancelledAt: s.cancelledAt,
      cancelReason: s.cancelReason,
      items: s.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        name: i.productNameSnapshot,
        sku: i.skuSnapshot,
        hsn: i.hsnSnapshot,
        unitId: i.unitId,
        unitCode: i.unitCodeSnapshot,
        quantity: dec(i.quantity).toFixed(3),
        baseQuantity: dec(i.baseQuantity).toFixed(3),
        unitPrice: m2(i.unitPrice),
        mrp: i.mrpSnapshot === null ? null : m2(i.mrpSnapshot),
        discountAmount: m2(i.discountAmount),
        taxRatePercent: dec(i.taxRatePercent).toFixed(4),
        taxableValue: m2(i.taxableValue),
        cgstAmount: m2(i.cgstAmount),
        sgstAmount: m2(i.sgstAmount),
        igstAmount: m2(i.igstAmount),
        taxAmount: dec(i.cgstAmount).plus(dec(i.sgstAmount)).plus(dec(i.igstAmount)).toFixed(2),
        lineTotal: m2(i.lineTotal),
        returnedBaseQuantity: dec(i.returnedBaseQuantity).toFixed(3),
        returnedAmount: m2(i.returnedAmount),
      })),
      payments: s.payments.map((x) => ({
        paymentId: x.paymentId,
        method: x.payment.method,
        amount: m2(x.amount),
        status: x.payment.status,
        referenceNo: x.payment.referenceNo,
      })),
    };
  }
}

export function branchOf(t: TenantContext): string {
  if (!t.branchId) throw new AppException('BRANCH_REQUIRED', 'x-branch-id header is required', 400);
  return t.branchId;
}
