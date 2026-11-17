import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { normalizeIndianPhone } from '@ksms/validation';

export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
export const STATE_CODE_REGEX = /^\d{2}$/;

const phone = () =>
  Transform(({ value }: { value: unknown }) =>
    value === undefined ? value : (normalizeIndianPhone(value) ?? value),
  );

export class UpdateOrganizationDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsString() @Length(2, 150) legalName?: string;
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}\d{4}[A-Z]$/, { message: 'pan must be a valid PAN' })
  pan?: string;
  @IsOptional()
  @phone()
  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone?: string;
  @IsOptional() @IsEmail() @MaxLength(150) email?: string;
  @IsOptional() @IsBoolean() gstEnabled?: boolean;
  @IsOptional() @IsIn(['INCLUSIVE', 'EXCLUSIVE']) defaultTaxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
  @IsOptional() @IsBoolean() allowNegativeStock?: boolean;
  /** Decimal string 0-100, e.g. "5" or "7.5". */
  @IsOptional()
  @Matches(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/, {
    message: 'must be a percentage between 0 and 100',
  })
  maxCashierDiscountPercent?: string;
}

export class CreateBranchDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,12}$/, { message: 'code must be 2-12 chars: A-Z, 0-9, _ or -' })
  code!: string;
  @IsString() @Length(2, 100) name!: string;
  @IsOptional() @IsString() @MaxLength(200) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @Matches(/^\d{6}$/, { message: 'pincode must be 6 digits' }) pincode?: string;
  @IsOptional()
  @Matches(STATE_CODE_REGEX, { message: 'stateCode must be the 2-digit GST state code' })
  stateCode?: string;
  @IsOptional() @Matches(GSTIN_REGEX, { message: 'gstin is not a valid GSTIN' }) gstin?: string;
  @IsOptional()
  @phone()
  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone?: string;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsString() @MaxLength(200) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @Matches(/^\d{6}$/, { message: 'pincode must be 6 digits' }) pincode?: string;
  @IsOptional()
  @Matches(STATE_CODE_REGEX, { message: 'stateCode must be the 2-digit GST state code' })
  stateCode?: string;
  @IsOptional() @Matches(GSTIN_REGEX, { message: 'gstin is not a valid GSTIN' }) gstin?: string;
  @IsOptional()
  @phone()
  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
