export type SqlParam = string | number | null;

/** Minimal async SQLite interface implemented by expo-sqlite in the app and an in-memory fake in unit tests. */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlParam[]): Promise<void>;
  getFirstAsync<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  withTransactionAsync<T>(fn: () => Promise<T>): Promise<T>;
}

export const SYNC_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS cached_units (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    dimension TEXT NOT NULL,
    is_packaging INTEGER NOT NULL,
    standard_factor TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS cached_categories (
    id TEXT PRIMARY KEY NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_active INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS cached_products (
    id TEXT PRIMARY KEY NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    local_name TEXT,
    category_id TEXT,
    status TEXT NOT NULL,
    base_unit_id TEXT NOT NULL,
    base_unit_code TEXT NOT NULL,
    primary_barcode TEXT,
    base_price TEXT,
    track_batch INTEGER NOT NULL,
    track_expiry INTEGER NOT NULL,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_cached_products_name ON cached_products (name);`,
  `CREATE TABLE IF NOT EXISTS cached_product_barcodes (
    barcode TEXT PRIMARY KEY NOT NULL,
    product_id TEXT NOT NULL,
    unit_id TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS idx_cached_barcodes_product ON cached_product_barcodes (product_id);`,
  `CREATE TABLE IF NOT EXISTS cached_customers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    gstin TEXT,
    state_code TEXT,
    address_line TEXT,
    credit_limit TEXT,
    balance TEXT NOT NULL,
    is_active INTEGER NOT NULL,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_cached_customers_name ON cached_customers (name);`,
  `CREATE TABLE IF NOT EXISTS draft_bills (
    scope_key TEXT PRIMARY KEY NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS local_held_bills (
    local_id TEXT PRIMARY KEY NOT NULL,
    branch_id TEXT NOT NULL,
    server_id TEXT,
    label TEXT,
    customer_id TEXT,
    payload_json TEXT NOT NULL,
    sync_status TEXT NOT NULL,
    outbox_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_local_held_bills_branch ON local_held_bills (branch_id, created_at);`,
  `CREATE TABLE IF NOT EXISTS sync_outbox (
    operation_id TEXT PRIMARY KEY NOT NULL,
    branch_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    retry_count INTEGER NOT NULL,
    next_retry_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox (status, next_retry_at);`,
];

export const ALL_SYNC_TABLES = [
  'sync_meta',
  'cached_units',
  'cached_categories',
  'cached_products',
  'cached_product_barcodes',
  'cached_customers',
  'draft_bills',
  'local_held_bills',
  'sync_outbox',
] as const;

export async function initSyncSchema(db: SqlDb): Promise<void> {
  for (const stmt of SYNC_SCHEMA_STATEMENTS) {
    await db.execAsync(stmt);
  }
}
