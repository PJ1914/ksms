/**
 * Admin panel API client (ADMIN_PANEL.md section 6).
 * - Access token in memory only; refresh token in sessionStorage (never localStorage), so closing the
 *   tab ends the session.
 * - A 401 triggers one refresh attempt, then sign-out.
 * - 30 minutes without activity signs out (the server enforces the same on refresh).
 * The backend is the authority on every permission; hiding a button here is only convenience.
 */
const ORIGIN = (import.meta.env.VITE_API_ORIGIN as string | undefined) ?? 'http://localhost:3000';
export const API_BASE = `${ORIGIN.replace(/\/$/, '')}/admin/v1`;

const REFRESH_KEY = 'ksms-admin-refresh';
const IDLE_MS = 30 * 60_000;

export type Role = 'ADMIN' | 'SUPPORT';
export interface AdminProfile {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let lastActivity = Date.now();
const listeners = new Set<() => void>();

export const onSignedOut = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function markActivity() {
  lastActivity = Date.now();
}

export function setSession(access: string, refresh: string) {
  accessToken = access;
  sessionStorage.setItem(REFRESH_KEY, refresh);
  markActivity();
}

export function clearSession() {
  accessToken = null;
  sessionStorage.removeItem(REFRESH_KEY);
  listeners.forEach((fn) => fn());
}

export const hasRefreshToken = () => sessionStorage.getItem(REFRESH_KEY) !== null;

let refreshing: Promise<boolean> | null = null;

/** Exchanges the stored refresh token for a new pair; false when the session is over. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = sessionStorage.getItem(REFRESH_KEY);
    if (!refreshToken || Date.now() - lastActivity > IDLE_MS) return false;
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);
    if (!res?.ok) return false;
    const body = (await res.json()) as { data: { accessToken: string; refreshToken: string } };
    accessToken = body.data.accessToken;
    sessionStorage.setItem(REFRESH_KEY, body.data.refreshToken);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

type Method = 'GET' | 'POST' | 'PATCH';

async function send(method: Method, path: string, body?: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export interface Envelope<T> {
  data: T;
  meta?: { nextCursor?: string | null; hasMore?: boolean };
}

export async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<Envelope<T>> {
  if (accessToken && Date.now() - lastActivity > IDLE_MS) {
    clearSession();
    throw new ApiError(401, 'IDLE_TIMEOUT', 'Signed out after 30 minutes without activity');
  }
  markActivity();
  let res = await send(method, path, body, idempotencyKey).catch(() => null);
  if (res?.status === 401 && accessToken && (await refreshSession())) {
    res = await send(method, path, body, idempotencyKey).catch(() => null);
  }
  if (!res) throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  const json = (await res.json().catch(() => undefined)) as
    (Envelope<T> & { error?: { code: string; message: string; details?: unknown } }) | undefined;
  if (!res.ok) {
    if (res.status === 401 && accessToken) clearSession();
    throw new ApiError(
      res.status,
      json?.error?.code ?? 'HTTP_ERROR',
      json?.error?.message ?? res.statusText,
      json?.error?.details,
    );
  }
  return json ?? { data: undefined as T };
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path).then((r) => r.data),
  page: <T>(path: string) => request<T[]>('GET', path),
  post: <T>(path: string, body?: unknown, key?: string) =>
    request<T>('POST', path, body ?? {}, key).then((r) => r.data),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body).then((r) => r.data),
};

/** Money arrives as decimal strings; show them as ₹ with Indian grouping, never via float math. */
export function rupees(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const s = String(value);
  const neg = s.startsWith('-');
  const [whole = '0', frac = ''] = (neg ? s.slice(1) : s).split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${neg ? '−' : ''}₹${grouped}.${(frac + '00').slice(0, 2)}`;
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function date(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export const newKey = () => crypto.randomUUID();
