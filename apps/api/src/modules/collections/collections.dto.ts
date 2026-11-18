import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { normalizeIndianPhone } from '@ksms/validation';

const MONEY = /^\d{1,11}(\.\d{1,2})?$/;
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

export class CustomerPaymentDto {
  @Matches(MONEY, msg('amount'))
  amount!: string;

  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethodName;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  referenceNo?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(400)
  notes?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsISO8601()
  collectedAt?: string;
}

export class CreateCollectionDto extends CustomerPaymentDto {
  @IsUUID()
  customerId!: string;
}

export class ReverseCollectionDto {
  @trim()
  @IsString()
  @Length(2, 500)
  reason!: string;
}

export class CreateCollectionAgentDto {
  @trim()
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @phone()
  @IsString()
  @Length(10, 16)
  phone?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class UpdateCollectionAgentDto {
  @IsOptional()
  @trim()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @phone()
  @IsString()
  @Length(10, 16)
  phone?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  userId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AssignCustomerDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @Matches(MONEY, msg('targetAmount'))
  targetAmount?: string;

  @IsOptional()
  @Matches(DATE)
  startDate?: string;
}

export class CollectionsQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() agentId?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethodName;
  @IsOptional() @IsIn(['COMPLETED', 'REVERSED']) status?: 'COMPLETED' | 'REVERSED';
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @trim() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class CollectionAgentsQuery {
  @IsOptional() @bool() @IsBoolean() activeOnly?: boolean;
  @IsOptional() @trim() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class AgentSummaryQuery {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
}
