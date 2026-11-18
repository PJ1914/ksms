import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Money and quantities travel as decimal STRINGS, never JSON numbers.
const MONEY = /^\d{1,11}(\.\d{1,2})?$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const msg = (what: string) => ({ message: `${what} must be a decimal string like "52.50"` });

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethodName = (typeof PAYMENT_METHODS)[number];
export const REFUND_TARGETS = [...PAYMENT_METHODS, 'CUSTOMER_ACCOUNT'] as const;
export const DISPOSITIONS = ['SALEABLE', 'DAMAGED', 'EXPIRED', 'QUARANTINED'] as const;

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class SaleItemDto {
  @IsUUID() productId!: string;
  /** The unit being sold in (KG, G, PCS, ...); must be sale-enabled for the product. */
  @IsUUID() unitId!: string;
  @Matches(QTY, msg('quantity')) quantity!: string;
  /** Rupees off this line. Needs the discount.apply permission. */
  @IsOptional() @Matches(MONEY, msg('discount')) discount?: string;
  /** Price per selling unit typed at the counter, instead of the catalogue price. Needs price.override. */
  @IsOptional() @Matches(MONEY, msg('unitPrice')) unitPrice?: string;
}

export class SalePaymentDto {
  @IsIn(PAYMENT_METHODS) method!: PaymentMethodName;
  @Matches(MONEY, msg('amount')) amount!: string;
  /** UPI transaction id, card slip number, etc. */
  @IsOptional() @trim() @IsString() @MaxLength(100) referenceNo?: string;
}

export class CreateSaleDto {
  /** Leave out for a walk-in customer (walk-in bills must be fully paid). */
  @IsOptional() @IsUUID() customerId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];
  /** Rupees off the whole bill, shared across the lines. Needs discount.apply. */
  @IsOptional() @Matches(MONEY, msg('billDiscount')) billDiscount?: string;
  /** How the bill is paid now. Whatever is not paid goes on the customer's account (credit). */
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  payments!: SalePaymentDto[];
  /** Sell on credit beyond the customer's credit limit for this bill. Needs credit.override_limit; audited. */
  @IsOptional() @IsBoolean() overrideCreditLimit?: boolean;
  /** The held bill this sale came from; it is closed in the same transaction. */
  @IsOptional() @IsUUID() heldBillId?: string;
}

export class SalesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @IsIn(['COMPLETED', 'CANCELLED']) status?: 'COMPLETED' | 'CANCELLED';
  @IsOptional() @IsUUID() customerId?: string;
  /** Matches the bill number. */
  @IsOptional() @trim() @IsString() @MaxLength(40) q?: string;
}

export class CancelSaleDto {
  @trim() @IsString() @Length(5, 200) reason!: string;
}

export class SaleReturnItemDto {
  @IsUUID() saleItemId!: string;
  /** In the unit the item was sold in. */
  @Matches(QTY, msg('quantity')) quantity!: string;
  /** SALEABLE goes back into stock; DAMAGED, EXPIRED and QUARANTINED are recorded but not put back on sale. */
  @IsIn(DISPOSITIONS) disposition!: (typeof DISPOSITIONS)[number];
}

export class CreateSaleReturnDto {
  @IsUUID() saleId!: string;
  @trim() @IsString() @Length(3, 200) reason!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SaleReturnItemDto)
  items!: SaleReturnItemDto[];
  /** Money back by this method, or CUSTOMER_ACCOUNT to reduce what the customer owes. */
  @IsIn(REFUND_TARGETS) refundTo!: (typeof REFUND_TARGETS)[number];
}

export class ReturnsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsUUID() saleId?: string;
}

export class HeldBillDto {
  @IsOptional() @trim() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @IsUUID() customerId?: string;
  /** The cart as the app keeps it. Never touches stock or money. At most 64 KB. */
  @IsObject() payload!: Record<string, unknown>;
}

export class HeldBillsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
