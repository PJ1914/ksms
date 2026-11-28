import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { SUBSCRIPTION_STATES, type SubscriptionState } from '@ksms/constants';

export class ShopsQuery {
  @ApiPropertyOptional({ description: 'Shop name, shop phone or owner phone' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: SUBSCRIPTION_STATES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATES)
  status?: SubscriptionState;

  @ApiPropertyOptional({ example: 'PRO' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  plan?: string;

  @ApiPropertyOptional({ description: 'Only shops whose paid period ends within this many days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  expiringInDays?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** Every platform action on a shop needs a reason; it is kept in the audit log. */
export class ShopReasonDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class ShopNoteDto {
  @ApiProperty({ description: 'Internal note, e.g. SUPPORT recommending a lock' })
  @IsString()
  @Length(3, 2000)
  note!: string;
}
