import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { RolePermissionService } from '../../common/auth/role-permission.service';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { toBaseQuantity } from '../catalog/domain/units';
import { ProductsService } from '../catalog/products.service';
import { COST_SCALE } from './domain/stock';
import type { OpeningStockDto, StockAdjustmentDto } from './inventory.dto';
import { InventoryService, type StockContext } from './inventory.service';

type Tx = Prisma.TransactionClient;
interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const MUST_REMOVE = new Set(['DAMAGE', 'EXPIRY', 'LOSS']);
const MUST_ADD = new Set(['FOUND']);

/**
 * User-initiated stock changes: opening stock and adjustments (damage, expiry, loss, found, count corrections).
 * Every request needs an Idempotency-Key so a retried request can never be applied twice.
 */
@Injectable()
export class StockAdjustmentsService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly catalog: ProductsService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly rolePerms: RolePermissionService,
  ) {}

  async openingStock(t: TenantContext, key: string, dto: OpeningStockDto, meta: Meta) {
    const ctx = this.ctx(t);
    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /inventory/opening-stock',
      { branchId: ctx.branchId, ...dto },
      async (tx) => {
        const { baseQuantity, baseCost, product } = await this.convert(
          tx,
          t,
          dto.productId,
          dto.unitId,
          new Decimal(dto.quantity),
          dto.unitCost,
        );

        // Opening stock is for setting up; once real activity exists, use an adjustment instead.
        const activity = await tx.stockMovement.count({
          where: {
            organizationId: t.organizationId,
            branchId: ctx.branchId,
            productId: dto.productId,
            type: { not: 'OPENING' },
          },
        });
        if (activity > 0) {
          throw new AppException(
            'OPENING_STOCK_LOCKED',
            'This product already has stock activity in this branch; use a stock adjustment',
            409,
          );
        }

        const referenceId = randomUUID();
        const result = await this.inventory.receive(tx, ctx, {
          productId: dto.productId,
          type: 'OPENING',
          baseQuantity,
          unitCost: baseCost,
          batch: { batchId: dto.batchId, batchNumber: dto.batchNumber, expiryDate: dto.expiryDate },
          reference: { type: 'OPENING_STOCK', id: referenceId },
        });
        const view = {
          referenceId,
          productId: product.id,
          baseUnitCode: product.baseUnitCode,
          baseQuantity: baseQuantity.toFixed(3),
          ...result,
        };
        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId: ctx.branchId,
          actorId: t.userId,
          action: 'stock.opening',
          entityType: 'product',
          entityId: product.id,
          after: view as unknown as Prisma.InputJsonValue,
          ...meta,
        });
        return view;
      },
    );
  }

  async adjust(t: TenantContext, key: string, dto: StockAdjustmentDto, meta: Meta) {
    const ctx = this.ctx(t);
    const signed = new Decimal(dto.quantity);
    if (signed.isZero()) throw new DomainError('QUANTITY_INVALID', 'Quantity must not be zero');
    if (MUST_REMOVE.has(dto.reason) && signed.gt(0))
      throw new DomainError(
        'ADJUSTMENT_DIRECTION',
        `${dto.reason} must remove stock (use a negative quantity)`,
      );
    if (MUST_ADD.has(dto.reason) && signed.lt(0))
      throw new DomainError(
        'ADJUSTMENT_DIRECTION',
        'FOUND must add stock (use a positive quantity)',
      );

    if (dto.allowNegative) await this.assertNegativeOverrideAllowed(t, dto);

    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /inventory/adjustments',
      { branchId: ctx.branchId, ...dto },
      async (tx) => {
        if (dto.allowNegative) {
          const org = await tx.organization.findUniqueOrThrow({
            where: { id: t.organizationId },
            select: { allowNegativeStock: true },
          });
          if (!org.allowNegativeStock) {
            throw new DomainError(
              'NEGATIVE_STOCK_DISABLED',
              'Negative stock is switched off for this shop (Settings)',
            );
          }
        }
        const { baseQuantity, baseCost, product } = await this.convert(
          tx,
          t,
          dto.productId,
          dto.unitId,
          signed.abs(),
          dto.unitCost,
        );
        const adjustmentId = randomUUID();
        const reference = { type: 'ADJUSTMENT', id: adjustmentId };
        const tracked = product.trackBatch || product.trackExpiry;

        let result;
        if (signed.lt(0)) {
          if (tracked && !dto.batchId)
            throw new DomainError('BATCH_REQUIRED', 'Choose which batch is being removed');
          if (dto.batchNumber || dto.expiryDate)
            throw new DomainError(
              'BATCH_INPUT_INVALID',
              'Use batchId to remove stock from a batch',
            );
          result = await this.inventory.issue(tx, ctx, {
            productId: dto.productId,
            type:
              dto.reason === 'DAMAGE'
                ? 'DAMAGE'
                : dto.reason === 'EXPIRY'
                  ? 'EXPIRY'
                  : 'ADJUSTMENT_OUT',
            baseQuantity,
            batchId: dto.batchId,
            reference,
            reason: dto.notes ?? dto.reason,
            allowNegative: dto.allowNegative === true,
          });
        } else {
          result = await this.inventory.receive(tx, ctx, {
            productId: dto.productId,
            type: 'ADJUSTMENT_IN',
            baseQuantity,
            unitCost: dto.unitCost === undefined ? null : baseCost,
            batch: {
              batchId: dto.batchId,
              batchNumber: dto.batchNumber,
              expiryDate: dto.expiryDate,
            },
            reference,
            reason: dto.notes ?? dto.reason,
          });
        }

        const signedBase = signed.lt(0) ? baseQuantity.negated() : baseQuantity;
        await tx.stockAdjustment.create({
          data: {
            id: adjustmentId,
            organizationId: t.organizationId,
            branchId: ctx.branchId,
            productId: dto.productId,
            batchId: result.movements[0]!.batchId,
            reason: dto.reason,
            quantity: signedBase.toFixed(3),
            notes: dto.notes,
            movementId: result.movements[0]!.id,
            createdById: t.userId,
          },
        });

        const view = {
          id: adjustmentId,
          productId: product.id,
          reason: dto.reason,
          baseQuantity: signedBase.toFixed(3),
          baseUnitCode: product.baseUnitCode,
          notes: dto.notes ?? null,
          ...result,
        };
        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId: ctx.branchId,
          actorId: t.userId,
          action: dto.allowNegative ? 'stock.adjust.negative_override' : 'stock.adjust',
          entityType: 'stock_adjustment',
          entityId: adjustmentId,
          after: view as unknown as Prisma.InputJsonValue,
          reason: dto.notes,
          ...meta,
        });
        return view;
      },
    );
  }

  private ctx(t: TenantContext): StockContext {
    if (!t.branchId)
      throw new AppException('BRANCH_REQUIRED', 'x-branch-id header is required', 400);
    return { organizationId: t.organizationId, branchId: t.branchId, actorId: t.userId };
  }

  /** Converts a quantity and per-unit cost given in any configured unit into base units. */
  private async convert(
    tx: Tx,
    t: TenantContext,
    productId: string,
    unitId: string,
    quantity: Decimal,
    unitCost: string | undefined,
  ) {
    const product = await this.catalog.stockRules(tx, t.organizationId, productId);
    const conv = product.conversions.get(unitId);
    if (!conv)
      throw new AppException('UNIT_NOT_CONFIGURED', 'This unit is not set up for the product', 422);
    const baseQuantity = toBaseQuantity(quantity, conv.factorToBase);
    const baseCost = new Decimal(unitCost ?? '0')
      .div(conv.factorToBase)
      .toDecimalPlaces(COST_SCALE, Decimal.ROUND_HALF_UP);
    return { product, baseQuantity, baseCost };
  }

  private async assertNegativeOverrideAllowed(
    t: TenantContext,
    dto: StockAdjustmentDto,
  ): Promise<void> {
    const perms = await this.rolePerms.get(t.roleId);
    if (!perms.isOwner && !perms.keys.has('stock.override_negative')) {
      throw new AppException(
        'FORBIDDEN',
        'You do not have permission to take stock below zero',
        403,
        { required: ['stock.override_negative'] },
      );
    }
    if (!dto.notes || dto.notes.trim().length < 5) {
      throw new DomainError(
        'OVERRIDE_REASON_REQUIRED',
        'Explain why stock may go below zero (notes)',
      );
    }
  }
}
