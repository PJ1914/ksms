import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/configure-app';
import { parseEnv } from '../../src/config/env';
import { PrismaService } from '../../src/database/prisma.service';

/**
 * A direct (non-pooled) connection is required because the schema is selected with a connection setting.
 * Order: TEST_DATABASE_URL, then DIRECT_URL, then DATABASE_URL.
 */
export const testDbUrl = (): string | undefined =>
  process.env.TEST_DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const MIGRATIONS = path.resolve(__dirname, '../../prisma/migrations');

export interface TestSchema {
  schema: string;
  url: string;
  drop(): Promise<void>;
}

/** Creates an isolated schema and applies every real migration to it (so triggers and constraints are exercised too). */
export async function createTestSchema(): Promise<TestSchema> {
  const url = testDbUrl();
  if (!url) throw new Error('No database URL for integration tests');
  const schema = `t_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const dirs = fs
      .readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) {
      await client.query(fs.readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }

  return {
    schema,
    url,
    drop: async () => {
      const c = new Client({ connectionString: url });
      await c.connect();
      try {
        await c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await c.end();
      }
    },
  };
}

export interface IntegrationApp {
  app: INestApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  close(): Promise<void>;
}

/** Boots the REAL application (no mocks) against the given schema. */
export async function createIntegrationApp(
  db: TestSchema,
  overrides: Record<string, string> = {},
): Promise<IntegrationApp> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: db.url,
    DATABASE_SCHEMA: db.schema,
    JWT_ACCESS_SECRET: 'integration-secret-integration-secret-12345',
    THROTTLE_LIMIT: '100000',
    AUTH_THROTTLE_LIMIT: '100000',
    RECONCILE_THROTTLE_LIMIT: '100000',
    RECONCILE_CACHE_SECONDS: '0',
    PLATFORM_JWT_SECRET: 'integration-platform-secret-integration-platform-secret-1',
    PLATFORM_MFA_KEY: Buffer.alloc(32, 3).toString('base64'),
    PLATFORM_AUTH_THROTTLE_LIMIT: '100000',
    ...overrides,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app, parseEnv());
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

let nextPhone = 100_000_000 + Math.floor(Math.random() * 500_000_000);
/** Unique valid Indian mobile numbers (start with 9, 10 digits) for test users. */
export const uniquePhone = (): string => `9${String(nextPhone++).padStart(9, '0')}`;
