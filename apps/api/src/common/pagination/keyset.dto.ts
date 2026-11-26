import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Opt-in keyset paging for heavy lists (FIXES F12). `paging=cursor` starts at the top; then pass
 * `meta.nextCursor` back as `cursor`. The answer is `{ data, meta: { limit, hasMore, nextCursor,
 * serverTime } }` with no total. `pageSize` sets the page length. Without these, `page`/`pageSize`
 * work as before.
 */
export class KeysetQuery {
  @ApiPropertyOptional({ enum: ['cursor'] })
  @IsOptional()
  @IsIn(['cursor'])
  paging?: 'cursor';

  @ApiPropertyOptional({ description: 'meta.nextCursor of the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
