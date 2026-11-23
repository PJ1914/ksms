import { z } from 'zod';
import { AppException } from '../../../common/errors/app.exception';

const syncCursorPayload = z.object({
  u: z.string().datetime({ offset: true }),
  i: z.uuid(),
});

const idCursorPayload = z.object({
  i: z.uuid(),
});

const isoDateTime = z.string().datetime({ offset: true });

export interface SyncCursor {
  updatedAt: Date;
  id: string;
}

export interface IdCursor {
  id: string;
}

/** Encodes a composite `(updatedAt, id)` keyset cursor as opaque base64url JSON. */
export function encodeSyncCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ u: updatedAt.toISOString(), i: id }), 'utf8').toString(
    'base64url',
  );
}

/** Decodes and validates a composite `(updatedAt, id)` keyset cursor. */
export function decodeSyncCursor(raw: string): SyncCursor {
  const parsed = decodeJson(raw);
  const res = syncCursorPayload.safeParse(parsed);
  if (!res.success) {
    throw new AppException('INVALID_CURSOR', 'Invalid sync cursor', 400);
  }
  const updatedAt = new Date(res.data.u);
  if (Number.isNaN(updatedAt.getTime())) {
    throw new AppException('INVALID_CURSOR', 'Invalid sync cursor', 400);
  }
  return { updatedAt, id: res.data.i };
}

/** Encodes an `id`-only keyset cursor (used by global reference tables without `updatedAt`). */
export function encodeIdCursor(id: string): string {
  return Buffer.from(JSON.stringify({ i: id }), 'utf8').toString('base64url');
}

/** Decodes and validates an `id`-only keyset cursor. */
export function decodeIdCursor(raw: string): IdCursor {
  const parsed = decodeJson(raw);
  const res = idCursorPayload.safeParse(parsed);
  if (!res.success) {
    throw new AppException('INVALID_CURSOR', 'Invalid sync cursor', 400);
  }
  return { id: res.data.i };
}

/** Validates an ISO-8601 `updated_since` query timestamp. */
export function parseUpdatedSince(raw: string): Date {
  const res = isoDateTime.safeParse(raw);
  if (!res.success) {
    throw new AppException(
      'INVALID_UPDATED_SINCE',
      'updated_since must be a valid ISO-8601 timestamp with timezone (e.g. 2026-01-01T00:00:00.000Z)',
      400,
    );
  }
  const date = new Date(res.data);
  if (Number.isNaN(date.getTime())) {
    throw new AppException(
      'INVALID_UPDATED_SINCE',
      'updated_since must be a valid ISO-8601 timestamp',
      400,
    );
  }
  return date;
}

function decodeJson(raw: string): unknown {
  if (!raw || raw.length > 512) {
    throw new AppException('INVALID_CURSOR', 'Invalid sync cursor', 400);
  }
  try {
    const text = Buffer.from(raw, 'base64url').toString('utf8');
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppException('INVALID_CURSOR', 'Invalid sync cursor', 400);
  }
}
