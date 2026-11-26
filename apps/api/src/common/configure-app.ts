import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import compression from 'compression';
import helmet from 'helmet';
import { API_PREFIX } from '@ksms/constants';
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

/** Responses smaller than this are sent uncompressed. */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

/** Everything shared by the real server and the integration tests. */
export function configureApp(app: INestApplication, env: Env): void {
  const express = app as NestExpressApplication;
  // Behind Cloud Run's load balancer: use the real client IP for rate limiting.
  if (env.NODE_ENV === 'production') express.set('trust proxy', 1);

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
  if (env.CORS_ORIGINS.length > 0) {
    app.enableCors({ origin: env.CORS_ORIGINS, credentials: false });
  }
  app.setGlobalPrefix(API_PREFIX);
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
