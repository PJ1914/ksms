import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { parseEnv } from './config/env';
import { RetentionModule } from './modules/retention/retention.module';
import { RetentionService } from './modules/retention/retention.service';

/**
 * Scheduled retention job (FIXES F4): `node dist/purge.js`.
 * Deletes expired idempotency keys, old sessions, old read notifications and finished sync operations,
 * prints the counts and exits non-zero on any failure so the scheduler reports it.
 */
async function main(): Promise<void> {
  parseEnv(); // fail fast on bad configuration
  const app = await NestFactory.createApplicationContext(RetentionModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const counts = await app.get(RetentionService).purge();
    console.log(JSON.stringify({ job: 'retention', ok: true, deleted: counts }));
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ job: 'retention', ok: false, error: String(err) }));
  process.exit(1);
});
