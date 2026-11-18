import { api } from '@/auth/session';
import { randomUuid } from '@/utils/uuid';

/** A page of a list: `{ data: [...], meta: { page, pageSize, total, ... } }`. */
export interface Page<T, M = Record<string, unknown>> {
  data: T[];
  meta: { page: number; pageSize: number; total: number } & M;
}

/** GET returning the `data` of the response. */
export const getData = async <T>(path: string): Promise<T> =>
  (await api.get<{ data: T }>(path)).data;

export const getPage = <T, M = Record<string, unknown>>(path: string) => api.get<Page<T, M>>(path);

export const postData = async <T>(
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> => (await api.post<{ data: T }>(path, body, idempotencyKey)).data;

export const patchData = async <T>(path: string, body?: unknown): Promise<T> =>
  (await api.patch<{ data: T }>(path, body)).data;

export const deleteData = async (path: string): Promise<void> => {
  await api.delete(path);
};

export const newKey = (): string => randomUuid();

/** Builds `?a=1&b=2`, leaving out empty values. */
export function query(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
