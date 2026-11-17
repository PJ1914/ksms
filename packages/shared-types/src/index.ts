/** Money and quantities cross the API as decimal STRINGS, never JS numbers. */
export type DecimalString = string;

export interface ApiSuccess<T> {
  data: T;
  meta?: { page?: number; pageSize?: number; total?: number; nextCursor?: string | null };
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
