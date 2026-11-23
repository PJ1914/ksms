import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SyncFeedQuery {
  @ApiPropertyOptional({
    description:
      'ISO-8601 timestamp (inclusive). Returns records updated or soft-deleted at or after this instant.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  updated_since?: string;

  @ApiPropertyOptional({
    description: 'Opaque pagination cursor returned in `meta.nextCursor` of the previous page.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Maximum rows per page (default 200, max 500).',
    default: 200,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
