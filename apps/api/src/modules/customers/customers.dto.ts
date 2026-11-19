import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { normalizeIndianPhone } from '@ksms/validation';
import { GSTIN_REGEX, STATE_CODE_REGEX } from '../organization/organization.dto';

const MONEY = /^\d{1,11}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RULE = { message: 'phone must be a valid Indian mobile number' };

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

export class CreateCustomerDto {
  @trim() @IsString() @Length(2, 150) name!: string;
  @IsOptional() @phone() @Matches(/^[6-9]\d{9}$/, PHONE_RULE) phone?: string;
  @IsOptional() @trim() @IsEmail() @MaxLength(150) email?: string;
  @IsOptional() @Matches(GSTIN_REGEX, { message: 'gstin is not a valid GSTIN' }) gstin?: string;
  @IsOptional()
  @Matches(STATE_CODE_REGEX, { message: 'stateCode must be the 2-digit GST state code' })
  stateCode?: string;
  @IsOptional() @trim() @IsString() @MaxLength(300) addressLine?: string;
  /** Most the customer may owe. Leave out for no limit. */
  @IsOptional()
  @Matches(MONEY, { message: 'creditLimit must be a decimal string like "5000"' })
  creditLimit?: string;
}

export class UpdateCustomerDto {
  @IsOptional() @trim() @IsString() @Length(2, 150) name?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @phone()
  @Matches(/^[6-9]\d{9}$/, PHONE_RULE)
  phone?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @trim() @IsEmail() @MaxLength(150) email?:
    string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(GSTIN_REGEX, { message: 'gstin is not a valid GSTIN' })
  gstin?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(STATE_CODE_REGEX, { message: 'stateCode must be the 2-digit GST state code' })
  stateCode?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @trim() @IsString() @MaxLength(300) addressLine?:
    string | null;
  /** null removes the limit. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(MONEY, { message: 'creditLimit must be a decimal string like "5000"' })
  creditLimit?: string | null;
  @IsOptional() @IsInt() @Min(1) version?: number;
}

export class CustomersQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  /** Matches name, phone or GSTIN. */
  @IsOptional() @trim() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @bool() @IsBoolean() isActive?: boolean;
  /** true = only customers who owe the shop money. */
  @IsOptional() @bool() @IsBoolean() owes?: boolean;
  @IsOptional() @IsIn(['name', 'balance', 'createdAt']) sort?: 'name' | 'balance' | 'createdAt';
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

export class CustomerLedgerQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
}

export class AdjustCustomerLedgerDto {
  @IsIn(['DEBIT', 'CREDIT'])
  direction!: 'DEBIT' | 'CREDIT';

  @IsOptional()
  @IsIn(['ADJUSTMENT', 'OPENING_BALANCE'])
  entryType?: 'ADJUSTMENT' | 'OPENING_BALANCE';

  @Matches(MONEY, { message: 'amount must be a decimal string like "250.00"' })
  amount!: string;

  @trim()
  @IsString()
  @Length(2, 300)
  description!: string;
}
