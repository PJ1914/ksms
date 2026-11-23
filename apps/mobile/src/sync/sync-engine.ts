import { MAX_OUTBOX_RETRIES, classifyOutboxError, computeBackoffMs } from './backoff';
import {
  LAST_SYNC_META_KEY,
  applyCategoriesBatch,
  applyCustomersBatch,
  applyProductsBatch,
  applyUnitsBatch,
  feedSinceKey,
  getMeta,
  listDueOutboxItems,
  markOutboxDone,
  markOutboxRetryScheduled,
  markOutboxSending,
  markOutboxTerminal,
  recoverStuckSending,
  setMeta,
} from './cache-store';
import type { SqlDb } from './db';
import type {
  HeldBillUploadPayload,
  SyncCategory,
  SyncCustomer,
  SyncFeedPage,
  SyncProduct,
  SyncUnit,
} from './types';

export interface SyncTransport {
  fetchProducts(params: {
    updatedSince?: string;
    cursor?: string;
    limit?: number;
  }): Promise<SyncFeedPage<SyncProduct>>;
  fetchCategories(params: {
    updatedSince?: string;
    cursor?: string;
    limit?: number;
  }): Promise<SyncFeedPage<SyncCategory>>;
  fetchUnits(params: { cursor?: string; limit?: number }): Promise<SyncFeedPage<SyncUnit>>;
  fetchCustomers(params: {
    updatedSince?: string;
    cursor?: string;
    limit?: number;
  }): Promise<SyncFeedPage<SyncCustomer>>;
  uploadHeldBill(
    branchId: string,
    idempotencyKey: string,
    body: HeldBillUploadPayload,
  ): Promise<{ id: string }>;
}

export interface PullSummary {
  units: number;
  categories: number;
  products: number;
  customers: number;
  syncedAt: string;
}

export interface FlushSummary {
  sent: number;
  retried: number;
  failed: number;
  conflicts: number;
}

const PAGE_LIMIT = 200;

/**
 * Pulls delta feeds into the local SQLite read cache using saved `updated_since` watermarks
 * and composite `(updated_at, id)` cursors.
 */
export async function pullReadCache(
  db: SqlDb,
  transport: SyncTransport,
  perms: { products: boolean; customers: boolean },
  now: () => Date = () => new Date(),
): Promise<PullSummary> {
  const counts = { units: 0, categories: 0, products: 0, customers: 0 };

  if (perms.products) {
    counts.units = await pullCursorOnly(
      (cursor) => transport.fetchUnits({ cursor, limit: PAGE_LIMIT }),
      (batch) => applyUnitsBatch(db, batch),
    );
    counts.categories = await pullDelta(
      db,
      'categories',
      (updatedSince, cursor) =>
        transport.fetchCategories({ updatedSince, cursor, limit: PAGE_LIMIT }),
      (batch) => applyCategoriesBatch(db, batch),
    );
    counts.products = await pullDelta(
      db,
      'products',
      (updatedSince, cursor) =>
        transport.fetchProducts({ updatedSince, cursor, limit: PAGE_LIMIT }),
      (batch) => applyProductsBatch(db, batch),
    );
  }

  if (perms.customers) {
    counts.customers = await pullDelta(
      db,
      'customers',
      (updatedSince, cursor) =>
        transport.fetchCustomers({ updatedSince, cursor, limit: PAGE_LIMIT }),
      (batch) => applyCustomersBatch(db, batch),
    );
  }

  const syncedAt = now().toISOString();
  await setMeta(db, LAST_SYNC_META_KEY, syncedAt);
  return { ...counts, syncedAt };
}

/**
 * Uploads due held-bill outbox items sequentially with `Idempotency-Key = operationId`,
 * exponential backoff on retryable errors, and terminal FAILED/CONFLICT states on 4xx/409.
 */
export async function flushHeldBillOutbox(
  db: SqlDb,
  transport: SyncTransport,
  opts: {
    now?: () => Date;
    random?: () => number;
    maxRetries?: number;
  } = {},
): Promise<FlushSummary> {
  const now = opts.now ?? (() => new Date());
  const random = opts.random ?? Math.random;
  const maxRetries = opts.maxRetries ?? MAX_OUTBOX_RETRIES;

  await recoverStuckSending(db, now().toISOString());
  const due = await listDueOutboxItems(db, now().toISOString());

  const summary: FlushSummary = { sent: 0, retried: 0, failed: 0, conflicts: 0 };

  for (const item of due) {
    // Defense-in-depth: Phase 14 outbox ONLY uploads held bills.
    if (item.operationType !== 'HELD_BILL_UPLOAD') continue;

    await markOutboxSending(db, item.operationId, now().toISOString());
    try {
      const created = await transport.uploadHeldBill(item.branchId, item.operationId, item.payload);
      await markOutboxDone(db, item.operationId, item.entityId, created.id, now().toISOString());
      summary.sent += 1;
    } catch (err) {
      const failureTime = now();
      const failureIso = failureTime.toISOString();
      const classified = classifyOutboxError(err);

      if (classified.kind === 'conflict') {
        await markOutboxTerminal(
          db,
          item.operationId,
          item.entityId,
          'CONFLICT',
          item.retryCount + 1,
          classified.message,
          failureIso,
        );
        summary.conflicts += 1;
      } else if (classified.kind === 'permanent') {
        await markOutboxTerminal(
          db,
          item.operationId,
          item.entityId,
          'FAILED',
          item.retryCount + 1,
          classified.message,
          failureIso,
        );
        summary.failed += 1;
      } else {
        const nextRetryCount = item.retryCount + 1;
        if (nextRetryCount >= maxRetries) {
          await markOutboxTerminal(
            db,
            item.operationId,
            item.entityId,
            'FAILED',
            nextRetryCount,
            classified.message,
            failureIso,
          );
          summary.failed += 1;
        } else {
          const delayMs = computeBackoffMs(nextRetryCount, random);
          const nextRetryAt = new Date(failureTime.getTime() + delayMs).toISOString();
          await markOutboxRetryScheduled(
            db,
            item.operationId,
            nextRetryCount,
            nextRetryAt,
            classified.message,
            failureIso,
          );
          summary.retried += 1;
        }
      }
    }
  }

  return summary;
}

async function pullCursorOnly<T>(
  fetchPage: (cursor?: string) => Promise<SyncFeedPage<T>>,
  apply: (batch: T[]) => Promise<void>,
): Promise<number> {
  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    const page = await fetchPage(cursor);
    await apply(page.data);
    total += page.data.length;
    if (!page.meta.hasMore || !page.meta.nextCursor) break;
    cursor = page.meta.nextCursor;
  }
  return total;
}

async function pullDelta<T>(
  db: SqlDb,
  feed: 'products' | 'categories' | 'customers',
  fetchPage: (updatedSince?: string, cursor?: string) => Promise<SyncFeedPage<T>>,
  apply: (batch: T[]) => Promise<void>,
): Promise<number> {
  const key = feedSinceKey(feed);
  const updatedSince = (await getMeta(db, key)) ?? undefined;
  let cursor: string | undefined;
  let watermark: string | null = null;
  let total = 0;

  for (;;) {
    const page = await fetchPage(updatedSince, cursor);
    if (watermark === null) watermark = page.meta.serverTime;
    await apply(page.data);
    total += page.data.length;
    if (!page.meta.hasMore || !page.meta.nextCursor) break;
    cursor = page.meta.nextCursor;
  }

  if (watermark) {
    await setMeta(db, key, watermark);
  }
  return total;
}
