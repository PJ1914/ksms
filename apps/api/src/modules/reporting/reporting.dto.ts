import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The period of a report. Real calendar dates are checked in the service. */
export class RangeQuery {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
}

export class PagedRangeQuery extends RangeQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export const SALES_GROUPS = ['day', 'week', 'month'] as const;
export class SalesSummaryQuery extends RangeQuery {
  @IsOptional() @IsIn(SALES_GROUPS) groupBy?: (typeof SALES_GROUPS)[number];
}

export const SALES_BREAKDOWNS = [
  'product',
  'category',
  'customer',
  'payment_method',
  'cashier',
] as const;
export class SalesBreakdownQuery extends PagedRangeQuery {
  @IsIn(SALES_BREAKDOWNS) by!: (typeof SALES_BREAKDOWNS)[number];
}

export class PurchasesBreakdownQuery extends PagedRangeQuery {
  @IsOptional() @IsIn(['supplier']) by?: 'supplier';
}

export class MoversQuery {
  @IsIn(['fast', 'slow']) kind!: 'fast' | 'slow';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class DayBookQuery {
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class OutstandingQuery {
  @IsIn(['customers', 'suppliers']) party!: 'customers' | 'suppliers';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
