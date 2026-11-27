import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { normalizeIndianPhone } from '@ksms/validation';
import { GSTIN_REGEX, STATE_CODE_REGEX } from '../organization/organization.dto';

// Money and quantities travel as decimal STRINGS, never JSON numbers.
const MONEY = /^\d{1,11}(\.\d{1,2})?$/;
const SIGNED_SMALL_MONEY = /^-?\d{1,2}(\.\d{1,2})?$/;
const UNIT_COST = /^\d{1,10}(\.\d{1,4})?$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const RATE = /^\d{1,3}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const msg = (what: string) => ({ message: `${what} must be a decimal string like "125.50"` });

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethodName = (typeof PAYMENT_METHODS)[number];

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const phone = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (normalizeIndianPhone(value) ?? value) : value,
  );
const bool = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );

// ---------------------------------------------------------------- suppliers

export class CreateSupplierDto {
  @trim() @IsString() @Length(2, 150) name!: string;
  @IsOptional() @trim() @IsString() @MaxLength(100) contactPerson?: string;
  @IsOptional()
  @phone()
  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone?: string;
  @IsOptional() @trim() @IsEmail() @MaxLength(150) email?: string;
  @IsOptional() @Matches(GSTIN_REGEX, { message: 'gstin is not a valid GSTIN' }) gstin?: string;
  @IsOptional() @trim() @IsString() @MaxLength(300) addressLine?: string;
  @IsOptional()
  @Matches(STATE_CODE_REGEX, { message: 'stateCode must be the 2-digit GST state code' })
  stateCode?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  /** What the shop already owed this supplier when it started using Yapaaram. Needs the X-Branch-Id header. */
  @IsOptional() @Matches(MONEY, msg('openingBalance')) openingBalance?: string;
}

export class UpdateSupplierDto {
  @IsOptional() @trim() @IsString() @Length(2, 150) name?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @trim()
  @IsString()
  @MaxLength(100)
  contactPerson?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @phone()
  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @trim() @IsEmail() @MaxLength(150) email?:
    string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(GSTIN_REGEX, { message: 'gstin is not a valid GSTIN' })
  gstin?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @trim() @IsString() @MaxLength(300) addressLine?:
    string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(STATE_CODE_REGEX, { message: 'stateCode must be the 2-digit GST state code' })
  stateCode?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(365) paymentTermsDays?:
    number | null;
  /** Send the version you loaded; a stale value is refused (409). */
  @IsOptional() @IsInt() @Min(1) version?: number;
}

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class SuppliersQuery extends PageQuery {
  /** Matches name, contact person, phone or GSTIN. */
  @IsOptional() @trim() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @bool() @IsBoolean() isActive?: boolean;
  /** true = only suppliers the shop currently owes money to. */
  @IsOptional() @bool() @IsBoolean() owed?: boolean;
  @IsOptional() @IsIn(['name', 'balance', 'createdAt']) sort?: 'name' | 'balance' | 'createdAt';
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

export class LedgerQuery extends PageQuery {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
}

// ---------------------------------------------------------------- purchases

export class PurchaseItemDto {
  @IsUUID() productId!: string;
  /** The unit being bought in (e.g. BAG); must be purchase-enabled for the product. */
  @IsUUID() unitId!: string;
  @Matches(QTY, msg('quantity')) quantity!: string;
  /** Price of ONE purchase unit (per bag, per carton...) before discount and tax. */
  @Matches(UNIT_COST, msg('unitCost')) unitCost!: string;
  /** Discount for the whole line in rupees. */
  @IsOptional() @Matches(MONEY, msg('discount')) discount?: string;
  @IsOptional() @Matches(RATE, msg('taxRatePercent')) taxRatePercent?: string;
  @IsOptional() @trim() @IsString() @Length(1, 60) batchNumber?: string;
  @IsOptional() @Matches(DATE, { message: 'expiryDate must be YYYY-MM-DD' }) expiryDate?: string;
}

export class CreatePurchaseDto {
  @IsUUID() supplierId!: string;
  /** Defaults to today (India time). Cannot be in the future. */
  @IsOptional()
  @Matches(DATE, { message: 'purchaseDate must be YYYY-MM-DD' })
  purchaseDate?: string;
  @IsOptional() @trim() @IsString() @MaxLength(60) supplierInvoiceNo?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];
  /** Freight, loading and similar costs; shared across the lines to give each item its true cost. */
  @IsOptional() @Matches(MONEY, msg('additionalCosts')) additionalCosts?: string;
  /** Small adjustment to match the supplier's bill, between -5 and +5. */
  @IsOptional() @Matches(SIGNED_SMALL_MONEY, msg('roundOff')) roundOff?: string;
  @IsOptional() @trim() @IsString() @MaxLength(500) notes?: string;
  /** true = the goods are here now: create the purchase and receive every item in one step. */
  @IsOptional() @IsBoolean() receiveNow?: boolean;
}

export class UpdatePurchaseDto {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional()
  @Matches(DATE, { message: 'purchaseDate must be YYYY-MM-DD' })
  purchaseDate?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @trim()
  @IsString()
  @MaxLength(60)
  supplierInvoiceNo?: string | null;
  /** When present, REPLACES all lines. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items?: PurchaseItemDto[];
  @IsOptional() @Matches(MONEY, msg('additionalCosts')) additionalCosts?: string;
  @IsOptional() @Matches(SIGNED_SMALL_MONEY, msg('roundOff')) roundOff?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @trim() @IsString() @MaxLength(500) notes?:
    string | null;
}

export class ReceiveLineDto {
  @IsUUID() itemId!: string;
  /** In the unit the item was ordered in (e.g. 3 BAG). */
  @Matches(QTY, msg('quantity')) quantity!: string;
  @IsOptional() @trim() @IsString() @Length(1, 60) batchNumber?: string;
  @IsOptional() @Matches(DATE, { message: 'expiryDate must be YYYY-MM-DD' }) expiryDate?: string;
}

export class ReceivePurchaseDto {
  /** Leave out to receive everything still outstanding, using the batch and expiry details on the order. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines?: ReceiveLineDto[];
}

export class CancelPurchaseDto {
  @trim() @IsString() @Length(5, 200) reason!: string;
}

export class PurchasesQuery extends PageQuery {
  @IsOptional()
  @IsIn(['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'])
  status?: 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  /** Matches the purchase number or the supplier's invoice number. */
  @IsOptional() @trim() @IsString() @MaxLength(60) q?: string;
  /** true = received purchases that are not fully paid yet. */
  @IsOptional() @bool() @IsBoolean() unpaid?: boolean;
}

// ---------------------------------------------------------------- returns

export class PurchaseReturnItemDto {
  @IsUUID() purchaseItemId!: string;
  /** In the unit the item was bought in. */
  @Matches(QTY, msg('quantity')) quantity!: string;
  /** Required for products tracked by batch or expiry: which batch the goods come from. */
  @IsOptional() @IsUUID() batchId?: string;
}

export class CreatePurchaseReturnDto {
  @IsUUID() purchaseId!: string;
  @trim() @IsString() @Length(3, 200) reason!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseReturnItemDto)
  items!: PurchaseReturnItemDto[];
}

export class ReturnsQuery extends PageQuery {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() purchaseId?: string;
}

// ---------------------------------------------------------------- supplier payments

export class PaymentAllocationDto {
  @IsUUID() purchaseId!: string;
  @Matches(MONEY, msg('amount')) amount!: string;
}

export class SupplierPaymentDto {
  @Matches(MONEY, msg('amount')) amount!: string;
  @IsIn(PAYMENT_METHODS) method!: PaymentMethodName;
  /** UPI transaction id, cheque number, etc. */
  @IsOptional() @trim() @IsString() @MaxLength(100) referenceNo?: string;
  @IsOptional() @trim() @IsString() @MaxLength(300) notes?: string;
  /** Which purchases this pays. Leave out to pay the oldest unpaid purchases first. Any extra stays as an advance. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];
}

export class ReversePaymentDto {
  @trim() @IsString() @Length(5, 200) reason!: string;
}

export class PaymentsQuery extends PageQuery {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
}
