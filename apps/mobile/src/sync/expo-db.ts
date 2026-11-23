import * as SQLite from 'expo-sqlite';
import { clearAllCache } from './cache-store';
import { initSyncSchema, type SqlDb, type SqlParam } from './db';

const DB_NAME = 'ksms_cache_v1.db';

let dbPromise: Promise<SqlDb> | null = null;

/** Opens (once) the device SQLite cache database wrapped in our serialized `SqlDb` adapter. */
export function getExpoSyncDb(): Promise<SqlDb> {
  dbPromise ??= (async () => {
    const raw = await SQLite.openDatabaseAsync(DB_NAME);
    let txQueue = Promise.resolve();

    const adapter: SqlDb = {
      execAsync: (sql) => raw.execAsync(sql),
      runAsync: async (sql, params = []) => {
        await raw.runAsync(sql, params as SQLite.SQLiteBindParams);
      },
      getFirstAsync: <T>(sql: string, params: SqlParam[] = []) =>
        raw.getFirstAsync<T>(sql, params as SQLite.SQLiteBindParams),
      getAllAsync: <T>(sql: string, params: SqlParam[] = []) =>
        raw.getAllAsync<T>(sql, params as SQLite.SQLiteBindParams),
      withTransactionAsync: <T>(fn: () => Promise<T>): Promise<T> => {
        const run = txQueue.then(async () => {
          let result!: T;
          await raw.withExclusiveTransactionAsync(async () => {
            result = await fn();
          });
          return result;
        });
        txQueue = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    };

    await initSyncSchema(adapter);
    return adapter;
  })();
  return dbPromise;
}

/** Wipes all local cached data, drafts, held bills and outbox entries (called on logout). */
export async function wipeLocalSyncCache(): Promise<void> {
  try {
    const db = await getExpoSyncDb();
    await clearAllCache(db);
  } catch {
    // Clearing cache on logout is best-effort and must never block signing out.
  }
}
