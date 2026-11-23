import { ApiError } from '@ksms/api-client';

export const BASE_BACKOFF_MS = 2_000;
export const MAX_BACKOFF_MS = 15 * 60 * 1_000;
export const MAX_OUTBOX_RETRIES = 6;

export type ErrorDisposition =
  | { kind: 'retryable'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'permanent'; message: string };

/**
 * Exponential backoff (`2^(n-1) * 2s`) with ±20% jitter, capped at 15 minutes
 * (per docs/architecture/SYNC_WORKFLOW.md).
 */
export function computeBackoffMs(retryCount: number, random: () => number = Math.random): number {
  const attempt = Math.max(1, Math.floor(retryCount));
  const base = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  const jitterFactor = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.max(BASE_BACKOFF_MS, Math.min(MAX_BACKOFF_MS, Math.round(base * jitterFactor)));
}

/** True when a request failed before receiving an HTTP response (offline, timeout, DNS). */
export function isNetworkFailure(err: unknown): boolean {
  return !(err instanceof ApiError);
}

/** Classifies an outbox upload failure according to the SYNC_WORKFLOW state machine. */
export function classifyOutboxError(err: unknown): ErrorDisposition {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return { kind: 'conflict', message: err.message || 'Conflict on server' };
    }
    if (err.status === 429 || err.status >= 500 || err.status === 401) {
      return {
        kind: 'retryable',
        message:
          err.status === 401
            ? 'Session expired — sign in again to retry'
            : err.message || 'Server temporarily unavailable',
      };
    }
    return { kind: 'permanent', message: err.message || `Request rejected (${err.status})` };
  }
  return { kind: 'retryable', message: 'Offline — will retry automatically when connected' };
}
