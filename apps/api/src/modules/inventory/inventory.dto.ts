import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const SIGNED_QTY = /^-?\d{1,11}(\.\d{1,3})?$/;
const COST = /^\d{1,10}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class OpeningStockDto {
  @IsUUID() productId!: string;
  /** Unit the quantity and cost are expressed in (any unit set up for the product, e.g. BAG). */
  @IsUUID() unitId!: string;
  @Matches(QTY, { message: 'quantity must be a positive decimal string' }) quantity!: string;
  /** Cost of ONE of the given unit (e.g. one bag), excluding tax. */
  @Matches(COST, { message: 'unitCost must be a non-negative decimal string' }) unitCost!: string;
  @IsOptional() @IsUUID() batchId?: string;
  @IsOptional() @trim() @IsString() @MaxLength(40) batchNumber?: string;
  @IsOptional() @Matches(DATE, { message: 'expiryDate must be YYYY-MM-DD' }) expiryDate?: string;
}

export const ADJUSTMENT_REASONS = [
  'COUNT_CORRECTION',
  'DAMAGE',
  'EXPIRY',
  'LOSS',
  'FOUND',
  'OTHER',
] as const;
export type AdjustmentReasonInput = (typeof ADJUSTMENT_REASONS)[number];

export class StockAdjustmentDto {
  @IsUUID() productId!: string;
  @IsUUID() unitId!: string;
  /** Signed: negative removes stock (damage, expiry, loss), positive adds (found, count correction). */
  @Matches(SIGNED_QTY, { message: 'quantity must be a signed decimal string, e.g. "-2" or "5.5"' })
  quantity!: string;
  @IsIn(ADJUSTMENT_REASONS) reason!: AdjustmentReasonInput;
  @IsOptional() @trim() @IsString() @MaxLength(300) notes?: string;
  /** Batch to adjust (required for batch/expiry-tracked products when removing stock). */
  @IsOptional() @IsUUID() batchId?: string;
  /** For stock found: which (possibly new) batch it goes into. */
  @IsOptional() @trim() @IsString() @MaxLength(40) batchNumber?: string;
  @IsOptional() @Matches(DATE, { message: 'expiryDate must be YYYY-MM-DD' }) expiryDate?: string;
  /** For stock found: cost of ONE of the given unit; defaults to the current average cost. */
  @IsOptional()
  @Matches(COST, { message: 'unitCost must be a non-negative decimal string' })
  unitCost?: string;
  /** Allow the balance to go below zero. Needs the shop setting, the stock.override_negative permission and notes. */
  @IsOptional() @IsBoolean() allowNegative?: boolean;
}

export class BalancesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @trim() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  /** Only products at or below their minimum stock level. */
  @IsOptional() @IsIn(['true', 'false']) lowStock?: 'true' | 'false';
  /** Only products with stock > 0. */
  @IsOptional() @IsIn(['true', 'false']) inStock?: 'true' | 'false';
}

export const MOVEMENT_TYPES = [
  'OPENING',
  'PURCHASE_RECEIPT',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'EXPIRY',
  'CANCELLATION_REVERSAL',
  'TRANSFER_IN',
  'TRANSFER_OUT',
] as const;

export class MovementsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsIn(MOVEMENT_TYPES) type?: (typeof MOVEMENT_TYPES)[number];
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class ExpiringQuery {
  /** Batches expiring within this many days (already-expired batches are always included). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) withinDays?: number;
}
