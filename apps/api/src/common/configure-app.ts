import { INestApplication, RequestMethod, ValidationError, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import compression from 'compression';
import helmet from 'helmet';
import { API_PREFIX, PLATFORM_PREFIX, SUBSCRIPTION_STATE_HEADER } from '@ksms/constants';
import type { Env } from '../config/env';
import { AppException } from './errors/app.exception';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { setupSwagger } from './swagger';

function flatten(errors: ValidationError[], parent = ''): { field: string; messages: string[] }[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, messages: Object.values(e.constraints) }] : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/**
 * Behind Render's proxy (FIXES F17): trust exactly the hops that append to X-Forwarded-For, so `req.ip`
 * (rate limiting, audit logs) is the real client. Trusting more would let a client spoof its IP by
 * sending its own X-Forwarded-For. Outside production nothing is trusted.
 */
export function applyTrustProxy(
  app: { set(setting: string, value: unknown): unknown },
  env: Env,
): void {
  app.set('trust proxy', env.NODE_ENV === 'production' ? env.TRUST_PROXY_HOPS : false);
}

/** Responses smaller than this are sent uncompressed. */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

/** Everything shared by the real server and the integration tests. */
export function configureApp(app: INestApplication, env: Env): void {
  const express = app as NestExpressApplication;
  applyTrustProxy(express, env);

  app.useLogger(app.get(Logger));
  app.use(
    helmet({
      // "upgrade-insecure-requests" breaks Swagger UI over plain http://localhost; production is HTTPS-only anyway.
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { 'upgrade-insecure-requests': null },
      },
    }),
  );
  // gzip large JSON (sync pages, lists, reports). Small bodies are not worth it; PDFs are already compressed.
  app.use(
    compression({
      threshold: COMPRESSION_THRESHOLD_BYTES,
      filter: (req, res) =>
        !String(res.getHeader('Content-Type') ?? '').startsWith('application/pdf') &&
        compression.filter(req, res),
    }),
  );
  const origins = [...new Set([...env.CORS_ORIGINS, ...env.PLATFORM_ADMIN_ORIGINS])];
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: false,
      // The web app reads the shop's subscription state from every answer (ADMIN_PANEL.md §2.5).
      exposedHeaders: [SUBSCRIPTION_STATE_HEADER],
    });
  }
  // Platform controllers declare their full path (admin/v1/...) and stay outside the shop prefix (ADR-001).
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [{ path: `${PLATFORM_PREFIX}/{*path}`, method: RequestMethod.ALL }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // ...and reject them
      transform: true,
      exceptionFactory: (errors) =>
        new AppException('VALIDATION_ERROR', 'Request validation failed', 400, flatten(errors)),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableShutdownHooks();
  setupSwagger(app, env);
}
