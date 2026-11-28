import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const TICKET_CATEGORIES = ['BILLING', 'BUG', 'HOW_TO', 'CALLBACK', 'OTHER'] as const;
export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
] as const;
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

export class CreateTicketDto {
  @ApiProperty({ enum: TICKET_CATEGORIES })
  @IsIn(TICKET_CATEGORIES)
  category!: (typeof TICKET_CATEGORIES)[number];
  @ApiProperty() @IsString() @Length(3, 200) subject!: string;
  @ApiProperty() @IsString() @Length(1, 5000) message!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) appVersion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) deviceInfo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) lastCorrelationId?: string;
}

export class CallbackDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone!: string;
  @ApiProperty({ example: 'Today 4-6 pm' }) @IsString() @Length(2, 100) window!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) message?: string;
}

export class TicketReplyDto {
  @ApiProperty() @IsString() @Length(1, 5000) body!: string;
}

export class TicketListQuery {
  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: (typeof TICKET_STATUSES)[number];
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
