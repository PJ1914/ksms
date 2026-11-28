import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { AMOUNT_PATTERN } from './pricing';

export const SUB_PAYMENT_METHODS = ['UPI', 'CASH', 'BANK', 'OTHER'] as const;
export type SubPaymentMethodName = (typeof SUB_PAYMENT_METHODS)[number];

export class PaymentInputDto {
  @ApiPropertyOptional({
    example: '1707.15',
    description:
      'Decimal string. Omit to charge the plan price for the months (with the tier discount).',
  })
  @IsOptional()
  @Matches(AMOUNT_PATTERN, {
    message: 'amount must be a positive decimal string with up to 2 decimals',
  })
  amount?: string;

  @ApiProperty({ enum: SUB_PAYMENT_METHODS })
  @IsIn(SUB_PAYMENT_METHODS)
  method!: SubPaymentMethodName;

  @ApiPropertyOptional({ description: 'UPI transaction id / bank reference' })
  @IsOptional()
  @IsString()
  @Length(3, 100)
  reference?: string;

  @ApiPropertyOptional({ description: 'When the money arrived (default: now)' })
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;
}

export class ExtendSubscriptionDto {
  @ApiProperty({ example: 3, description: '1, 3, 6, 9, 12 or any custom number of months' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  months!: number;

  @ApiPropertyOptional({ description: 'Switch to this plan at the same time' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiProperty({ type: PaymentInputDto })
  @ValidateNested()
  @Type(() => PaymentInputDto)
  payment!: PaymentInputDto;

  @ApiPropertyOptional({ description: 'Also unlock the shop if it is locked' })
  @IsOptional()
  @IsBoolean()
  unlock?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class QuoteQuery {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(60) months!: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() planId?: string;
}

export class ChangePlanDto {
  @ApiProperty() @IsUUID() planId!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class AdjustSubscriptionDto {
  @ApiPropertyOptional({ description: 'New end of the paid period (ISO date-time)' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  graceDays?: number;

  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class RefundDto {
  @ApiProperty() @IsUUID() paymentId!: string;

  @ApiPropertyOptional({ description: 'Part of the payment to refund (default: all of it)' })
  @IsOptional()
  @Matches(AMOUNT_PATTERN)
  amount?: string;

  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
