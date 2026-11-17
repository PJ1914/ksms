import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { CORRELATION_HEADER } from '@ksms/constants';
import type { Env } from '../../config/env';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Reuse a well-formed client-supplied correlation id, otherwise generate one; always echo it back. */
export function resolveCorrelationId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[CORRELATION_HEADER];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(CORRELATION_HEADER, id);
  return id;
}

export function loggerOptions(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId: resolveCorrelationId,
      // never log credentials or tokens
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["idempotency-key"]',
        ],
        censor: '[redacted]',
      },
      customProps: (req: IncomingMessage) => ({ correlationId: (req as { id?: string }).id }),
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  };
}
