import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { BRANCH_HEADER } from '@ksms/constants';
import type { Env } from '../config/env';

export const SWAGGER_PATH = 'api/docs';

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

  SwaggerModule.setup(SWAGGER_PATH, app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
  });
}
