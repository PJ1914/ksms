import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX } from '@ksms/constants';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { parseEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = parseEnv(); // fail fast on bad configuration
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app, env);
  await app.listen(env.PORT);
  app.get(Logger).log(`API listening on port ${env.PORT} (/${API_PREFIX}), docs at /api/docs`);
}

void bootstrap();
