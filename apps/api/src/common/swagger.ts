import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { BRANCH_HEADER, PLATFORM_PREFIX } from '@ksms/constants';
import type { Env } from '../config/env';

export const SWAGGER_PATH = 'api/docs';
/** The admin panel API has its own document (ADR-001), kept out of the shop API's. */
export const PLATFORM_SWAGGER_PATH = `${PLATFORM_PREFIX}/docs`;

export function setupSwagger(app: INestApplication, env: Env): void {
  const enabled = env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production';
  if (!enabled) return;

  const config = new DocumentBuilder()
    .setTitle('Yapaaram API')
    .setDescription(
      'Yapaaram: shop management for kirana stores. Money and quantities are decimal strings. ' +
        'Success: `{ data, meta? }`. Error: `{ error: { code, message, details?, correlationId } }`.',
    )
    .setVersion('1')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: BRANCH_HEADER, in: 'header' }, 'branch')
    .build();

  const full = SwaggerModule.createDocument(app, config);
  const isPlatformPath = (p: string) => p.startsWith(`/${PLATFORM_PREFIX}/`);
  const pick = (keep: (p: string) => boolean) =>
    Object.fromEntries(Object.entries(full.paths).filter(([p]) => keep(p)));

  SwaggerModule.setup(
    SWAGGER_PATH,
    app,
    { ...full, paths: pick((p) => !isPlatformPath(p)) },
    {
      jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    },
  );
  SwaggerModule.setup(
    PLATFORM_SWAGGER_PATH,
    app,
    {
      ...full,
      info: {
        ...full.info,
        title: 'Yapaaram Platform (admin panel) API',
        description:
          'Cross-tenant control plane for ADMIN and SUPPORT (ADR-001). Separate tokens from the shop API; ' +
          'sign-in is password + authenticator code.',
      },
      paths: pick(isPlatformPath),
    },
    { jsonDocumentUrl: `${PLATFORM_SWAGGER_PATH}-json` },
  );
}
