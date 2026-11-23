import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { CursorPage } from '../../common/pagination/paginated';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  decodeIdCursor,
  decodeSyncCursor,
  encodeIdCursor,
  encodeSyncCursor,
  parseUpdatedSince,
} from './domain/sync-cursor';
import type { SyncFeedQuery } from './sync.dto';

const DEFAULT_LIMIT = 200;
const MONEY_SCALE = 2;
const QTY_SCALE = 3;
const FACTOR_SCALE = 6;

const PRODUCT_SYNC_INCLUDE = {
  baseUnit: { select: { id: true, code: true, name: true, dimension: true, isPackaging: true } },
  category: { select: { id: true, name: true } },
  conversions: {
    include: { unit: { select: { id: true, code: true, name: true, isPackaging: true } } },
    orderBy: [{ factorToBase: 'asc' }, { id: 'asc' }],
  },
  prices: { orderBy: [{ unitId: 'asc' }, { quantity: 'asc' }, { id: 'asc' }] },
  barcodes: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ProductInclude;

type SyncProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_SYNC_INCLUDE }>;

const fx = (v: Prisma.Decimal | null | undefined, scale: number): string | null =>
  v === null || v === undefined ? null : v.toFixed(scale);

/**
 * Read-only delta change feeds for the mobile SQLite read cache.
 *
 * Every feed orders stably by `(updated_at ASC, id ASC)` (or `id ASC` for static global units)
 * and includes soft-deleted records (`deletedAt !== null`) so clients can evict them locally.
 * All organization-owned tables filter strictly by `organizationId`.
 */
@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async products(organizationId: string, q: SyncFeedQuery) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const serverTime = new Date().toISOString();
    const filter = this.updatedWhere(q);

    const rows = await this.prisma.product.findMany({
      where: { organizationId, ...filter },
      include: PRODUCT_SYNC_INCLUDE,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeSyncCursor(last.updatedAt, last.id) : null;

    return new CursorPage(page.map(serializeProduct), {
      limit,
      hasMore,
      nextCursor,
      serverTime,
    });
  }

  async categories(organizationId: string, q: SyncFeedQuery) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const serverTime = new Date().toISOString();
    const filter = this.updatedWhere(q);

    const rows = await this.prisma.productCategory.findMany({
      where: { organizationId, ...filter },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeSyncCursor(last.updatedAt, last.id) : null;

    return new CursorPage(
      page.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        name: c.name,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
        updatedAt: c.updatedAt.toISOString(),
        deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
      })),
      { limit, hasMore, nextCursor, serverTime },
    );
  }

  async units(q: SyncFeedQuery) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const serverTime = new Date().toISOString();
    if (q.updated_since) parseUpdatedSince(q.updated_since);
    const cursor = q.cursor ? decodeIdCursor(q.cursor) : null;

    const rows = await this.prisma.unitOfMeasurement.findMany({
      where: cursor ? { id: { gt: cursor.id } } : undefined,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeIdCursor(last.id) : null;

    return new CursorPage(
      page.map((u) => ({
        id: u.id,
        code: u.code,
        name: u.name,
        dimension: u.dimension,
        isPackaging: u.isPackaging,
        standardFactor: fx(u.standardFactor, FACTOR_SCALE),
      })),
      { limit, hasMore, nextCursor, serverTime },
    );
  }

  async customers(organizationId: string, q: SyncFeedQuery) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const serverTime = new Date().toISOString();
    const filter = this.updatedWhere(q);

    const rows = await this.prisma.customer.findMany({
      where: { organizationId, ...filter },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeSyncCursor(last.updatedAt, last.id) : null;

    return new CursorPage(
      page.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        gstin: c.gstin,
        stateCode: c.stateCode,
        addressLine: c.addressLine,
        creditLimit: fx(c.creditLimit, MONEY_SCALE),
        balance: c.balance.toFixed(MONEY_SCALE),
        isActive: c.isActive,
        version: c.version,
        updatedAt: c.updatedAt.toISOString(),
        deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
      })),
      { limit, hasMore, nextCursor, serverTime },
    );
  }

  private updatedWhere(q: SyncFeedQuery): {
    updatedAt?: { gte: Date };
    OR?: [{ updatedAt: { gt: Date } }, { updatedAt: Date; id: { gt: string } }];
  } {
    const since = q.updated_since ? parseUpdatedSince(q.updated_since) : null;
    if (q.cursor) {
      const c = decodeSyncCursor(q.cursor);
      return {
        OR: [{ updatedAt: { gt: c.updatedAt } }, { updatedAt: c.updatedAt, id: { gt: c.id } }],
      };
    }
    if (since) {
      return { updatedAt: { gte: since } };
    }
    return {};
  }
}

function serializeProduct(p: SyncProductRow) {
  const unitCode = new Map(p.conversions.map((c) => [c.unitId, c.unit.code]));
  const basePriceRow = p.prices.find(
    (x) => x.isActive && x.unitId === p.baseUnitId && new Decimal(x.quantity.toString()).eq(1),
  );
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    localName: p.localName,
    type: p.type,
    status: p.status,
    baseUnit: { id: p.baseUnit.id, code: p.baseUnit.code, name: p.baseUnit.name },
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    primaryBarcode: p.barcodes[0]?.barcode ?? null,
    basePrice: basePriceRow ? basePriceRow.price.toFixed(MONEY_SCALE) : null,
    mrp: fx(p.mrp, MONEY_SCALE),
    minStockLevel: p.minStockLevel.toFixed(QTY_SCALE),
    minSaleIncrement: fx(p.minSaleIncrement, QTY_SCALE),
    allowFractional: p.allowFractional,
    trackBatch: p.trackBatch,
    trackExpiry: p.trackExpiry,
    isTaxable: p.isTaxable,
    hsnCode: p.hsnCode,
    gstRatePercent: fx(p.gstRatePercent, 4),
    taxMode: p.taxMode,
    version: p.version,
    updatedAt: p.updatedAt.toISOString(),
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
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
}
