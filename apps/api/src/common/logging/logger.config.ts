import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { API_PREFIX, CORRELATION_HEADER } from '@ksms/constants';
import type { Env } from '../../config/env';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Reuse a well-formed client-supplied correlation id, otherwise generate one; always echo it back. */
export function resolveCorrelationId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[CORRELATION_HEADER];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(CORRELATION_HEADER, id);
  return id;
}

const HEALTH_PATH = `/${API_PREFIX}/health`;

/** `/api/v1/health` and `/api/v1/health/ready` (with or without a query string). */
export function isHealthProbe(req: IncomingMessage): boolean {
  const path = (req.url ?? '').split('?')[0]!;
  return path === HEALTH_PATH || path.startsWith(`${HEALTH_PATH}/`);
}

export function loggerOptions(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId: resolveCorrelationId,
      // Health probes (Render, uptime pinger) run every few seconds; logging them is pure cost.
      autoLogging: { ignore: isHealthProbe },
      // Request bodies are never logged: the default serializers keep only method, url, headers and ids.
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
