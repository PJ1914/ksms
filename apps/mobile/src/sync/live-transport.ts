import { query } from '@/api/client';
import { api, postForBranch } from '@/auth/session';
import type { SyncTransport } from './sync-engine';
import type { SyncCategory, SyncCustomer, SyncFeedPage, SyncProduct, SyncUnit } from './types';

/** Live HTTP transport connecting the mobile sync engine to `/sync/*` and idempotent `POST /held-bills`. */
export const liveSyncTransport: SyncTransport = {
  fetchProducts: ({ updatedSince, cursor, limit }) =>
    api.get<SyncFeedPage<SyncProduct>>(
      `/sync/products${query({ updated_since: updatedSince, cursor, limit })}`,
    ),
  fetchCategories: ({ updatedSince, cursor, limit }) =>
    api.get<SyncFeedPage<SyncCategory>>(
      `/sync/categories${query({ updated_since: updatedSince, cursor, limit })}`,
    ),
  fetchUnits: ({ cursor, limit }) =>
    api.get<SyncFeedPage<SyncUnit>>(`/sync/units${query({ cursor, limit })}`),
  fetchCustomers: ({ updatedSince, cursor, limit }) =>
    api.get<SyncFeedPage<SyncCustomer>>(
      `/sync/customers${query({ updated_since: updatedSince, cursor, limit })}`,
    ),
  uploadHeldBill: async (branchId, idempotencyKey, body) =>
    (await postForBranch<{ data: { id: string } }>(branchId, '/held-bills', body, idempotencyKey))
      .data,
};
