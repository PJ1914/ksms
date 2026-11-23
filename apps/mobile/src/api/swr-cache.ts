/**
 * Remembers the last answer for a screen so it can be shown at once while a fresh one loads
 * (stale-while-revalidate). Kept in memory only, and wiped whenever the signed-in user or branch changes,
 * so one user's or branch's data is never shown to another.
 */
let scope = '';
const store = new Map<string, unknown>();

export function setCacheScope(next: string): void {
  if (next === scope) return;
  scope = next;
  store.clear();
}

export function peek<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function remember<T>(key: string, value: T): void {
  store.set(key, value);
}
