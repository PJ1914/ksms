import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { ENV, type Env } from '../config/config.module';

/** Max time to wait for a free connection/lock to start a transaction, and to complete it (ms). */
export const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 20_000 } as const;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({
      adapter: new PrismaPg(
        {
          connectionString: env.DATABASE_URL,
          // The adapter's `schema` option only qualifies Prisma's own queries; raw SQL (row locks, idempotency
          // claims) would still hit "public". Setting search_path on the connection makes BOTH use the schema.
          // DATABASE_SCHEMA is for isolated test schemas and needs a direct (non-pooled) connection.
          ...(env.DATABASE_SCHEMA ? { options: `-c search_path=${env.DATABASE_SCHEMA}` } : {}),
        },
        env.DATABASE_SCHEMA ? { schema: env.DATABASE_SCHEMA } : undefined,
      ),
      // Prisma's defaults (2 s to start, 5 s to finish) are too tight when checkouts queue behind a
      // row lock on a remote database. Found by test/integration/pooled-locking.int-spec.ts.
      transactionOptions: TRANSACTION_OPTIONS,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
