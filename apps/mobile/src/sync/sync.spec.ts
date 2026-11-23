import { ApiError } from '@ksms/api-client';
import type { Cart } from '@ksms/validation';
import { BASE_BACKOFF_MS, MAX_BACKOFF_MS, classifyOutboxError, computeBackoffMs } from './backoff';
import {
  clearAllCache,
  clearDraftBill,
  discardOutboxItem,
  draftScopeKey,
  enqueueHeldBill,
  ensureCacheOwner,
  getCacheStats,
  getCachedProductByBarcode,
  getCachedProductDetail,
  listCachedCategories,
  listCachedUnits,
  listLocalHeldBills,
  listOutboxItems,
  loadDraftBill,
  markOutboxSending,
  ownerKeyFor,
  retryOutboxItem,
  saveDraftBill,
  searchCachedCustomers,
  searchCachedProducts,
} from './cache-store';
import { initSyncSchema, type SqlDb, type SqlParam } from './db';
import { flushHeldBillOutbox, pullReadCache, type SyncTransport } from './sync-engine';
import type { SyncCategory, SyncCustomer, SyncProduct, SyncUnit } from './types';

interface NodeSqliteStatement {
  run(...params: SqlParam[]): unknown;
  get(...params: SqlParam[]): unknown;
  all(...params: SqlParam[]): unknown[];
}
interface NodeSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
}

declare const require: (id: string) => unknown;

/** Real in-memory SQLite (`node:sqlite`, built into Node 24) wrapped in the app's `SqlDb` contract. */
function createMemorySqliteDb(): SqlDb {
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => NodeSqliteDb;
  };
  const raw = new DatabaseSync(':memory:');
  return {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, params: SqlParam[] = []) => {
      raw.prepare(sql).run(...params);
    },
    getFirstAsync: async <T>(sql: string, params: SqlParam[] = []) => {
      const row = raw.prepare(sql).get(...params);
      return (row as T | undefined) ?? null;
    },
    getAllAsync: async <T>(sql: string, params: SqlParam[] = []) => {
      return raw.prepare(sql).all(...params) as T[];
    },
    withTransactionAsync: async <T>(fn: () => Promise<T>) => {
      raw.exec('BEGIN');
      try {
        const res = await fn();
        raw.exec('COMMIT');
        return res;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

const sampleUnit = (id: string, code: string): SyncUnit => ({
  id,
  code,
  name: code === 'KG' ? 'Kilogram' : 'Piece',
  dimension: code === 'KG' ? 'WEIGHT' : 'COUNT',
  isPackaging: false,
  standardFactor: '1.000000',
});

const sampleCategory = (
  id: string,
  name: string,
  deletedAt: string | null = null,
): SyncCategory => ({
  id,
  parentId: null,
  name,
  sortOrder: 0,
  isActive: true,
  updatedAt: '2026-11-23T10:00:00.000Z',
  deletedAt,
});

const sampleProduct = (
  id: string,
  name: string,
  barcode: string,
  deletedAt: string | null = null,
): SyncProduct => ({
  id,
  sku: `SKU-${id}`,
  name,
  localName: null,
  type: 'WEIGHT',
  status: 'ACTIVE',
  baseUnit: { id: 'u-kg', code: 'KG', name: 'Kilogram' },
  category: { id: 'c-1', name: 'Grains' },
  primaryBarcode: barcode,
  basePrice: '65.00',
  mrp: '70.00',
  minStockLevel: '5.000',
  minSaleIncrement: null,
  allowFractional: true,
  trackBatch: false,
  trackExpiry: false,
  isTaxable: false,
  hsnCode: null,
  gstRatePercent: null,
  taxMode: null,
  version: 1,
  updatedAt: '2026-11-23T10:00:00.000Z',
  deletedAt,
  conversions: [
    {
      unitId: 'u-kg',
      unitCode: 'KG',
      unitName: 'Kilogram',
      isBase: true,
      factorToBase: '1.000000',
      isPurchaseUnit: true,
      isSaleUnit: true,
    },
  ],
  prices: [
    {
      id: `pr-${id}`,
      unitId: 'u-kg',
      unitCode: 'KG',
      quantity: '1.000',
      price: '65.00',
      isActive: true,
    },
  ],
  barcodes: [{ id: `bc-${id}`, barcode, unitId: 'u-kg' }],
});

const sampleCustomer = (
  id: string,
  name: string,
  balance: string,
  deletedAt: string | null = null,
): SyncCustomer => ({
  id,
  name,
  phone: '9876543210',
  email: null,
  gstin: null,
  stateCode: null,
  addressLine: null,
  creditLimit: '5000.00',
  balance,
  isActive: true,
  version: 1,
  updatedAt: '2026-11-23T10:00:00.000Z',
  deletedAt,
});

describe('mobile sync backoff and error classification', () => {
  it('computes exponential backoff with jitter and caps at 15 minutes', () => {
    // random() = 0.5 => jitter factor = 1.0 (exact exponential value)
    expect(computeBackoffMs(1, () => 0.5)).toBe(BASE_BACKOFF_MS);
    expect(computeBackoffMs(2, () => 0.5)).toBe(BASE_BACKOFF_MS * 2);
    expect(computeBackoffMs(3, () => 0.5)).toBe(BASE_BACKOFF_MS * 4);
    expect(computeBackoffMs(20, () => 0.5)).toBe(MAX_BACKOFF_MS);
    expect(computeBackoffMs(20, () => 1.0)).toBe(MAX_BACKOFF_MS);
    expect(computeBackoffMs(1, () => 0)).toBe(BASE_BACKOFF_MS);
  });

  it('classifies network/5xx/429 as retryable, 409 as conflict and 4xx as permanent', () => {
    expect(classifyOutboxError(new TypeError('Network request failed')).kind).toBe('retryable');
    expect(classifyOutboxError(new ApiError(503, 'DATABASE_UNAVAILABLE', 'Down')).kind).toBe(
      'retryable',
    );
    expect(classifyOutboxError(new ApiError(429, 'RATE_LIMITED', 'Slow down')).kind).toBe(
      'retryable',
    );
    expect(classifyOutboxError(new ApiError(409, 'CONFLICT', 'Conflict')).kind).toBe('conflict');
    expect(classifyOutboxError(new ApiError(422, 'VALIDATION_ERROR', 'Bad payload')).kind).toBe(
      'permanent',
    );
    expect(classifyOutboxError(new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Missing')).kind).toBe(
      'permanent',
    );
  });
});

describe('mobile SQLite read cache, delta sync, soft deletes and cache isolation', () => {
  it('pulls paged feeds, persists watermarks, evicts soft-deleted records and serves offline lookups', async () => {
    const db = createMemorySqliteDb();
    await initSyncSchema(db);

    const seenProductSince: (string | undefined)[] = [];
    let pass = 1;

    const transport: SyncTransport = {
      fetchUnits: async () => ({
        data: [sampleUnit('u-kg', 'KG'), sampleUnit('u-pcs', 'PCS')],
        meta: {
          limit: 200,
          hasMore: false,
          nextCursor: null,
          serverTime: '2026-11-23T10:00:00.000Z',
        },
      }),
      fetchCategories: async () => ({
        data:
          pass === 1
            ? [sampleCategory('c-1', 'Grains'), sampleCategory('c-2', 'Spices')]
            : [sampleCategory('c-2', 'Spices', '2026-11-23T10:05:00.000Z')],
        meta: {
          limit: 200,
          hasMore: false,
          nextCursor: null,
          serverTime: pass === 1 ? '2026-11-23T10:01:00.000Z' : '2026-11-23T10:06:00.000Z',
        },
      }),
      fetchProducts: async ({ updatedSince, cursor }) => {
        seenProductSince.push(updatedSince);
        if (pass === 1 && !cursor) {
          return {
            data: [sampleProduct('p-1', 'Basmati Rice', '8901')],
            meta: {
              limit: 1,
              hasMore: true,
              nextCursor: 'cursor-page-2',
              serverTime: '2026-11-23T10:01:00.000Z',
            },
          };
        }
        if (pass === 1 && cursor === 'cursor-page-2') {
          return {
            data: [sampleProduct('p-2', 'Toor Dal', '8902')],
            meta: {
              limit: 1,
              hasMore: false,
              nextCursor: null,
              serverTime: '2026-11-23T10:01:05.000Z',
            },
          };
        }
        // Pass 2: soft-delete p-2
        return {
          data: [sampleProduct('p-2', 'Toor Dal', '8902', '2026-11-23T10:05:00.000Z')],
          meta: {
            limit: 200,
            hasMore: false,
            nextCursor: null,
            serverTime: '2026-11-23T10:06:00.000Z',
          },
        };
      },
      fetchCustomers: async () => ({
        data:
          pass === 1
            ? [
                sampleCustomer('cu-1', 'Suresh', '120.50'),
                sampleCustomer('cu-2', 'Mahesh', '450.75'),
                sampleCustomer('cu-3', 'Clear User', '0.00'),
              ]
            : [sampleCustomer('cu-3', 'Clear User', '0.00', '2026-11-23T10:05:00.000Z')],
        meta: {
          limit: 200,
          hasMore: false,
          nextCursor: null,
          serverTime: pass === 1 ? '2026-11-23T10:01:00.000Z' : '2026-11-23T10:06:00.000Z',
        },
      }),
      uploadHeldBill: async () => ({ id: 'unused' }),
    };

    // Pass 1: full multi-page pull
    const first = await pullReadCache(db, transport, { products: true, customers: true });
    expect(first.units).toBe(2);
    expect(first.categories).toBe(2);
    expect(first.products).toBe(2);
    expect(first.customers).toBe(3);

    expect(await listCachedUnits(db)).toHaveLength(2);
    expect(await listCachedCategories(db)).toHaveLength(2);
    expect((await searchCachedProducts(db, 'rice')).map((p) => p.id)).toEqual(['p-1']);
    expect((await getCachedProductByBarcode(db, '8902'))?.id).toBe('p-2');
    expect((await getCachedProductDetail(db, 'p-1'))?.basePrice).toBe('65.00');

    // Decimal-safe owes filter & descending balance sort
    const owing = await searchCachedCustomers(db, { owes: true });
    expect(owing.map((c) => c.id)).toEqual(['cu-2', 'cu-1']);

    // Pass 2: incremental delta passes page 1's serverTime watermark and removes soft-deleted rows
    pass = 2;
    await pullReadCache(db, transport, { products: true, customers: true });
    expect(seenProductSince).toEqual([undefined, undefined, '2026-11-23T10:01:00.000Z']);

    expect((await listCachedCategories(db)).map((c) => c.id)).toEqual(['c-1']);
    expect((await searchCachedProducts(db, '')).map((p) => p.id)).toEqual(['p-1']);
    expect(await getCachedProductByBarcode(db, '8902')).toBeNull();
    expect((await searchCachedCustomers(db)).map((c) => c.id)).toEqual(['cu-2', 'cu-1']);
  });

  it('clears all cached data, drafts and outbox on logout and when another user or shop signs in', async () => {
    const db = createMemorySqliteDb();
    await initSyncSchema(db);

    const ownerA = ownerKeyFor('org-1', 'user-1');
    expect(await ensureCacheOwner(db, ownerA)).toEqual({ cleared: false });

    const cart: Cart = {
      lines: [
        {
          key: 'l1',
          productId: 'p-1',
          name: 'Rice',
          unitId: 'u-kg',
          unitCode: 'KG',
          quantity: '2',
          discount: '0',
          unitPrice: '',
        },
      ],
      customerId: null,
      customerName: null,
      billDiscount: '0',
      heldBillId: null,
    };
    const scope = draftScopeKey('org-1', 'user-1', 'branch-1');
    await saveDraftBill(db, scope, cart);
    await enqueueHeldBill(db, {
      localId: 'local-1',
      operationId: 'op-1',
      branchId: 'branch-1',
      label: 'Walk-in',
      payload: { lines: cart.lines },
    });

    // Same user & shop -> preserved
    expect(await ensureCacheOwner(db, ownerA)).toEqual({ cleared: false });
    expect(await loadDraftBill(db, scope)).not.toBeNull();
    expect(await listLocalHeldBills(db, 'branch-1')).toHaveLength(1);

    // Different user in same shop -> wiped completely
    const ownerB = ownerKeyFor('org-1', 'user-2');
    expect(await ensureCacheOwner(db, ownerB)).toEqual({ cleared: true });
    expect(await loadDraftBill(db, scope)).toBeNull();
    expect(await listLocalHeldBills(db, 'branch-1')).toHaveLength(0);
    expect(await listOutboxItems(db, true)).toHaveLength(0);

    // Different shop -> wiped completely
    await enqueueHeldBill(db, {
      localId: 'local-2',
      operationId: 'op-2',
      branchId: 'branch-1',
      payload: { lines: [] },
    });
    const ownerOtherShop = ownerKeyFor('org-2', 'user-2');
    expect(await ensureCacheOwner(db, ownerOtherShop)).toEqual({ cleared: true });
    expect(await listOutboxItems(db, true)).toHaveLength(0);

    // Explicit logout clear
    await saveDraftBill(db, draftScopeKey('org-2', 'user-2', 'b2'), cart);
    await clearAllCache(db);
    expect(await loadDraftBill(db, draftScopeKey('org-2', 'user-2', 'b2'))).toBeNull();
    expect((await getCacheStats(db)).pendingOutbox).toBe(0);
  });

  it('persists draft bills locally and removes the row when cleared or emptied', async () => {
    const db = createMemorySqliteDb();
    await initSyncSchema(db);
    const scope = draftScopeKey('org-1', 'user-1', 'branch-1');

    const cart: Cart = {
      lines: [
        {
          key: 'k1',
          productId: 'p-1',
          name: 'Sugar',
          unitId: 'u-kg',
          unitCode: 'KG',
          quantity: '1.5',
          discount: '0',
          unitPrice: '',
        },
      ],
      customerId: 'cu-1',
      customerName: 'Suresh',
      billDiscount: '5',
      heldBillId: null,
    };
    await saveDraftBill(db, scope, cart);
    expect(await loadDraftBill(db, scope)).toEqual(cart);

    // Saving an empty cart cleans up the row
    await saveDraftBill(db, scope, {
      lines: [],
      customerId: null,
      customerName: null,
      billDiscount: '0',
      heldBillId: null,
    });
    expect(await loadDraftBill(db, scope)).toBeNull();

    // Explicit clearDraftBill works
    await saveDraftBill(db, scope, cart);
    await clearDraftBill(db, scope);
    expect(await loadDraftBill(db, scope)).toBeNull();
  });
});

describe('mobile held-bill outbox: idempotency, backoff, retry and discard', () => {
  it('uploads held bills with stable Idempotency-Key, recovers stuck SENDING rows and creates zero duplicates', async () => {
    const db = createMemorySqliteDb();
    await initSyncSchema(db);

    await enqueueHeldBill(db, {
      localId: 'local-hb-1',
      operationId: '11111111-1111-4111-8111-111111111111',
      branchId: 'branch-A',
      label: 'Ramesh',
      customerId: 'cu-1',
      payload: { lines: [], customerId: 'cu-1', customerName: 'Ramesh', billDiscount: '0' },
      nowIso: '2026-11-23T10:00:00.000Z',
    });

    // Simulate a crash right after sending, leaving the row in SENDING
    await markOutboxSending(db, '11111111-1111-4111-8111-111111111111', '2026-11-23T10:00:01.000Z');

    const receivedCalls: { branchId: string; key: string }[] = [];
    const serverStore = new Map<string, string>();

    const transport: SyncTransport = {
      fetchProducts: async () => ({
        data: [],
        meta: { limit: 200, hasMore: false, nextCursor: null, serverTime: '' },
      }),
      fetchCategories: async () => ({
        data: [],
        meta: { limit: 200, hasMore: false, nextCursor: null, serverTime: '' },
      }),
      fetchUnits: async () => ({
        data: [],
        meta: { limit: 200, hasMore: false, nextCursor: null, serverTime: '' },
      }),
      fetchCustomers: async () => ({
        data: [],
        meta: { limit: 200, hasMore: false, nextCursor: null, serverTime: '' },
      }),
      uploadHeldBill: async (branchId, key) => {
        receivedCalls.push({ branchId, key });
        const existing = serverStore.get(key);
        if (existing) return { id: existing };
        const id = `server-hb-${serverStore.size + 1}`;
        serverStore.set(key, id);
        return { id };
      },
    };

    const first = await flushHeldBillOutbox(db, transport, {
      now: () => new Date('2026-11-23T10:00:05.000Z'),
    });
    expect(first).toEqual({ sent: 1, retried: 0, failed: 0, conflicts: 0 });
    expect(receivedCalls).toEqual([
      { branchId: 'branch-A', key: '11111111-1111-4111-8111-111111111111' },
    ]);

    // A second flush sends nothing (DONE items are not re-uploaded)
    const second = await flushHeldBillOutbox(db, transport, {
      now: () => new Date('2026-11-23T10:00:10.000Z'),
    });
    expect(second).toEqual({ sent: 0, retried: 0, failed: 0, conflicts: 0 });
    expect(receivedCalls).toHaveLength(1);

    const locals = await listLocalHeldBills(db, 'branch-A');
    expect(locals[0]!.serverId).toBe('server-hb-1');
    expect(locals[0]!.syncStatus).toBe('SYNCED');
  });

  it('applies exponential backoff, marks exhausted/4xx/409 failures, and supports Retry and Discard', async () => {
    const db = createMemorySqliteDb();
    await initSyncSchema(db);

    const opRetry = '22222222-2222-4222-8222-222222222222';
    const opBad = '33333333-3333-4333-8333-333333333333';
    const opConflict = '44444444-4444-4444-8444-444444444444';

    await enqueueHeldBill(db, {
      localId: 'l-retry',
      operationId: opRetry,
      branchId: 'b1',
      label: 'Offline Bill',
      payload: { lines: [] },
      nowIso: '2026-11-23T10:00:00.000Z',
    });
    await enqueueHeldBill(db, {
      localId: 'l-bad',
      operationId: opBad,
      branchId: 'b1',
      label: 'Deleted Customer Bill',
      payload: { lines: [] },
      nowIso: '2026-11-23T10:00:01.000Z',
    });
    await enqueueHeldBill(db, {
      localId: 'l-conflict',
      operationId: opConflict,
      branchId: 'b1',
      label: 'Conflict Bill',
      payload: { lines: [] },
      nowIso: '2026-11-23T10:00:02.000Z',
    });

    let allowRetrySuccess = false;
    let clockMs = Date.parse('2026-11-23T10:00:10.000Z');
    const seenKeys: string[] = [];

    const transport: SyncTransport = {
      fetchProducts: async () => ({
        data: [],
        meta: { limit: 200, hasMore: false, nextCursor: null, serverTime: '' },
      }),
      fetchCategories: async () => ({
        data: [],
        meta: { limit: 200, hasMore: false, nextCursor: null, serverTime: '' },
      }),
      fetchUnits: async () => ({
        data: [],
        meta: { limit: 200, hasMore: false, nextCursor: null, serverTime: '' },
      }),
      fetchCustomers: async () => ({
        data: [],
        meta: { limit: 200, hasMore: false, nextCursor: null, serverTime: '' },
      }),
      uploadHeldBill: async (_branchId, key) => {
        seenKeys.push(key);
        if (key === opRetry) {
          if (!allowRetrySuccess) throw new TypeError('Offline');
          return { id: 'srv-ok' };
        }
        if (key === opBad) {
          throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
        }
        throw new ApiError(409, 'CONFLICT', 'Already exists');
      },
    };

    const res1 = await flushHeldBillOutbox(db, transport, {
      now: () => new Date(clockMs),
      random: () => 0.5,
      maxRetries: 2,
    });
    expect(res1).toEqual({ sent: 0, retried: 1, failed: 1, conflicts: 1 });

    // 1 second later: opRetry is still in backoff (2000ms), so flush does nothing
    clockMs += 1_000;
    const resEarly = await flushHeldBillOutbox(db, transport, {
      now: () => new Date(clockMs),
      random: () => 0.5,
      maxRetries: 2,
    });
    expect(resEarly).toEqual({ sent: 0, retried: 0, failed: 0, conflicts: 0 });

    // After backoff passes, second failure exhausts maxRetries=2 -> FAILED
    clockMs += 2_000;
    const resExhausted = await flushHeldBillOutbox(db, transport, {
      now: () => new Date(clockMs),
      random: () => 0.5,
      maxRetries: 2,
    });
    expect(resExhausted).toEqual({ sent: 0, retried: 0, failed: 1, conflicts: 0 });
    expect((await getCacheStats(db)).failedOutbox).toBe(3);

    // User taps Retry on opRetry once back online -> reuses exact same Idempotency-Key and succeeds
    allowRetrySuccess = true;
    await retryOutboxItem(db, opRetry, new Date(clockMs).toISOString());
    const resRecovered = await flushHeldBillOutbox(db, transport, {
      now: () => new Date(clockMs + 1_000),
    });
    expect(resRecovered).toEqual({ sent: 1, retried: 0, failed: 0, conflicts: 0 });
    expect(seenKeys.filter((k) => k === opRetry)).toHaveLength(3);

    // User taps Discard on opBad and opConflict -> removed from outbox AND local_held_bills
    await discardOutboxItem(db, opBad);
    await discardOutboxItem(db, opConflict);
    expect(await listOutboxItems(db, false)).toHaveLength(0);
    expect((await listLocalHeldBills(db, 'b1')).map((b) => b.localId)).toEqual(['l-retry']);
  });
});
