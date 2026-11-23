import { Decimal } from 'decimal.js';
import type { Cart } from '@ksms/validation';
import type { CustomerRow, ProductDetail, ProductRow } from '@/api/types';
import { ALL_SYNC_TABLES, type SqlDb } from './db';
import type {
  CacheStats,
  HeldBillUploadPayload,
  LocalHeldBill,
  LocalHeldBillSyncStatus,
  OutboxOperationType,
  OutboxRow,
  OutboxStatus,
  SyncCategory,
  SyncCustomer,
  SyncProduct,
  SyncUnit,
} from './types';

const OWNER_META_KEY = 'owner_key';
export const LAST_SYNC_META_KEY = 'last_sync_at';

export const ownerKeyFor = (organizationId: string, userId: string): string =>
  `${organizationId}:${userId}`;

export const draftScopeKey = (organizationId: string, userId: string, branchId: string): string =>
  `${organizationId}:${userId}:${branchId}`;

export const feedSinceKey = (feed: 'products' | 'categories' | 'customers'): string =>
  `since:${feed}`;

export async function getMeta(db: SqlDb, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_meta WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function setMeta(db: SqlDb, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [key, value]);
}

/** Wipes every local read-cache, draft, held-bill and outbox table atomically (on logout or user/shop switch). */
export async function clearAllCache(db: SqlDb): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const table of ALL_SYNC_TABLES) {
      await db.runAsync(`DELETE FROM ${table}`);
    }
  });
}

/**
 * Ensures the SQLite cache belongs to the currently signed-in `(organizationId, userId)`.
 * If another user or shop previously used this phone, wipes all local data before continuing.
 */
export async function ensureCacheOwner(db: SqlDb, ownerKey: string): Promise<{ cleared: boolean }> {
  const existing = await getMeta(db, OWNER_META_KEY);
  if (existing && existing !== ownerKey) {
    await clearAllCache(db);
    await setMeta(db, OWNER_META_KEY, ownerKey);
    return { cleared: true };
  }
  if (!existing) {
    await setMeta(db, OWNER_META_KEY, ownerKey);
  }
  return { cleared: false };
}

// ---------- delta apply ----------

export async function applyUnitsBatch(db: SqlDb, items: SyncUnit[]): Promise<void> {
  if (items.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const u of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO cached_units
         (id, code, name, dimension, is_packaging, standard_factor)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [u.id, u.code, u.name, u.dimension, u.isPackaging ? 1 : 0, u.standardFactor],
      );
    }
  });
}

export async function applyCategoriesBatch(db: SqlDb, items: SyncCategory[]): Promise<void> {
  if (items.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const c of items) {
      if (c.deletedAt !== null) {
        await db.runAsync('DELETE FROM cached_categories WHERE id = ?', [c.id]);
      } else {
        await db.runAsync(
          `INSERT OR REPLACE INTO cached_categories
           (id, parent_id, name, sort_order, is_active, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [c.id, c.parentId, c.name, c.sortOrder, c.isActive ? 1 : 0, c.updatedAt],
        );
      }
    }
  });
}

export async function applyProductsBatch(db: SqlDb, items: SyncProduct[]): Promise<void> {
  if (items.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const p of items) {
      await db.runAsync('DELETE FROM cached_product_barcodes WHERE product_id = ?', [p.id]);
      if (p.deletedAt !== null) {
        await db.runAsync('DELETE FROM cached_products WHERE id = ?', [p.id]);
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO cached_products
         (id, sku, name, local_name, category_id, status, base_unit_id, base_unit_code,
          primary_barcode, base_price, track_batch, track_expiry, version, updated_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id,
          p.sku,
          p.name,
          p.localName,
          p.category?.id ?? null,
          p.status,
          p.baseUnit.id,
          p.baseUnit.code,
          p.primaryBarcode,
          p.basePrice,
          p.trackBatch ? 1 : 0,
          p.trackExpiry ? 1 : 0,
          p.version,
          p.updatedAt,
          JSON.stringify(p),
        ],
      );
      for (const b of p.barcodes) {
        await db.runAsync(
          `INSERT OR REPLACE INTO cached_product_barcodes (barcode, product_id, unit_id)
           VALUES (?, ?, ?)`,
          [b.barcode, p.id, b.unitId ?? null],
        );
      }
    }
  });
}

export async function applyCustomersBatch(db: SqlDb, items: SyncCustomer[]): Promise<void> {
  if (items.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const c of items) {
      if (c.deletedAt !== null) {
        await db.runAsync('DELETE FROM cached_customers WHERE id = ?', [c.id]);
      } else {
        await db.runAsync(
          `INSERT OR REPLACE INTO cached_customers
           (id, name, phone, email, gstin, state_code, address_line, credit_limit, balance, is_active, version, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            c.id,
            c.name,
            c.phone,
            c.email,
            c.gstin ?? null,
            c.stateCode ?? null,
            c.addressLine,
            c.creditLimit,
            c.balance,
            c.isActive ? 1 : 0,
            c.version,
            c.updatedAt,
          ],
        );
      }
    }
  });
}

// ---------- read queries (offline fallback) ----------

export async function searchCachedProducts(
  db: SqlDb,
  q: string,
  activeOnly = true,
  categoryId?: string | null,
): Promise<ProductRow[]> {
  const term = q.trim().toLowerCase();
  const rows = await db.getAllAsync<{ payload_json: string }>(
    activeOnly
      ? `SELECT payload_json FROM cached_products WHERE status = 'ACTIVE' ORDER BY name ASC`
      : `SELECT payload_json FROM cached_products ORDER BY name ASC`,
  );
  let allowedCategories: Set<string> | null = null;
  if (categoryId) {
    const cats = await listCachedCategories(db);
    allowedCategories = new Set([categoryId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of cats) {
        if (c.parentId && allowedCategories.has(c.parentId) && !allowedCategories.has(c.id)) {
          allowedCategories.add(c.id);
          grew = true;
        }
      }
    }
  }
  const parsed = rows.map((r) => JSON.parse(r.payload_json) as SyncProduct);
  const filtered = parsed.filter((p) => {
    if (allowedCategories && (!p.category || !allowedCategories.has(p.category.id))) return false;
    if (!term) return true;
    return (
      p.name.toLowerCase().includes(term) ||
      (p.localName?.toLowerCase().includes(term) ?? false) ||
      p.sku.toLowerCase().includes(term) ||
      p.barcodes.some((b) => b.barcode.toLowerCase().includes(term))
    );
  });
  return filtered.slice(0, 100);
}

export async function getCachedProductDetail(db: SqlDb, id: string): Promise<ProductDetail | null> {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    'SELECT payload_json FROM cached_products WHERE id = ?',
    [id],
  );
  return row ? (JSON.parse(row.payload_json) as ProductDetail) : null;
}

export async function getCachedProductByBarcode(
  db: SqlDb,
  barcode: string,
): Promise<ProductDetail | null> {
  const map = await db.getFirstAsync<{ product_id: string }>(
    'SELECT product_id FROM cached_product_barcodes WHERE barcode = ?',
    [barcode],
  );
  if (!map) return null;
  return getCachedProductDetail(db, map.product_id);
}

export async function listCachedCategories(db: SqlDb): Promise<SyncCategory[]> {
  const rows = await db.getAllAsync<{
    id: string;
    parent_id: string | null;
    name: string;
    sort_order: number;
    is_active: number;
    updated_at: string;
  }>(
    'SELECT id, parent_id, name, sort_order, is_active, updated_at FROM cached_categories ORDER BY sort_order ASC, name ASC',
  );
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    sortOrder: r.sort_order,
    isActive: r.is_active === 1,
    updatedAt: r.updated_at,
    deletedAt: null,
  }));
}

export async function listCachedUnits(db: SqlDb): Promise<SyncUnit[]> {
  const rows = await db.getAllAsync<{
    id: string;
    code: string;
    name: string;
    dimension: string;
    is_packaging: number;
    standard_factor: string | null;
  }>(
    'SELECT id, code, name, dimension, is_packaging, standard_factor FROM cached_units ORDER BY code ASC',
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    dimension: r.dimension,
    isPackaging: r.is_packaging === 1,
    standardFactor: r.standard_factor,
  }));
}

export async function searchCachedCustomers(
  db: SqlDb,
  opts: { q?: string; owes?: boolean; activeOnly?: boolean } = {},
): Promise<CustomerRow[]> {
  const term = (opts.q ?? '').trim().toLowerCase();
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    phone: string | null;
    gstin: string | null;
    state_code: string | null;
    credit_limit: string | null;
    balance: string;
    is_active: number;
    version: number;
  }>(
    opts.activeOnly
      ? 'SELECT id, name, phone, gstin, state_code, credit_limit, balance, is_active, version FROM cached_customers WHERE is_active = 1 ORDER BY name ASC'
      : 'SELECT id, name, phone, gstin, state_code, credit_limit, balance, is_active, version FROM cached_customers ORDER BY name ASC',
  );
  let list: CustomerRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    gstin: r.gstin,
    stateCode: r.state_code,
    creditLimit: r.credit_limit,
    balance: r.balance,
    isActive: r.is_active === 1,
    version: r.version,
  }));
  if (opts.owes) {
    list = list
      .filter((c) => new Decimal(c.balance).gt(0))
      .sort((a, b) => new Decimal(b.balance).cmp(new Decimal(a.balance)));
  }
  if (term) {
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(term) || (c.phone?.toLowerCase().includes(term) ?? false),
    );
  }
  return list.slice(0, 100);
}

// ---------- draft bills (local SQLite only) ----------

export async function saveDraftBill(
  db: SqlDb,
  scopeKey: string,
  cart: Cart,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const isEmpty =
    cart.lines.length === 0 &&
    cart.customerId === null &&
    (cart.billDiscount === '' || cart.billDiscount === '0');
  if (isEmpty) {
    await clearDraftBill(db, scopeKey);
    return;
  }
  await db.runAsync(
    'INSERT OR REPLACE INTO draft_bills (scope_key, payload_json, updated_at) VALUES (?, ?, ?)',
    [scopeKey, JSON.stringify(cart), nowIso],
  );
}

export async function loadDraftBill(db: SqlDb, scopeKey: string): Promise<Cart | null> {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    'SELECT payload_json FROM draft_bills WHERE scope_key = ?',
    [scopeKey],
  );
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as Cart;
  } catch {
    return null;
  }
}

export async function clearDraftBill(db: SqlDb, scopeKey: string): Promise<void> {
  await db.runAsync('DELETE FROM draft_bills WHERE scope_key = ?', [scopeKey]);
}

// ---------- local held bills + outbox (HELD_BILL_UPLOAD only) ----------

export async function enqueueHeldBill(
  db: SqlDb,
  input: {
    localId: string;
    operationId: string;
    branchId: string;
    label?: string;
    customerId?: string;
    payload: Record<string, unknown>;
    nowIso?: string;
  },
): Promise<LocalHeldBill> {
  const now = input.nowIso ?? new Date().toISOString();
  const outboxPayload: HeldBillUploadPayload = {
    ...(input.label ? { label: input.label } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
    payload: input.payload,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_held_bills
       (local_id, branch_id, server_id, label, customer_id, payload_json, sync_status, outbox_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'PENDING', ?, ?, ?)`,
      [
        input.localId,
        input.branchId,
        input.label ?? null,
        input.customerId ?? null,
        JSON.stringify(input.payload),
        input.operationId,
        now,
        now,
      ],
    );
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_outbox
       (operation_id, branch_id, operation_type, entity_id, payload_json, status, retry_count, next_retry_at, last_error, created_at, updated_at)
       VALUES (?, ?, 'HELD_BILL_UPLOAD', ?, ?, 'PENDING', 0, NULL, NULL, ?, ?)`,
      [input.operationId, input.branchId, input.localId, JSON.stringify(outboxPayload), now, now],
    );
  });

  return {
    localId: input.localId,
    branchId: input.branchId,
    serverId: null,
    label: input.label ?? null,
    customerId: input.customerId ?? null,
    payload: input.payload,
    syncStatus: 'PENDING',
    outboxId: input.operationId,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listLocalHeldBills(db: SqlDb, branchId: string): Promise<LocalHeldBill[]> {
  const rows = await db.getAllAsync<{
    local_id: string;
    branch_id: string;
    server_id: string | null;
    label: string | null;
    customer_id: string | null;
    payload_json: string;
    sync_status: LocalHeldBillSyncStatus;
    outbox_id: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT local_id, branch_id, server_id, label, customer_id, payload_json, sync_status, outbox_id, created_at, updated_at
     FROM local_held_bills WHERE branch_id = ? ORDER BY created_at DESC`,
    [branchId],
  );
  return rows.map((r) => ({
    localId: r.local_id,
    branchId: r.branch_id,
    serverId: r.server_id,
    label: r.label,
    customerId: r.customer_id,
    payload: JSON.parse(r.payload_json) as unknown,
    syncStatus: r.sync_status,
    outboxId: r.outbox_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function removeLocalHeldBill(db: SqlDb, localId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ outbox_id: string | null }>(
      'SELECT outbox_id FROM local_held_bills WHERE local_id = ?',
      [localId],
    );
    await db.runAsync('DELETE FROM local_held_bills WHERE local_id = ?', [localId]);
    if (row?.outbox_id) {
      await db.runAsync("DELETE FROM sync_outbox WHERE operation_id = ? AND status != 'DONE'", [
        row.outbox_id,
      ]);
    }
  });
}

export async function removeLocalHeldBillByServerId(db: SqlDb, serverId: string): Promise<void> {
  await db.runAsync('DELETE FROM local_held_bills WHERE server_id = ?', [serverId]);
}

export async function listOutboxItems(db: SqlDb, includeDone = false): Promise<OutboxRow[]> {
  const rows = await db.getAllAsync<{
    operation_id: string;
    branch_id: string;
    operation_type: OutboxOperationType;
    entity_id: string;
    payload_json: string;
    status: OutboxStatus;
    retry_count: number;
    next_retry_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>(
    includeDone
      ? 'SELECT * FROM sync_outbox ORDER BY created_at ASC'
      : "SELECT * FROM sync_outbox WHERE status != 'DONE' ORDER BY created_at ASC",
  );
  return rows.map(mapOutboxRow);
}

export async function listDueOutboxItems(db: SqlDb, nowIso: string): Promise<OutboxRow[]> {
  const rows = await db.getAllAsync<{
    operation_id: string;
    branch_id: string;
    operation_type: OutboxOperationType;
    entity_id: string;
    payload_json: string;
    status: OutboxStatus;
    retry_count: number;
    next_retry_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT * FROM sync_outbox
     WHERE status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at ASC`,
    [nowIso],
  );
  return rows.map(mapOutboxRow);
}

export async function recoverStuckSending(
  db: SqlDb,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  await db.runAsync(
    `UPDATE sync_outbox SET status = 'PENDING', updated_at = ? WHERE status = 'SENDING'`,
    [nowIso],
  );
}

export async function markOutboxSending(
  db: SqlDb,
  operationId: string,
  nowIso: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE sync_outbox SET status = 'SENDING', updated_at = ? WHERE operation_id = ?`,
    [nowIso, operationId],
  );
}

export async function markOutboxDone(
  db: SqlDb,
  operationId: string,
  localHeldBillId: string,
  serverId: string,
  nowIso: string,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE sync_outbox
       SET status = 'DONE', next_retry_at = NULL, last_error = NULL, updated_at = ?
       WHERE operation_id = ?`,
      [nowIso, operationId],
    );
    await db.runAsync(
      `UPDATE local_held_bills
       SET server_id = ?, sync_status = 'SYNCED', updated_at = ?
       WHERE local_id = ?`,
      [serverId, nowIso, localHeldBillId],
    );
  });
}

export async function markOutboxRetryScheduled(
  db: SqlDb,
  operationId: string,
  retryCount: number,
  nextRetryAt: string,
  lastError: string,
  nowIso: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE sync_outbox
     SET status = 'PENDING', retry_count = ?, next_retry_at = ?, last_error = ?, updated_at = ?
     WHERE operation_id = ?`,
    [retryCount, nextRetryAt, lastError, nowIso, operationId],
  );
}

export async function markOutboxTerminal(
  db: SqlDb,
  operationId: string,
  localHeldBillId: string,
  status: 'FAILED' | 'CONFLICT',
  retryCount: number,
  lastError: string,
  nowIso: string,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE sync_outbox
       SET status = ?, retry_count = ?, next_retry_at = NULL, last_error = ?, updated_at = ?
       WHERE operation_id = ?`,
      [status, retryCount, lastError, nowIso, operationId],
    );
    await db.runAsync(
      `UPDATE local_held_bills SET sync_status = ?, updated_at = ? WHERE local_id = ?`,
      [status, nowIso, localHeldBillId],
    );
  });
}

export async function retryOutboxItem(
  db: SqlDb,
  operationId: string,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ entity_id: string }>(
      'SELECT entity_id FROM sync_outbox WHERE operation_id = ?',
      [operationId],
    );
    if (!row) return;
    await db.runAsync(
      `UPDATE sync_outbox
       SET status = 'PENDING', retry_count = 0, next_retry_at = NULL, last_error = NULL, updated_at = ?
       WHERE operation_id = ?`,
      [nowIso, operationId],
    );
    await db.runAsync(
      `UPDATE local_held_bills SET sync_status = 'PENDING', updated_at = ? WHERE local_id = ?`,
      [nowIso, row.entity_id],
    );
  });
}

export async function discardOutboxItem(db: SqlDb, operationId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ entity_id: string }>(
      'SELECT entity_id FROM sync_outbox WHERE operation_id = ?',
      [operationId],
    );
    await db.runAsync('DELETE FROM sync_outbox WHERE operation_id = ?', [operationId]);
    if (row) {
      await db.runAsync('DELETE FROM local_held_bills WHERE local_id = ? AND server_id IS NULL', [
        row.entity_id,
      ]);
    }
  });
}

export async function getCacheStats(db: SqlDb): Promise<CacheStats> {
  const count = async (sql: string) => (await db.getFirstAsync<{ c: number }>(sql))?.c ?? 0;

  const [products, categories, units, customers, pendingOutbox, failedOutbox, lastSyncedAt] =
    await Promise.all([
      count('SELECT COUNT(*) AS c FROM cached_products'),
      count('SELECT COUNT(*) AS c FROM cached_categories'),
      count('SELECT COUNT(*) AS c FROM cached_units'),
      count('SELECT COUNT(*) AS c FROM cached_customers'),
      count("SELECT COUNT(*) AS c FROM sync_outbox WHERE status IN ('PENDING', 'SENDING')"),
      count("SELECT COUNT(*) AS c FROM sync_outbox WHERE status IN ('FAILED', 'CONFLICT')"),
      getMeta(db, LAST_SYNC_META_KEY),
    ]);

  return {
    products,
    categories,
    units,
    customers,
    pendingOutbox,
    failedOutbox,
    lastSyncedAt,
  };
}

function mapOutboxRow(r: {
  operation_id: string;
  branch_id: string;
  operation_type: OutboxOperationType;
  entity_id: string;
  payload_json: string;
  status: OutboxStatus;
  retry_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}): OutboxRow {
  return {
    operationId: r.operation_id,
    branchId: r.branch_id,
    operationType: r.operation_type,
    entityId: r.entity_id,
    payload: JSON.parse(r.payload_json) as HeldBillUploadPayload,
    status: r.status,
    retryCount: r.retry_count,
    nextRetryAt: r.next_retry_at,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
