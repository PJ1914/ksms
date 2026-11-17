import type { ApiErrorBody } from '@ksms/shared-types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly correlationId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  getBranchId?: () => string | null;
}

export function createApiClient(opts: ApiClientOptions) {
  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = await opts.getAccessToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
    const branch = opts.getBranchId?.();
    if (branch) headers['x-branch-id'] = branch;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    const res = await fetch(`${opts.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const err = (json as ApiErrorBody | undefined)?.error;
      throw new ApiError(
        res.status,
        err?.code ?? 'UNKNOWN_ERROR',
        err?.message ?? res.statusText,
        err?.correlationId,
        err?.details,
      );
    }
    return json as T;
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
      request<T>('POST', path, body, idempotencyKey),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
  };
}
