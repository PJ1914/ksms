import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import type { Prisma } from '../../generated/prisma/client';
import { assertStockBaseQuantity } from '../catalog/domain/units';
import { ProductsService } from '../catalog/products.service';
import {
  COST_SCALE,
  type InboundType,
  type OutboundType,
  allocateFefo,
  isExpired,
  isRealIsoDate,
  todayInIndia,
  weightedAverageCost,
} from './domain/stock';

type Tx = Prisma.TransactionClient;

export interface StockContext {
  organizationId: string;
  branchId: string;
  actorId: string;
}

export interface StockReference {
  type: string; // e.g. OPENING_STOCK, ADJUSTMENT, PURCHASE, SALE
  id: string;
  lineId?: string;
}

export interface BatchInput {
  /** Receive into an existing batch... */
  batchId?: string;
  /** ...or name a (possibly new) batch. */
  batchNumber?: string;
  /** YYYY-MM-DD; required for expiry-tracked products. */
  expiryDate?: string | null;
}

export interface ReceiveInput {
  productId: string;
  type: InboundType;
  baseQuantity: Decimal;
  /** Cost per BASE unit. Null means "use the current average" (e.g. stock found in a count). */
  unitCost: Decimal | null;
  batch?: BatchInput;
  reference: StockReference;
  reason?: string;
}

export interface IssueInput {
  productId: string;
  type: OutboundType;
  baseQuantity: Decimal;
  /** Take from this batch only (damage / expiry write-offs). Otherwise FEFO decides. */
  batchId?: string;
  reference: StockReference;
  reason?: string;
  /**
   * Permit the balance to go below zero. The CALLER must already have verified the organization setting,
   * the stock.override_negative permission and a reason, and must audit it.
   */
  allowNegative?: boolean;
}

export interface MovementView {
  id: string;
  batchId: string | null;
  quantity: string;
  unitCost: string;
  balanceAfter: string;
}

export interface StockResult {
  movements: MovementView[];
  quantityOnHand: string;
  averageCost: string;
  /** Cost of the goods that left stock (outbound only), at the moving average, rounded to paise. */
  costOfGoods?: string;
}

const d = (v: string | number | Decimal) => new Decimal(v.toString());
const qty = (v: Decimal) => v.toFixed(3);
const cost = (v: Decimal) =>
  v.toDecimalPlaces(COST_SCALE, Decimal.ROUND_HALF_UP).toFixed(COST_SCALE);

interface LockedBalance {
  onHand: Decimal;
  reserved: Decimal;
  average: Decimal;
}
interface LockedBatch {
  id: string;
  batchNumber: string;
  expiryDate: string | null;
  quantity: Decimal;
  unitCost: Decimal;
}

/**
 * The ONLY code that changes stock. Every change:
 *  - runs inside the caller's database transaction,
 *  - locks the product's balance row (SELECT ... FOR UPDATE) before reading it, so concurrent sales of the
 *    last unit are serialized by PostgreSQL rather than by the app,
 *  - writes an append-only, signed stock movement with the balance after it,
 *  - keeps batch quantities and the moving weighted-average cost in step.
 * Lock order is always balance row, then batch rows (by expiry), which prevents deadlocks; multi-product
 * callers must go through issueMany(), which orders products by id.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly catalog: ProductsService) {}

  async receive(tx: Tx, ctx: StockContext, input: ReceiveInput): Promise<StockResult> {
    const product = await this.catalog.stockRules(tx, ctx.organizationId, input.productId);
    assertStockBaseQuantity(product.rules, input.baseQuantity);
    const balance = await this.lockBalance(tx, ctx, input.productId);

    let unitCost = input.unitCost;
    if (unitCost === null) {
      if (balance.average.lte(0)) {
        throw new DomainError(
          'UNIT_COST_REQUIRED',
          'There is no cost history for this product yet; enter the unit cost',
        );
      }
      unitCost = balance.average;
    }
    if (unitCost.lt(0)) throw new DomainError('UNIT_COST_INVALID', 'Unit cost cannot be negative');

    const tracked = product.trackBatch || product.trackExpiry;
    let batchId: string | null = null;
    if (tracked) {
      batchId = await this.receiveIntoBatch(
        tx,
        ctx,
        product,
        input.batch ?? {},
        input.baseQuantity,
        unitCost,
      );
    } else if (
      input.batch &&
      (input.batch.batchId || input.batch.batchNumber || input.batch.expiryDate)
    ) {
      throw new DomainError(
        'BATCH_NOT_TRACKED',
        'This product does not track batches or expiry dates',
      );
    }

    const newAverage = weightedAverageCost(
      balance.onHand,
      balance.average,
      input.baseQuantity,
      unitCost,
    );
    const after = balance.onHand.plus(input.baseQuantity);
    await this.writeBalance(tx, ctx, input.productId, after, newAverage);
    const movement = await this.writeMovement(tx, ctx, input.productId, {
      batchId,
      type: input.type,
      quantity: input.baseQuantity,
      unitCost,
      balanceAfter: after,
      reference: input.reference,
      reason: input.reason,
    });
    return { movements: [movement], quantityOnHand: qty(after), averageCost: cost(newAverage) };
  }

  async issue(tx: Tx, ctx: StockContext, input: IssueInput): Promise<StockResult> {
    const product = await this.catalog.stockRules(tx, ctx.organizationId, input.productId);
    assertStockBaseQuantity(product.rules, input.baseQuantity);
    const balance = await this.lockBalance(tx, ctx, input.productId);
    const available = balance.onHand.minus(balance.reserved);
    const tracked = product.trackBatch || product.trackExpiry;
    const insufficient = (sellable: Decimal, extra: Record<string, string> = {}) =>
      new AppException(
        'INSUFFICIENT_STOCK',
        `Only ${qty(Decimal.max(sellable, 0))} ${product.baseUnitCode} of ${product.name} available`,
        409,
        {
          productId: product.id,
          requested: qty(input.baseQuantity),
          available: qty(Decimal.max(sellable, 0)),
          ...extra,
        },
      );

    let allocations: { batchId: string | null; quantity: Decimal }[];
    if (!tracked) {
      if (input.batchId)
        throw new DomainError(
          'BATCH_NOT_TRACKED',
          'This product does not track batches or expiry dates',
        );
      if (input.baseQuantity.gt(available) && !input.allowNegative) throw insufficient(available);
      allocations = [{ batchId: null, quantity: input.baseQuantity }];
    } else {
      const today = todayInIndia();
      let batches = await this.lockBatches(tx, ctx, input.productId);
      let includeExpired = input.type === 'EXPIRY';
      if (input.batchId) {
        batches = batches.filter((b) => b.id === input.batchId);
        if (batches.length === 0)
          throw new AppException('BATCH_NOT_FOUND', 'Batch not found or already empty', 404);
        if (input.type === 'SALE' && isExpired(batches[0]!.expiryDate, today)) {
          throw new DomainError('BATCH_EXPIRED', 'This batch has expired and cannot be sold');
        }
        includeExpired = input.type !== 'SALE'; // a named batch may be written off even after expiry
      }
      const plan = allocateFefo(
        batches.map((b) => ({ id: b.id, expiryDate: b.expiryDate, quantity: b.quantity })),
        input.baseQuantity,
        today,
        includeExpired,
      );
      const sellable = input.baseQuantity.minus(plan.shortfall);
      const overBalance = input.baseQuantity.gt(available);
      if ((plan.shortfall.gt(0) || overBalance) && !input.allowNegative) {
        throw insufficient(
          Decimal.min(sellable, available),
          plan.expiredQuantity.gt(0) ? { expired: qty(plan.expiredQuantity) } : {},
        );
      }
      allocations = plan.allocations.map((a) => ({ batchId: a.batchId, quantity: a.quantity }));
      // An authorised deficit is recorded without a batch (there is no physical batch to take it from).
      if (plan.shortfall.gt(0)) allocations.push({ batchId: null, quantity: plan.shortfall });
    }

    const unitCost = balance.average;
    let running = balance.onHand;
    const movements: MovementView[] = [];
    for (const a of allocations) {
      if (a.batchId) await this.takeFromBatch(tx, a.batchId, a.quantity, input.type);
      running = running.minus(a.quantity);
      movements.push(
        await this.writeMovement(tx, ctx, input.productId, {
          batchId: a.batchId,
          type: input.type,
          quantity: a.quantity.negated(),
          unitCost,
          balanceAfter: running,
          reference: input.reference,
          reason: input.reason,
        }),
      );
    }
    await this.writeBalance(tx, ctx, input.productId, running, balance.average);
    return {
      movements,
      quantityOnHand: qty(running),
      averageCost: cost(balance.average),
      costOfGoods: input.baseQuantity
        .mul(unitCost)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toFixed(2),
    };
  }

  /** Issues several products in one transaction, always in product-id order (deadlock-free under concurrency). */
  async issueMany(tx: Tx, ctx: StockContext, inputs: IssueInput[]): Promise<StockResult[]> {
    const order = inputs
      .map((input, index) => ({ input, index }))
      .sort((a, b) =>
        a.input.productId < b.input.productId
          ? -1
          : a.input.productId > b.input.productId
            ? 1
            : a.index - b.index,
      );
    const results: StockResult[] = new Array(inputs.length);
    for (const { input, index } of order) results[index] = await this.issue(tx, ctx, input);
    return results;
  }

  // ---------- internals ----------

  private async lockBalance(tx: Tx, ctx: StockContext, productId: string): Promise<LockedBalance> {
    await tx.$executeRaw`
      INSERT INTO inventory_balances (id, organization_id, branch_id, product_id, quantity_on_hand, reserved_qty, average_cost, updated_at)
      VALUES (gen_random_uuid(), ${ctx.organizationId}::uuid, ${ctx.branchId}::uuid, ${productId}::uuid, 0, 0, 0, now())
      ON CONFLICT (branch_id, product_id) DO NOTHING`;
    const rows = await tx.$queryRaw<{ on_hand: string; reserved: string; average: string }[]>`
      SELECT quantity_on_hand::text AS on_hand, reserved_qty::text AS reserved, average_cost::text AS average
      FROM inventory_balances
      WHERE branch_id = ${ctx.branchId}::uuid AND product_id = ${productId}::uuid AND organization_id = ${ctx.organizationId}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new AppException('INTERNAL_ERROR', 'Could not lock the stock balance', 500);
    return { onHand: d(row.on_hand), reserved: d(row.reserved), average: d(row.average) };
  }

  private async writeBalance(
    tx: Tx,
    ctx: StockContext,
    productId: string,
    onHand: Decimal,
    average: Decimal,
  ) {
    await tx.inventoryBalance.update({
      where: { branchId_productId: { branchId: ctx.branchId, productId } },
      data: { quantityOnHand: qty(onHand), averageCost: cost(average) },
    });
  }

  /** Active batches with stock, locked in FEFO order (earliest expiry first, then oldest received). */
  private async lockBatches(tx: Tx, ctx: StockContext, productId: string): Promise<LockedBatch[]> {
    const rows = await tx.$queryRaw<
      { id: string; batch_number: string; expiry: string | null; q: string; c: string }[]
    >`
      SELECT id, batch_number, to_char(expiry_date, 'YYYY-MM-DD') AS expiry, quantity_on_hand::text AS q, unit_cost::text AS c
      FROM inventory_batches
      WHERE branch_id = ${ctx.branchId}::uuid AND product_id = ${productId}::uuid AND organization_id = ${ctx.organizationId}::uuid
        AND quantity_on_hand > 0
      ORDER BY expiry_date ASC NULLS LAST, received_at ASC, id ASC
      FOR UPDATE`;
    return rows.map((r) => ({
      id: r.id,
      batchNumber: r.batch_number,
      expiryDate: r.expiry,
      quantity: d(r.q),
      unitCost: d(r.c),
    }));
  }

  private async receiveIntoBatch(
    tx: Tx,
    ctx: StockContext,
    product: { id: string; trackBatch: boolean; trackExpiry: boolean },
    input: BatchInput,
    quantity: Decimal,
    unitCost: Decimal,
  ): Promise<string> {
    if (
      input.expiryDate !== undefined &&
      input.expiryDate !== null &&
      !isRealIsoDate(input.expiryDate)
    ) {
      throw new DomainError('EXPIRY_INVALID', 'expiryDate must be YYYY-MM-DD');
    }
    const today = todayInIndia();
    if (input.expiryDate && isExpired(input.expiryDate, today)) {
      throw new DomainError(
        'BATCH_ALREADY_EXPIRED',
        'Expired stock cannot be received into saleable stock',
      );
    }

    let row: { id: string; expiry: string | null; q: string; c: string } | undefined;
    if (input.batchId) {
      const rows = await tx.$queryRaw<
        { id: string; expiry: string | null; q: string; c: string }[]
      >`
        SELECT id, to_char(expiry_date, 'YYYY-MM-DD') AS expiry, quantity_on_hand::text AS q, unit_cost::text AS c
        FROM inventory_batches
        WHERE id = ${input.batchId}::uuid AND branch_id = ${ctx.branchId}::uuid AND product_id = ${product.id}::uuid
        FOR UPDATE`;
      row = rows[0];
      if (!row)
        throw new AppException(
          'BATCH_NOT_FOUND',
          'Batch not found for this product in this branch',
          404,
        );
    } else {
      const batchNumber =
        input.batchNumber?.trim() ||
        (product.trackExpiry && input.expiryDate ? `EXP-${input.expiryDate}` : '');
      if (product.trackBatch && !input.batchNumber?.trim())
        throw new DomainError('BATCH_REQUIRED', 'Enter the batch number');
      if (!batchNumber) throw new DomainError('EXPIRY_REQUIRED', 'Enter the expiry date');
      const expiry = input.expiryDate ?? null;
      await tx.$executeRaw`
        INSERT INTO inventory_batches (id, organization_id, branch_id, product_id, batch_number, expiry_date, quantity_on_hand, unit_cost, status, updated_at)
        VALUES (gen_random_uuid(), ${ctx.organizationId}::uuid, ${ctx.branchId}::uuid, ${product.id}::uuid, ${batchNumber}, ${expiry}::date, 0, ${cost(unitCost)}::numeric, 'ACTIVE', now())
        ON CONFLICT (branch_id, product_id, batch_number) DO NOTHING`;
      const rows = await tx.$queryRaw<
        { id: string; expiry: string | null; q: string; c: string }[]
      >`
        SELECT id, to_char(expiry_date, 'YYYY-MM-DD') AS expiry, quantity_on_hand::text AS q, unit_cost::text AS c
        FROM inventory_batches
        WHERE branch_id = ${ctx.branchId}::uuid AND product_id = ${product.id}::uuid AND batch_number = ${batchNumber}
        FOR UPDATE`;
      row = rows[0]!;
    }

    if (
      input.expiryDate !== undefined &&
      input.expiryDate !== null &&
      row.expiry !== input.expiryDate
    ) {
      throw new DomainError(
        'BATCH_EXPIRY_MISMATCH',
        `This batch is recorded with expiry ${row.expiry ?? 'none'}`,
      );
    }
    if (product.trackExpiry && !row.expiry)
      throw new DomainError('EXPIRY_REQUIRED', 'Enter the expiry date');
    // Covers existing batches too: never put stock back into a batch that has already expired.
    if (isExpired(row.expiry, today)) {
      throw new DomainError(
        'BATCH_ALREADY_EXPIRED',
        'Expired stock cannot be received into saleable stock',
      );
    }

    const batchQty = d(row.q);
    const batchCost = weightedAverageCost(batchQty, d(row.c), quantity, unitCost);
    await tx.inventoryBatch.update({
      where: { id: row.id },
      data: {
        quantityOnHand: qty(batchQty.plus(quantity)),
        unitCost: cost(batchCost),
        status: 'ACTIVE',
      },
    });
    return row.id;
  }

  private async takeFromBatch(tx: Tx, batchId: string, quantity: Decimal, type: OutboundType) {
    const batch = await tx.inventoryBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { quantityOnHand: true },
    });
    const left = d(batch.quantityOnHand).minus(quantity);
    await tx.inventoryBatch.update({
      where: { id: batchId },
      data: {
        quantityOnHand: qty(left),
        status: left.isZero() ? (type === 'EXPIRY' ? 'EXPIRED' : 'DEPLETED') : 'ACTIVE',
      },
    });
  }

  private async writeMovement(
    tx: Tx,
    ctx: StockContext,
    productId: string,
    m: {
      batchId: string | null;
      type: InboundType | OutboundType;
      quantity: Decimal;
      unitCost: Decimal;
      balanceAfter: Decimal;
      reference: StockReference;
      reason?: string;
    },
  ): Promise<MovementView> {
    const row = await tx.stockMovement.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: ctx.branchId,
        productId,
        batchId: m.batchId,
        type: m.type,
        quantity: qty(m.quantity),
        unitCost: cost(m.unitCost),
        balanceAfter: qty(m.balanceAfter),
        referenceType: m.reference.type,
        referenceId: m.reference.id,
        referenceLineId: m.reference.lineId,
        reason: m.reason,
        createdById: ctx.actorId,
      },
      select: { id: true },
    });
    return {
      id: row.id,
      batchId: m.batchId,
      quantity: qty(m.quantity),
      unitCost: cost(m.unitCost),
      balanceAfter: qty(m.balanceAfter),
    };
  }
}
