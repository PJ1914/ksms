import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { newKey } from '@/api/client';
import { isNetworkFailure } from './backoff';
import {
  clearAllCache,
  discardOutboxItem,
  enqueueHeldBill,
  ensureCacheOwner,
  getCacheStats,
  listOutboxItems,
  ownerKeyFor,
  retryOutboxItem,
} from './cache-store';
import type { SqlDb } from './db';
import { getExpoSyncDb } from './expo-db';
import { liveSyncTransport } from './live-transport';
import { flushHeldBillOutbox, pullReadCache } from './sync-engine';
import type { CacheStats, LocalHeldBill, OutboxRow } from './types';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

const EMPTY_STATS: CacheStats = {
  products: 0,
  categories: 0,
  units: 0,
  customers: 0,
  pendingOutbox: 0,
  failedOutbox: 0,
  lastSyncedAt: null,
};

interface SyncContextApi {
  db: SqlDb | null;
  ready: boolean;
  syncState: SyncState;
  lastError: string | null;
  stats: CacheStats;
  outbox: OutboxRow[];
  syncNow: () => Promise<void>;
  holdBill: (input: {
    branchId: string;
    label?: string;
    customerId?: string;
    payload: Record<string, unknown>;
  }) => Promise<LocalHeldBill>;
  retryItem: (operationId: string) => Promise<void>;
  discardItem: (operationId: string) => Promise<void>;
  refreshLocalState: () => Promise<void>;
}

const SyncContext = createContext<SyncContextApi | null>(null);

const RETRY_POLL_MS = 20_000;

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, profile, can } = useAuth();
  const [db, setDb] = useState<SqlDb | null>(null);
  const [ready, setReady] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [stats, setStats] = useState<CacheStats>(EMPTY_STATS);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);

  const inFlight = useRef<Promise<void> | null>(null);
  const dbRef = useRef<SqlDb | null>(null);
  const canProducts = can('product.read');
  const canCustomers = can('customer.read');
  const ownerKey = profile ? ownerKeyFor(profile.organization.id, profile.user.id) : null;

  const refreshLocalState = useCallback(async () => {
    const activeDb = dbRef.current;
    if (!activeDb) return;
    const [nextStats, nextOutbox] = await Promise.all([
      getCacheStats(activeDb),
      listOutboxItems(activeDb, false),
    ]);
    setStats(nextStats);
    setOutbox(nextOutbox);
  }, []);

  const runSync = useCallback(
    async (mode: 'full' | 'flushOnly') => {
      const activeDb = dbRef.current;
      if (!activeDb || !ownerKey) return;
      if (inFlight.current) {
        await inFlight.current;
        return;
      }

      const work = (async () => {
        setSyncState('syncing');
        try {
          await flushHeldBillOutbox(activeDb, liveSyncTransport);
          if (mode === 'full') {
            await pullReadCache(activeDb, liveSyncTransport, {
              products: canProducts,
              customers: canCustomers,
            });
          }
          setLastError(null);
          setSyncState('idle');
        } catch (err) {
          if (isNetworkFailure(err)) {
            setSyncState('offline');
            setLastError('Offline — using saved data on this phone');
          } else {
            setSyncState('error');
            setLastError(err instanceof Error ? err.message : 'Sync failed');
          }
        } finally {
          await refreshLocalState();
          inFlight.current = null;
        }
      })();

      inFlight.current = work;
      await work;
    },
    [ownerKey, canProducts, canCustomers, refreshLocalState],
  );

  const syncNow = useCallback(() => runSync('full'), [runSync]);

  // Initialize SQLite & enforce per-(org, user) cache isolation whenever the signed-in profile changes.
  useEffect(() => {
    let cancelled = false;

    if (authStatus === 'signedOut') {
      setReady(false);
      setStats(EMPTY_STATS);
      setOutbox([]);
      setSyncState('idle');
      setLastError(null);
      void getExpoSyncDb()
        .then((d) => clearAllCache(d))
        .catch(() => undefined);
      return;
    }

    if (authStatus !== 'signedIn' || !ownerKey) return;

    setReady(false);
    void (async () => {
      try {
        const opened = await getExpoSyncDb();
        if (cancelled) return;
        await ensureCacheOwner(opened, ownerKey);
        if (cancelled) return;
        dbRef.current = opened;
        setDb(opened);
        await refreshLocalState();
        if (cancelled) return;
        setReady(true);
        void runSync('full');
      } catch (err) {
        if (!cancelled) {
          setLastError(err instanceof Error ? err.message : 'Could not open local cache');
          setSyncState('error');
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, ownerKey, refreshLocalState, runSync]);

  // Sync automatically whenever the app comes back to the foreground.
  useEffect(() => {
    if (!ready || !ownerKey) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void runSync('full');
    });
    return () => sub.remove();
  }, [ready, ownerKey, runSync]);

  // Background backoff retry loop whenever there are pending held-bill uploads.
  useEffect(() => {
    if (!ready || !ownerKey || stats.pendingOutbox === 0) return;
    const timer = setInterval(() => {
      void runSync('flushOnly');
    }, RETRY_POLL_MS);
    return () => clearInterval(timer);
  }, [ready, ownerKey, stats.pendingOutbox, runSync]);

  const holdBill = useCallback(
    async (input: {
      branchId: string;
      label?: string;
      customerId?: string;
      payload: Record<string, unknown>;
    }): Promise<LocalHeldBill> => {
      const activeDb = dbRef.current ?? (await getExpoSyncDb());
      dbRef.current = activeDb;
      const saved = await enqueueHeldBill(activeDb, {
        localId: newKey(),
        operationId: newKey(),
        branchId: input.branchId,
        label: input.label,
        customerId: input.customerId,
        payload: input.payload,
      });
      await refreshLocalState();
      // Attempt immediate upload (if offline, stays safely queued in outbox with backoff).
      void runSync('flushOnly');
      return saved;
    },
    [refreshLocalState, runSync],
  );

  const retryItem = useCallback(
    async (operationId: string) => {
      const activeDb = dbRef.current;
      if (!activeDb) return;
      await retryOutboxItem(activeDb, operationId);
      await refreshLocalState();
      await runSync('flushOnly');
    },
    [refreshLocalState, runSync],
  );

  const discardItem = useCallback(
    async (operationId: string) => {
      const activeDb = dbRef.current;
      if (!activeDb) return;
      await discardOutboxItem(activeDb, operationId);
      await refreshLocalState();
    },
    [refreshLocalState],
  );

  const value = useMemo<SyncContextApi>(
    () => ({
      db,
      ready,
      syncState,
      lastError,
      stats,
      outbox,
      syncNow,
      holdBill,
      retryItem,
      discardItem,
      refreshLocalState,
    }),
    [
      db,
      ready,
      syncState,
      lastError,
      stats,
      outbox,
      syncNow,
      holdBill,
      retryItem,
      discardItem,
      refreshLocalState,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextApi {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}
