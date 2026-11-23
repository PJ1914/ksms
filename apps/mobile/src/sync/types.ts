import type { CustomerRow, ProductDetail } from '@/api/types';

export interface SyncCursorMeta {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  serverTime: string;
}

export interface SyncFeedPage<T> {
  data: T[];
  meta: SyncCursorMeta;
}

export interface SyncUnit {
  id: string;
  code: string;
  name: string;
  dimension: string;
  isPackaging: boolean;
  standardFactor: string | null;
}

export interface SyncCategory {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SyncProduct extends Omit<ProductDetail, 'baseUnit' | 'barcodes'> {
  baseUnit: { id: string; code: string; name: string };
  minSaleIncrement: string | null;
  allowFractional: boolean;
  updatedAt: string;
  deletedAt: string | null;
  barcodes: { id: string; barcode: string; unitId: string | null }[];
}

export interface SyncCustomer extends CustomerRow {
  email: string | null;
  addressLine: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

/** Phase 14 intentionally limits the outbox to held-bill uploads only (TD-02: no offline sales/collections/stock). */
export type OutboxOperationType = 'HELD_BILL_UPLOAD';

export type OutboxStatus = 'PENDING' | 'SENDING' | 'DONE' | 'CONFLICT' | 'FAILED';

export interface HeldBillUploadPayload {
  label?: string;
  customerId?: string;
  payload: Record<string, unknown>;
}

export interface OutboxRow {
  operationId: string;
  branchId: string;
  operationType: OutboxOperationType;
  entityId: string;
  payload: HeldBillUploadPayload;
  status: OutboxStatus;
  retryCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LocalHeldBillSyncStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface LocalHeldBill {
  localId: string;
  branchId: string;
  serverId: string | null;
  label: string | null;
  customerId: string | null;
  payload: unknown;
  syncStatus: LocalHeldBillSyncStatus;
  outboxId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CacheStats {
  products: number;
  categories: number;
  units: number;
  customers: number;
  pendingOutbox: number;
  failedOutbox: number;
  lastSyncedAt: string | null;
}
