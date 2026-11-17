import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { API_PREFIX } from '@ksms/constants';
import { AppModule } from './app.module';
import { parseEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = parseEnv(); // fail fast on bad configuration
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`API listening on port ${env.PORT} (/${API_PREFIX})`);
}

void bootstrap();
