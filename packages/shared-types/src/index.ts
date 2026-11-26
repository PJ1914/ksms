/** Money and quantities cross the API as decimal STRINGS, never JS numbers. */
export type DecimalString = string;

export interface ApiSuccess<T> {
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    /** Page-style lists: capped at 10,000 (`totalCapped` is then true). */
    total?: number;
    totalCapped?: boolean;
    /** Keyset lists (`?paging=cursor`, then `?cursor=`): no total. */
    limit?: number;
    hasMore?: boolean;
    nextCursor?: string | null;
    serverTime?: string;
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;
