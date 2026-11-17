import { HttpException } from '@nestjs/common';

/** Stable, machine-readable error codes returned to clients. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ORG_ACCESS_DENIED'
  | 'BRANCH_FORBIDDEN'
  | 'BRANCH_REQUIRED'
  | 'INVALID_BRANCH_ID'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'HTTP_ERROR'
  // business codes are added by later phases (e.g. INSUFFICIENT_STOCK)
  | (string & {});

export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: number,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}
