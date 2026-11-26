import { Inject, Injectable } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import { ENV, type Env } from '../../config/config.module';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';

/** Routes marked with this get the strict `reconcile` throttler (see AppModule). */
export const RECONCILE_THROTTLED = 'reconcileThrottled';
export const ReconcileThrottled = () => SetMetadata(RECONCILE_THROTTLED, true);

/** No single reconciliation statement may run longer than this. */
export const RECONCILE_STATEMENT_TIMEOUT = '10s';

/**
 * Runs the reconciliation checks (FIXES F21). They scan all history, so:
 *  - each run happens in one transaction with `SET LOCAL statement_timeout`, so a slow scan is cut off
 *    instead of loading the database;
 *  - the result is kept per shop + branch + check for RECONCILE_CACHE_SECONDS (default 5 minutes);
 *  - the routes are owner-only (`system.reconcile`) and throttled to 2 calls a minute.
 * Run them off-peak; the nightly job may call them later.
 */
@Injectable()
export class ReconciliationRunner {
  private readonly cache = new Map<string, { value: unknown; expires: number }>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run<T>(
    check: string,
    organizationId: string,
    branchId: string | null,
    work: (db: Db) => Promise<T>,
  ): Promise<T> {
    const key = `${check}:${organizationId}:${branchId ?? '*'}`;
    const ttlMs = this.env.RECONCILE_CACHE_SECONDS * 1000;
    const hit = this.cache.get(key);
    if (ttlMs > 0 && hit && hit.expires > Date.now()) return hit.value as T;

    const value = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL statement_timeout = '${RECONCILE_STATEMENT_TIMEOUT}'`,
        );
        return work(tx);
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
    if (ttlMs > 0) this.cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }
}
