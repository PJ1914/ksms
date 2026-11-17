import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CORRELATION_HEADER } from '@ksms/constants';
import { AppException } from '../errors/app.exception';

interface ErrorPayload {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

const STATUS_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Turns every thrown error into the standard `{ error: { code, message, details, correlationId } }` body. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string | number }>();
    const res = http.getResponse<Response>();
    const correlationId = String(req.id ?? req.headers[CORRELATION_HEADER] ?? '');

    const payload = this.toPayload(exception);
    if (payload.status >= 500) {
      this.logger.error(
        { correlationId, err: exception instanceof Error ? exception.stack : String(exception) },
        'Unhandled error',
      );
    }

    res.status(payload.status).json({
      error: {
        code: payload.code,
        message: payload.message,
        ...(payload.details !== undefined ? { details: payload.details } : {}),
        correlationId,
      },
    });
  }

  private toPayload(exception: unknown): ErrorPayload {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof ThrottlerException) {
      return { status: 429, code: 'RATE_LIMITED', message: 'Too many requests, slow down' };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: STATUS_CODES[status] ?? 'HTTP_ERROR',
        message: this.messageOf(exception),
      };
    }
    // Prisma unique-constraint violation -> 409 without leaking internals
    if (this.isPrismaCode(exception, 'P2002')) {
      return {
        status: 409,
        code: 'CONFLICT',
        message: 'A record with these values already exists',
      };
    }
    return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong on our side' };
  }

  private messageOf(e: HttpException): string {
    const r = e.getResponse();
    if (typeof r === 'string') return r;
    const m = (r as { message?: unknown }).message;
    return typeof m === 'string' ? m : e.message;
  }

  private isPrismaCode(e: unknown, code: string): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === code;
  }
}
