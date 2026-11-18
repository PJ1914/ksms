import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import Decimal from 'decimal.js';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { Paginated } from '../../common/pagination/paginated';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from './categories.service';
import type {
  AddBarcodeDto,
  AddConversionDto,
  CreateProductDto,
  ListProductsQuery,
  PricePointInputDto,
  QuoteQuery,
  UnitConversionInputDto,
  UpdateConversionDto,
  UpdateProductDto,
} from './catalog.dto';
import { priceForQuantity } from './domain/pricing';
import {
  FACTOR_SCALE,
  QTY_SCALE,
  MONEY_SCALE,
  type QuantityRules,
  type UnitInfo,
  assertSellableBaseQuantity,
  assertValidBaseUnit,
  resolveConversionFactor,
  toBaseQuantity,
} from './domain/units';
import { UnitsService } from './units.service';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const FULL_INCLUDE = {
  baseUnit: { select: { id: true, code: true, name: true } },
  category: { select: { id: true, name: true } },
  conversions: {
    include: { unit: { select: { id: true, code: true, name: true, isPackaging: true } } },
    orderBy: { createdAt: 'asc' },
  },
  prices: { orderBy: { createdAt: 'asc' } },
  barcodes: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ProductInclude;
type ProductFull = Prisma.ProductGetPayload<{ include: typeof FULL_INCLUDE }>;

const SKU_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const dec = (v: string | number | Prisma.Decimal): Decimal => new Decimal(v.toString());
const fx = (v: Prisma.Decimal | null | undefined, scale: number): string | null =>
  v === null || v === undefined ? null : v.toFixed(scale);

const detail = (p: ProductFull) => {
  const unitCode = new Map(p.conversions.map((c) => [c.unitId, c.unit.code]));
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    localName: p.localName,
    type: p.type,
    status: p.status,
    baseUnit: p.baseUnit,
    category: p.category,
    mrp: fx(p.mrp, MONEY_SCALE), // per base unit
    minStockLevel: fx(p.minStockLevel, QTY_SCALE),
    minSaleIncrement: fx(p.minSaleIncrement, QTY_SCALE),
    allowFractional: p.allowFractional,
    trackBatch: p.trackBatch,
    trackExpiry: p.trackExpiry,
    isTaxable: p.isTaxable,
    hsnCode: p.hsnCode,
    gstRatePercent: fx(p.gstRatePercent, 4),
    taxMode: p.taxMode,
    imageKey: p.imageKey,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    conversions: p.conversions.map((c) => ({
      unitId: c.unitId,
      unitCode: c.unit.code,
      unitName: c.unit.name,
      isPackaging: c.unit.isPackaging,
      isBase: c.unitId === p.baseUnitId,
      factorToBase: c.factorToBase.toFixed(FACTOR_SCALE),
      isPurchaseUnit: c.isPurchaseUnit,
      isSaleUnit: c.isSaleUnit,
    })),
    prices: p.prices.map((x) => ({
      id: x.id,
      unitId: x.unitId,
      unitCode: unitCode.get(x.unitId) ?? null,
      quantity: x.quantity.toFixed(QTY_SCALE),
      price: x.price.toFixed(MONEY_SCALE),
      label: x.label,
      isActive: x.isActive,
    })),
    barcodes: p.barcodes.map((b) => ({ id: b.id, barcode: b.barcode, unitId: b.unitId })),
  };
};

interface PlannedConversion {
  unitId: string;
  factor: Decimal;
  isPurchaseUnit: boolean;
  isSaleUnit: boolean;
}
interface PlannedPrice {
  unitId: string;
  quantity: Decimal;
  price: Decimal;
  label: string | null;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly units: UnitsService,
    private readonly categories: CategoriesService,
  ) {}

  // ---------- reads ----------

  async list(organizationId: string, q: ListProductsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.ProductWhereInput = {
      organizationId,
      deletedAt: null,
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { localName: { contains: q.q, mode: 'insensitive' } },
              { sku: { contains: q.q, mode: 'insensitive' } },
              { barcodes: { some: { barcode: { startsWith: q.q } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ [q.sort ?? 'name']: q.order ?? 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          baseUnit: { select: { id: true, code: true } },
          category: { select: { id: true, name: true } },
          barcodes: { take: 1, orderBy: { createdAt: 'asc' }, select: { barcode: true } },
          prices: { where: { quantity: 1, isActive: true }, select: { unitId: true, price: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    const items = rows.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      localName: p.localName,
      type: p.type,
      status: p.status,
      baseUnit: p.baseUnit,
      category: p.category,
      mrp: fx(p.mrp, MONEY_SCALE),
      minStockLevel: fx(p.minStockLevel, QTY_SCALE),
      trackBatch: p.trackBatch,
      trackExpiry: p.trackExpiry,
      isTaxable: p.isTaxable,
      gstRatePercent: fx(p.gstRatePercent, 4),
      primaryBarcode: p.barcodes[0]?.barcode ?? null,
      basePrice: fx(p.prices.find((x) => x.unitId === p.baseUnitId)?.price, MONEY_SCALE), // price of 1 base unit
      version: p.version,
      updatedAt: p.updatedAt,
    }));
    return new Paginated(items, { page, pageSize, total });
  }

  async get(organizationId: string, id: string) {
    return detail(await this.findFull(this.prisma, organizationId, id));
  }

  async getByBarcode(organizationId: string, barcode: string) {
    const row = await this.prisma.productBarcode.findFirst({
      where: { organizationId, barcode, product: { deletedAt: null } },
      select: { id: true, barcode: true, unitId: true, productId: true },
    });
    if (!row) throw new AppException('NOT_FOUND', 'No product has this barcode', 404);
    return {
      barcode: { id: row.id, barcode: row.barcode, unitId: row.unitId },
      product: await this.get(organizationId, row.productId),
    };
  }

  /** What would this quantity cost? Runs the same conversion, quantity and pricing rules billing will use. */
  async quote(organizationId: string, id: string, q: QuoteQuery) {
    const p = await this.findFull(this.prisma, organizationId, id);
    const conv = p.conversions.find((c) => c.unitId === q.unitId);
    if (!conv)
      throw new AppException('UNIT_NOT_CONFIGURED', 'This unit is not set up for the product', 422);
    if (!conv.isSaleUnit)
      throw new AppException('UNIT_NOT_SALE_ENABLED', 'This unit cannot be used for selling', 422);

    const quantity = dec(q.quantity);
    const factor = dec(conv.factorToBase);
    const baseQuantity = toBaseQuantity(quantity, factor);
    assertSellableBaseQuantity(this.rulesOf(p), baseQuantity);
    const factors = new Map(p.conversions.map((c) => [c.unitId, dec(c.factorToBase)]));
    const points = p.prices
      .filter((x) => x.isActive)
      .map((x) => ({ unitId: x.unitId, quantity: dec(x.quantity), price: dec(x.price) }));
    const quote = priceForQuantity(points, p.baseUnitId, factors, q.unitId, quantity);
    return {
      unitId: q.unitId,
      unitCode: conv.unit.code,
      quantity: quantity.toFixed(),
      factorToBase: factor.toFixed(FACTOR_SCALE),
      baseQuantity: baseQuantity.toFixed(QTY_SCALE),
      baseUnitCode: p.baseUnit.code,
      amount: quote.amount.toFixed(MONEY_SCALE),
      source: quote.source,
      rounded: quote.rounded,
    };
  }

  /**
   * Everything a sale line needs, inside the caller's transaction: the sellable quantity in base units, the
   * catalogue price (same rules as `quote`), and the snapshot a sale line keeps forever (name, SKU, HSN, unit,
   * conversion factor, MRP). Inactive products, units that are not for sale and invalid quantities are refused.
   */
  async priceForSale(
    db: Db,
    organizationId: string,
    productId: string,
    unitId: string,
    quantity: Decimal,
  ) {
    const p = await this.findFull(db, organizationId, productId);
    if (p.status !== 'ACTIVE') {
      throw new DomainError('PRODUCT_NOT_ACTIVE', `${p.name} is not active and cannot be sold`);
    }
    const conv = p.conversions.find((c) => c.unitId === unitId);
    if (!conv)
      throw new DomainError('UNIT_NOT_CONFIGURED', `This unit is not set up for ${p.name}`);
    if (!conv.isSaleUnit)
      throw new DomainError(
        'UNIT_NOT_SALE_ENABLED',
        `${conv.unit.code} cannot be used to sell ${p.name}`,
      );
    const factor = dec(conv.factorToBase);
    const baseQuantity = toBaseQuantity(quantity, factor);
    assertSellableBaseQuantity(this.rulesOf(p), baseQuantity);
    const factors = new Map(p.conversions.map((c) => [c.unitId, dec(c.factorToBase)]));
    const points = p.prices
      .filter((x) => x.isActive)
      .map((x) => ({ unitId: x.unitId, quantity: dec(x.quantity), price: dec(x.price) }));
    const quote = priceForQuantity(points, p.baseUnitId, factors, unitId, quantity);
    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      hsnCode: p.hsnCode,
      mrp: p.mrp === null ? null : dec(p.mrp),
      isTaxable: p.isTaxable,
      gstRatePercent: p.gstRatePercent === null ? null : dec(p.gstRatePercent),
      taxMode: p.taxMode,
      unitId,
      unitCode: conv.unit.code,
      factor,
      baseQuantity,
      /** Catalogue price for the whole line. */
      amount: quote.amount,
      priceSource: quote.source,
    };
  }

  // ---------- create ----------

  async create(organizationId: string, actorId: string, dto: CreateProductDto, meta: Meta) {
    const conversionInputs = dto.conversions ?? [];
    const unitIds = [
      dto.baseUnitId,
      ...conversionInputs.map((c) => c.unitId),
      ...(dto.prices ?? []).map((p) => p.unitId),
    ];
    const units = await this.units.load(this.prisma, unitIds);
    const base = units.get(dto.baseUnitId)!;
    assertValidBaseUnit(dto.type, base);

    const rules = this.buildRules(dto.type, dto.allowFractional, dto.minSaleIncrement);
    const conversions = this.planConversions(rules, base, units, conversionInputs);
    const prices = this.planPrices(rules, conversions, dto.prices ?? []);
    const barcodes = [...new Set(dto.barcodes ?? [])];
    this.assertBarcodeUnits(conversions, []);

    return this.prisma.$transaction(async (tx) => {
      if (dto.categoryId) await this.categories.assertExists(tx, organizationId, dto.categoryId);
      const sku = dto.sku ?? (await this.generateSku(tx, organizationId));
      await this.assertSkuFree(tx, organizationId, sku);
      await this.assertBarcodesFree(tx, organizationId, barcodes);

      const product = await tx.product.create({
        data: {
          organizationId,
          categoryId: dto.categoryId,
          sku,
          name: dto.name,
          localName: dto.localName,
          type: dto.type,
          baseUnitId: dto.baseUnitId,
          mrp: dto.mrp,
          minStockLevel: dto.minStockLevel ?? '0',
          minSaleIncrement: dto.minSaleIncrement,
          allowFractional: rules.allowFractional,
          trackBatch: dto.trackBatch ?? false,
          trackExpiry: dto.trackExpiry ?? false,
          isTaxable: dto.isTaxable ?? false,
          hsnCode: dto.hsnCode,
          gstRatePercent: dto.gstRatePercent,
          taxMode: dto.taxMode,
        },
        select: { id: true },
      });
      await this.writeConversions(tx, organizationId, product.id, conversions);
      await this.writePrices(tx, organizationId, product.id, prices);
      if (barcodes.length) {
        await tx.productBarcode.createMany({
          data: barcodes.map((barcode) => ({ organizationId, productId: product.id, barcode })),
        });
      }
      const created = detail(await this.findFull(tx, organizationId, product.id));
      await this.audit.record(tx, {
        organizationId,
        actorId,
        action: 'product.create',
        entityType: 'product',
        entityId: product.id,
        after: created as unknown as Prisma.InputJsonValue,
        ...meta,
      });
      return created;
    });
  }

  // ---------- update / delete ----------

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    dto: UpdateProductDto,
    meta: Meta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findFull(tx, organizationId, id);
      if (dto.version !== undefined && dto.version !== before.version) {
        throw new AppException(
          'VERSION_CONFLICT',
          'This product was changed on another device. Reload it and try again',
          409,
          { currentVersion: before.version },
        );
      }
      if (dto.categoryId) await this.categories.assertExists(tx, organizationId, dto.categoryId);

      const allowFractional =
        before.type === 'COUNT' ? (dto.allowFractional ?? before.allowFractional) : true;
      if (before.type !== 'COUNT' && dto.allowFractional === false) {
        throw new DomainError(
          'FRACTIONAL_REQUIRED',
          'Weight and volume products are always sold in fractions',
        );
      }
      const increment =
        dto.minSaleIncrement === undefined
          ? before.minSaleIncrement
          : dto.minSaleIncrement === null
            ? null
            : dec(dto.minSaleIncrement);
      const rules: QuantityRules = {
        type: before.type,
        allowFractional,
        minSaleIncrement: increment === null ? null : dec(increment),
      };
      // The new rules must still accept every conversion and price already configured.
      this.assertRulesHold(rules, before);

      await tx.product.update({
        where: { id },
        data: {
          name: dto.name,
          localName: dto.localName,
          categoryId: dto.categoryId,
          status: dto.status,
          mrp: dto.mrp,
          minStockLevel: dto.minStockLevel,
          minSaleIncrement: dto.minSaleIncrement,
          allowFractional,
          trackBatch: dto.trackBatch,
          trackExpiry: dto.trackExpiry,
          isTaxable: dto.isTaxable,
          hsnCode: dto.hsnCode,
          gstRatePercent: dto.gstRatePercent,
          taxMode: dto.taxMode,
          version: { increment: 1 },
        },
      });
      const after = await this.findFull(tx, organizationId, id);
      await this.audit.record(tx, {
        organizationId,
        actorId,
        action: 'product.update',
        entityType: 'product',
        entityId: id,
        before: this.scalarView(before),
        after: this.scalarView(after),
        ...meta,
      });
      return detail(after);
    });
  }

  /** Soft delete. Only possible while the product has no stock, purchase or sales history; otherwise discontinue it. */
  async remove(organizationId: string, actorId: string, id: string, meta: Meta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const product = await this.findFull(tx, organizationId, id);
      if (await this.hasHistory(tx, id)) {
        throw new AppException(
          'PRODUCT_HAS_HISTORY',
          'This product has stock or transactions. Mark it DISCONTINUED instead of deleting it',
          409,
        );
      }
      await tx.productBarcode.deleteMany({ where: { productId: id } }); // free the barcodes for reuse
      await tx.product.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'DISCONTINUED', version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId,
        actorId,
        action: 'product.delete',
        entityType: 'product',
        entityId: id,
        before: detail(product) as unknown as Prisma.InputJsonValue,
        ...meta,
      });
    });
  }

  // ---------- conversions ----------

  async addConversion(
    organizationId: string,
    actorId: string,
    id: string,
    dto: AddConversionDto,
    meta: Meta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.findFull(tx, organizationId, id);
      if (p.conversions.some((c) => c.unitId === dto.unitId)) {
        throw new AppException(
          'CONVERSION_EXISTS',
          'This unit is already set up for the product',
          409,
        );
      }
      const units = await this.units.load(tx, [p.baseUnitId, dto.unitId]);
      const [planned] = this.planConversions(
        this.rulesOf(p),
        units.get(p.baseUnitId)!,
        units,
        [dto],
        false,
      );
      await tx.productUnitConversion.create({
        data: {
          organizationId,
          productId: id,
          unitId: planned!.unitId,
          factorToBase: planned!.factor.toFixed(FACTOR_SCALE),
          isPurchaseUnit: planned!.isPurchaseUnit,
          isSaleUnit: planned!.isSaleUnit,
        },
      });
      return this.finishChange(tx, organizationId, actorId, p, 'product.conversion.add', meta);
    });
  }

  async updateConversion(
    organizationId: string,
    actorId: string,
    id: string,
    unitId: string,
    dto: UpdateConversionDto,
    meta: Meta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.findFull(tx, organizationId, id);
      const current = p.conversions.find((c) => c.unitId === unitId);
      if (!current)
        throw new AppException('NOT_FOUND', 'This unit is not set up for the product', 404);
      const isBase = unitId === p.baseUnitId;
      if (isBase && dto.factorToBase !== undefined && !dec(dto.factorToBase).equals(1)) {
        throw new DomainError('CONVERSION_MISMATCH', 'The base unit always equals 1');
      }

      let factor = dec(current.factorToBase);
      if (dto.factorToBase !== undefined) {
        const units = await this.units.load(tx, [p.baseUnitId, unitId]);
        factor = resolveConversionFactor(
          this.rulesOf(p),
          units.get(p.baseUnitId)!,
          units.get(unitId)!,
          dec(dto.factorToBase),
        );
      }
      const isSaleUnit = dto.isSaleUnit ?? current.isSaleUnit;
      if (!isSaleUnit && p.prices.some((x) => x.unitId === unitId)) {
        throw new AppException(
          'UNIT_HAS_PRICES',
          'Remove the prices for this unit before turning off selling',
          409,
        );
      }
      if (isBase && !isSaleUnit) {
        throw new DomainError('BASE_UNIT_MUST_SELL', 'The base unit must stay sale-enabled');
      }
      // Existing price points must still be representable with the new factor.
      for (const x of p.prices.filter((x) => x.unitId === unitId)) {
        assertSellableBaseQuantity(this.rulesOf(p), toBaseQuantity(dec(x.quantity), factor));
      }
      await tx.productUnitConversion.update({
        where: { productId_unitId: { productId: id, unitId } },
        data: {
          factorToBase: factor.toFixed(FACTOR_SCALE),
          isPurchaseUnit: dto.isPurchaseUnit,
          isSaleUnit,
        },
      });
      return this.finishChange(tx, organizationId, actorId, p, 'product.conversion.update', meta);
    });
  }

  async removeConversion(
    organizationId: string,
    actorId: string,
    id: string,
    unitId: string,
    meta: Meta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.findFull(tx, organizationId, id);
      if (!p.conversions.some((c) => c.unitId === unitId))
        throw new AppException('NOT_FOUND', 'This unit is not set up for the product', 404);
      if (unitId === p.baseUnitId)
        throw new DomainError('BASE_UNIT_REQUIRED', 'The base unit cannot be removed');
      if (
        p.prices.some((x) => x.unitId === unitId) ||
        p.barcodes.some((b) => b.unitId === unitId)
      ) {
        throw new AppException('UNIT_IN_USE', 'Remove its prices and barcodes first', 409);
      }
      await tx.productUnitConversion.delete({
        where: { productId_unitId: { productId: id, unitId } },
      });
      return this.finishChange(tx, organizationId, actorId, p, 'product.conversion.remove', meta);
    });
  }

  // ---------- prices ----------

  /** Replaces the whole price list atomically. History is safe: invoices keep their own price snapshot. */
  async replacePrices(
    organizationId: string,
    actorId: string,
    id: string,
    inputs: PricePointInputDto[],
    meta: Meta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.findFull(tx, organizationId, id);
      const conversions: PlannedConversion[] = p.conversions.map((c) => ({
        unitId: c.unitId,
        factor: dec(c.factorToBase),
        isPurchaseUnit: c.isPurchaseUnit,
        isSaleUnit: c.isSaleUnit,
      }));
      const prices = this.planPrices(this.rulesOf(p), conversions, inputs);
      await tx.productUnitPrice.deleteMany({ where: { productId: id } });
      await this.writePrices(tx, organizationId, id, prices);
      return this.finishChange(tx, organizationId, actorId, p, 'product.prices.update', meta);
    });
  }

  // ---------- barcodes ----------

  async addBarcode(
    organizationId: string,
    actorId: string,
    id: string,
    dto: AddBarcodeDto,
    meta: Meta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.findFull(tx, organizationId, id);
      if (dto.unitId && !p.conversions.some((c) => c.unitId === dto.unitId)) {
        throw new AppException(
          'UNIT_NOT_CONFIGURED',
          'This unit is not set up for the product',
          422,
        );
      }
      await this.assertBarcodesFree(tx, organizationId, [dto.barcode]);
      await tx.productBarcode.create({
        data: { organizationId, productId: id, barcode: dto.barcode, unitId: dto.unitId },
      });
      return this.finishChange(tx, organizationId, actorId, p, 'product.barcode.add', meta);
    });
  }

  async removeBarcode(
    organizationId: string,
    actorId: string,
    id: string,
    barcodeId: string,
    meta: Meta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.findFull(tx, organizationId, id);
      const target = p.barcodes.find((b) => b.id === barcodeId);
      if (!target) throw new AppException('NOT_FOUND', 'Barcode not found', 404);
      await tx.productBarcode.delete({ where: { id: barcodeId } });
      return this.finishChange(tx, organizationId, actorId, p, 'product.barcode.remove', meta);
    });
  }

  // ---------- read model for other modules (inventory, purchasing, sales) ----------

  /**
   * Everything another module needs to move stock for a product: its quantity rules, tracking flags and
   * current unit factors. Scoped to the organization (another shop's product is "not found").
   */
  async stockRules(db: Db, organizationId: string, productId: string) {
    const p = await db.product.findFirst({
      where: { id: productId, organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        sku: true,
        status: true,
        type: true,
        allowFractional: true,
        minSaleIncrement: true,
        trackBatch: true,
        trackExpiry: true,
        baseUnitId: true,
        baseUnit: { select: { code: true } },
        conversions: {
          select: {
            unitId: true,
            factorToBase: true,
            isPurchaseUnit: true,
            isSaleUnit: true,
            unit: { select: { code: true } },
          },
        },
      },
    });
    if (!p) throw new AppException('NOT_FOUND', 'Product not found', 404);
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      status: p.status,
      baseUnitId: p.baseUnitId,
      baseUnitCode: p.baseUnit.code,
      trackBatch: p.trackBatch,
      trackExpiry: p.trackExpiry,
      rules: this.rulesOf(p),
      conversions: new Map(
        p.conversions.map((c) => [
          c.unitId,
          {
            unitCode: c.unit.code,
            factorToBase: dec(c.factorToBase),
            isPurchaseUnit: c.isPurchaseUnit,
            isSaleUnit: c.isSaleUnit,
          },
        ]),
      ),
    };
  }

  // ---------- internals ----------

  /** Always scoped to the organization; another shop's product is simply "not found". */
  private async findFull(db: Db, organizationId: string, id: string): Promise<ProductFull> {
    const p = await db.product.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: FULL_INCLUDE,
    });
    if (!p) throw new AppException('NOT_FOUND', 'Product not found', 404);
    return p;
  }

  private rulesOf(
    p: Pick<ProductFull, 'type' | 'allowFractional' | 'minSaleIncrement'>,
  ): QuantityRules {
    return {
      type: p.type,
      allowFractional: p.allowFractional,
      minSaleIncrement: p.minSaleIncrement ? dec(p.minSaleIncrement) : null,
    };
  }

  private buildRules(
    type: QuantityRules['type'],
    allowFractional: boolean | undefined,
    increment: string | undefined,
  ): QuantityRules {
    const fractional = type === 'COUNT' ? (allowFractional ?? false) : true;
    const inc = increment === undefined ? null : dec(increment);
    if (inc && inc.lte(0))
      throw new DomainError('INCREMENT_INVALID', 'minSaleIncrement must be greater than zero');
    if (inc && type === 'COUNT' && !fractional && !inc.isInteger()) {
      throw new DomainError(
        'FRACTIONAL_NOT_ALLOWED',
        'A piece-counted product needs a whole-number sale step',
      );
    }
    return { type, allowFractional: fractional, minSaleIncrement: inc };
  }

  /** Turns the request into validated conversions; the base unit (factor 1) is always included. */
  private planConversions(
    rules: QuantityRules,
    base: UnitInfo,
    units: Map<string, UnitInfo>,
    inputs: UnitConversionInputDto[],
    includeBase = true,
  ): PlannedConversion[] {
    const seen = new Set<string>();
    const out: PlannedConversion[] = [];
    const add = (input: UnitConversionInputDto, defaults: { purchase: boolean; sale: boolean }) => {
      if (seen.has(input.unitId))
        throw new DomainError('CONVERSION_DUPLICATE', 'A unit was listed twice');
      seen.add(input.unitId);
      const unit = units.get(input.unitId)!;
      const factor = resolveConversionFactor(
        rules,
        base,
        unit,
        input.factorToBase === undefined ? undefined : dec(input.factorToBase),
      );
      const explicit = input.isPurchaseUnit !== undefined || input.isSaleUnit !== undefined;
      out.push({
        unitId: unit.id,
        factor,
        isPurchaseUnit: input.isPurchaseUnit ?? (explicit ? false : defaults.purchase),
        isSaleUnit: input.isSaleUnit ?? (explicit ? false : defaults.sale),
      });
    };
    if (includeBase) {
      const own = inputs.find((i) => i.unitId === base.id);
      add(
        {
          unitId: base.id,
          factorToBase: own?.factorToBase,
          isPurchaseUnit: own?.isPurchaseUnit ?? true,
          isSaleUnit: own?.isSaleUnit ?? true,
        },
        { purchase: true, sale: true },
      );
    }
    for (const input of inputs) {
      if (includeBase && input.unitId === base.id) continue;
      const unit = units.get(input.unitId)!;
      // sensible defaults: standard units are for selling, packaging units for buying
      add(
        input,
        unit.isPackaging ? { purchase: true, sale: false } : { purchase: false, sale: true },
      );
    }
    return out;
  }

  private planPrices(
    rules: QuantityRules,
    conversions: PlannedConversion[],
    inputs: PricePointInputDto[],
  ): PlannedPrice[] {
    const byUnit = new Map(conversions.map((c) => [c.unitId, c]));
    const seen = new Set<string>();
    return inputs.map((p) => {
      const conv = byUnit.get(p.unitId);
      if (!conv)
        throw new DomainError(
          'PRICE_UNIT_NOT_CONFIGURED',
          'A price uses a unit that is not set up for this product',
        );
      if (!conv.isSaleUnit)
        throw new DomainError(
          'UNIT_NOT_SALE_ENABLED',
          'A price uses a unit that is not enabled for selling',
        );
      const quantity = dec(p.quantity ?? '1');
      assertSellableBaseQuantity(rules, toBaseQuantity(quantity, conv.factor));
      const key = `${p.unitId}|${quantity.toFixed(QTY_SCALE)}`;
      if (seen.has(key))
        throw new DomainError(
          'PRICE_DUPLICATE',
          'Two prices were given for the same unit and quantity',
        );
      seen.add(key);
      return { unitId: p.unitId, quantity, price: dec(p.price), label: p.label ?? null };
    });
  }

  private assertBarcodeUnits(_conversions: PlannedConversion[], _barcodeUnitIds: string[]): void {
    // barcodes supplied at creation carry no unit; unit-specific barcodes are added via addBarcode().
  }

  /** After changing rules, every existing conversion and price must still be valid. */
  private assertRulesHold(rules: QuantityRules, p: ProductFull): void {
    if (rules.type === 'COUNT' && !rules.allowFractional) {
      for (const c of p.conversions) {
        if (!dec(c.factorToBase).isInteger())
          throw new DomainError(
            'FRACTIONAL_NOT_ALLOWED',
            `${c.unit.code} holds a fraction of a piece; fix it first`,
          );
      }
    }
    const factors = new Map(p.conversions.map((c) => [c.unitId, dec(c.factorToBase)]));
    for (const x of p.prices) {
      assertSellableBaseQuantity(rules, toBaseQuantity(dec(x.quantity), factors.get(x.unitId)!));
    }
  }

  private async writeConversions(
    db: Db,
    organizationId: string,
    productId: string,
    list: PlannedConversion[],
  ) {
    await db.productUnitConversion.createMany({
      data: list.map((c) => ({
        organizationId,
        productId,
        unitId: c.unitId,
        factorToBase: c.factor.toFixed(FACTOR_SCALE),
        isPurchaseUnit: c.isPurchaseUnit,
        isSaleUnit: c.isSaleUnit,
      })),
    });
  }

  private async writePrices(
    db: Db,
    organizationId: string,
    productId: string,
    list: PlannedPrice[],
  ) {
    if (list.length === 0) return;
    await db.productUnitPrice.createMany({
      data: list.map((p) => ({
        organizationId,
        productId,
        unitId: p.unitId,
        quantity: p.quantity.toFixed(QTY_SCALE),
        price: p.price.toFixed(MONEY_SCALE),
        label: p.label,
      })),
    });
  }

  /** Bumps the product version (so other devices re-sync it), audits the change and returns the fresh product. */
  private async finishChange(
    tx: Db,
    organizationId: string,
    actorId: string,
    before: ProductFull,
    action: string,
    meta: Meta,
  ) {
    await tx.product.update({ where: { id: before.id }, data: { version: { increment: 1 } } });
    const after = detail(await this.findFull(tx, organizationId, before.id));
    await this.audit.record(tx, {
      organizationId,
      actorId,
      action,
      entityType: 'product',
      entityId: before.id,
      before: detail(before) as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
      ...meta,
    });
    return after;
  }

  private scalarView(p: ProductFull): Prisma.InputJsonValue {
    const { conversions, prices, barcodes, ...rest } = detail(p);
    void conversions;
    void prices;
    void barcodes;
    return rest as unknown as Prisma.InputJsonValue;
  }

  private async hasHistory(db: Db, productId: string): Promise<boolean> {
    const [moves, purchases, sales] = await Promise.all([
      db.stockMovement.count({ where: { productId } }),
      db.purchaseItem.count({ where: { productId } }),
      db.saleItem.count({ where: { productId } }),
    ]);
    return moves + purchases + sales > 0;
  }

  private async generateSku(db: Db, organizationId: string): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const sku = `P${Array.from({ length: 7 }, () => SKU_ALPHABET[randomInt(SKU_ALPHABET.length)]).join('')}`;
      if (!(await db.product.count({ where: { organizationId, sku } }))) return sku;
    }
    throw new AppException(
      'INTERNAL_ERROR',
      'Could not generate a unique SKU, please try again',
      500,
    );
  }

  private async assertSkuFree(db: Db, organizationId: string, sku: string) {
    if (await db.product.count({ where: { organizationId, sku } })) {
      throw new AppException('SKU_IN_USE', `SKU ${sku} is already used by another product`, 409);
    }
  }

  private async assertBarcodesFree(db: Db, organizationId: string, barcodes: string[]) {
    if (barcodes.length === 0) return;
    const clash = await db.productBarcode.findFirst({
      where: { organizationId, barcode: { in: barcodes } },
      select: { barcode: true, productId: true },
    });
    if (clash)
      throw new AppException(
        'BARCODE_IN_USE',
        `Barcode ${clash.barcode} already belongs to another product`,
        409,
        { barcode: clash.barcode, productId: clash.productId },
      );
  }
}
