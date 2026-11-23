import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Page, getPage } from '@/api/client';
import { peek, remember } from '@/api/swr-cache';
import { isNetworkFailure } from '@/sync/backoff';
import { friendlyError } from '@/utils/errors';

/**
 * Loads one thing and reloads it whenever the screen comes back into view (after adding something, say).
 * Answers to out-of-date requests are ignored, so a slow reply can never overwrite a newer one.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], cacheKey?: string) {
  const [data, setData] = useState<T | null>(() => (cacheKey ? (peek<T>(cacheKey) ?? null) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !(cacheKey && peek(cacheKey) !== undefined));
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);
  const first = useRef(true);

  const run = useCallback(load, deps);

  const reload = useCallback(
    async (pullToRefresh = false) => {
      const ticket = ++latest.current;
      if (pullToRefresh) setRefreshing(true);
      try {
        const result = await run();
        if (ticket !== latest.current) return;
        setData(result);
        if (cacheKey) remember(cacheKey, result);
        setError(null);
      } catch (e) {
        if (ticket === latest.current) setError(friendlyError(e));
      } finally {
        if (ticket === latest.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [run, cacheKey],
  );

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  // First load, and again whenever the inputs change.
  useEffect(() => {
    const cached = cacheKey ? peek<T>(cacheKey) : undefined;
    if (cached !== undefined)
      setData(cached); // show the last answer at once, refresh quietly
    else setLoading(true);
    void reload();
  }, [reload, cacheKey]);

  // Coming back to the screen (not the very first time) refreshes quietly.
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void reloadRef.current();
    }, []),
  );

  return { data, error, loading, refreshing, reload };
}

/** A list that loads page by page as the user scrolls, with pull to refresh and optional offline cache fallback. */
export function usePagedList<T, M = Record<string, unknown>>(
  path: string | null,
  pageSize = 30,
  fallback?: () => Promise<T[] | null>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState<Page<T, M>['meta'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(path !== null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);
  const first = useRef(true);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const url = useCallback(
    (page: number) =>
      path === null
        ? null
        : `${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=${pageSize}`,
    [path, pageSize],
  );

  const reload = useCallback(
    async (pull = false) => {
      const target = url(1);
      if (target === null) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const ticket = ++latest.current;
      if (pull) setRefreshing(true);
      try {
        const res = await getPage<T, M>(target);
        if (ticket !== latest.current) return;
        setItems(res.data);
        setMeta(res.meta);
        remember(target, res);
        setFromCache(false);
        setError(null);
      } catch (e) {
        if (ticket !== latest.current) return;
        if (isNetworkFailure(e) && fallbackRef.current) {
          const cached = await fallbackRef.current().catch(() => null);
          if (ticket !== latest.current) return;
          if (cached !== null) {
            setItems(cached);
            setMeta({
              page: 1,
              pageSize: Math.max(1, cached.length),
              total: cached.length,
            } as Page<T, M>['meta']);
            setFromCache(true);
            setError(null);
            return;
          }
        }
        setFromCache(false);
        setError(friendlyError(e));
      } finally {
        if (ticket === latest.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [url],
  );

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const loadMore = useCallback(async () => {
    if (fromCache || !meta || loadingMore || items.length >= meta.total) return;
    const target = url(meta.page + 1);
    if (target === null) return;
    const ticket = latest.current;
    setLoadingMore(true);
    try {
      const res = await getPage<T, M>(target);
      if (ticket !== latest.current) return;
      setItems((prev) => [...prev, ...res.data]);
      setMeta(res.meta);
    } catch (e) {
      if (ticket === latest.current) setError(friendlyError(e));
    } finally {
      setLoadingMore(false);
    }
  }, [fromCache, items.length, loadingMore, meta, url]);

  useEffect(() => {
    if (path === null) {
      ++latest.current;
      setItems([]);
      setMeta(null);
      setError(null);
      setFromCache(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const hit = peek<Page<T, M>>(url(1) ?? '');
    if (hit) {
      setItems(hit.data);
      setMeta(hit.meta);
      setLoading(false);
    } else {
      setLoading(true);
    }
    const t = setTimeout(() => void reload(), hit ? 0 : 250); // short pause while typing in a search box
    return () => clearTimeout(t);
  }, [path, reload, url]);

  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void reloadRef.current();
    }, []),
  );

  return { items, meta, error, fromCache, loading, refreshing, loadingMore, reload, loadMore };
}
