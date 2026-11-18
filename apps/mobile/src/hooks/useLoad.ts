import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Page, getPage } from '@/api/client';
import { friendlyError } from '@/utils/errors';

/**
 * Loads one thing and reloads it whenever the screen comes back into view (after adding something, say).
 * Answers to out-of-date requests are ignored, so a slow reply can never overwrite a newer one.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    [run],
  );

  // First load, and again whenever the inputs change.
  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // Coming back to the screen (not the very first time) refreshes quietly.
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void reload();
    }, [reload]),
  );

  return { data, error, loading, refreshing, reload };
}

/** A list that loads page by page as the user scrolls, with pull to refresh. `path` includes any filters. */
export function usePagedList<T, M = Record<string, unknown>>(path: string | null, pageSize = 30) {
  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState<Page<T, M>['meta'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);
  const first = useRef(true);

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
      if (target === null) return;
      const ticket = ++latest.current;
      if (pull) setRefreshing(true);
      try {
        const res = await getPage<T, M>(target);
        if (ticket !== latest.current) return;
        setItems(res.data);
        setMeta(res.meta);
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
    [url],
  );

  const loadMore = useCallback(async () => {
    if (!meta || loadingMore || items.length >= meta.total) return;
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
  }, [items.length, loadingMore, meta, url]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => void reload(), 250); // short pause while typing in a search box
    return () => clearTimeout(t);
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void reload();
    }, [reload]),
  );

  return { items, meta, error, loading, refreshing, loadingMore, reload, loadMore };
}
