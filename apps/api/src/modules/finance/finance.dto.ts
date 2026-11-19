import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
} from 'class-validator';

const MONEY = /^\d{1,11}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const msg = (what: string) => ({ message: `${what} must be a decimal string like "125.50"` });

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethodName = (typeof PAYMENT_METHODS)[number];

export const CASHBOOK_KINDS = [
  'SALE_RECEIPT',
  'CUSTOMER_COLLECTION',
  'SUPPLIER_PAYMENT',
  'EXPENSE',
  'REFUND',
  'CASH_IN',
  'CASH_OUT',
  'REVERSAL',
  'OPENING_BALANCE',
] as const;
export type CashbookKindName = (typeof CASHBOOK_KINDS)[number];

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const bool = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );

export class CreateExpenseCategoryDto {
  @trim()
  @IsString()
  @Length(2, 80)
  name!: string;
}

export class UpdateExpenseCategoryDto {
  @IsOptional()
  @trim()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateExpenseDto {
  @IsUUID()
  categoryId!: string;

  @Matches(MONEY, msg('amount'))
  amount!: string;

  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethodName;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  referenceNo?: string;

  @IsOptional()
  @Matches(DATE)
  expenseDate?: string;
}

export class CancelExpenseDto {
  @trim()
  @IsString()
  @Length(2, 400)
  reason!: string;
}

export class ExpensesQuery {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethodName;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @bool() @IsBoolean() includeCancelled?: boolean;
  @IsOptional() @trim() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class CashbookAdjustmentDto {
  @IsIn(['CASH_IN', 'CASH_OUT'])
  kind!: 'CASH_IN' | 'CASH_OUT';

  @Matches(MONEY, msg('amount'))
  amount!: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethodName;

  @trim()
  @IsString()
  @Length(2, 300)
  description!: string;

  @IsOptional()
  @Matches(DATE)
  businessDate?: string;
}

export class CashbookQuery {
  @IsOptional() @IsIn(CASHBOOK_KINDS) kind?: CashbookKindName;
  @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethodName;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @trim() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class CloseDayDto {
  @IsOptional()
  @Matches(DATE)
  businessDate?: string;

  @Matches(MONEY, msg('actualCash'))
  actualCash!: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(400)
  notes?: string;
}

export class ClosingPreviewQuery {
  @IsOptional()
  @Matches(DATE)
  businessDate?: string;
}

export class ClosingsQuery {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
