import { z } from 'zod';
import { AppException } from '../errors/app.exception';
import type { CursorMeta } from './paginated';

/**
 * Keyset ("seek") pagination shared by the heavy lists (FIXES F12). The cursor is opaque base64url JSON
 * holding the last row's sort value and id, the same scheme as the sync cursors
 * (modules/sync/domain/sync-cursor.ts), generalised to string, number and date sort values.
 *
 * Unlike OFFSET, the cost of a page does not grow with its depth, and no total is counted.
 */
const payload = z.object({
  /** sort value of the last row; dates are ISO strings tagged with `t: 'd'` */
  v: z.union([z.string(), z.number()]),
  t: z.enum(['s', 'n', 'd']),
  i: z.uuid(),
});

export type SortValue = string | number | Date;

export interface Keyset {
  value: SortValue;
  id: string;
}

export function encodeKeyset(value: SortValue, id: string): string {
  const body =
    value instanceof Date
      ? { v: value.toISOString(), t: 'd', i: id }
      : { v: value, t: typeof value === 'number' ? 'n' : 's', i: id };
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

export function decodeKeyset(raw: string): Keyset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new AppException('INVALID_CURSOR', 'Invalid cursor', 400);
  }
  const res = payload.safeParse(parsed);
  if (!res.success) throw new AppException('INVALID_CURSOR', 'Invalid cursor', 400);
  const { v, t, i } = res.data;
  if (t === 'd') {
    const date = new Date(String(v));
    if (Number.isNaN(date.getTime()))
      throw new AppException('INVALID_CURSOR', 'Invalid cursor', 400);
    return { value: date, id: i };
  }
  return { value: v, id: i };
}

/**
 * Prisma `where` for "rows after the cursor" in `ORDER BY <field> <dir>, id <idDir>`.
 * `field > v OR (field = v AND id > i)` with the comparisons flipped for descending order.
 */
export function afterKeyset(
  field: string,
  dir: 'asc' | 'desc',
  idDir: 'asc' | 'desc',
  k: Keyset,
): Record<string, unknown> {
  const op = dir === 'asc' ? 'gt' : 'lt';
  const idOp = idDir === 'asc' ? 'gt' : 'lt';
  return { OR: [{ [field]: { [op]: k.value } }, { [field]: k.value, id: { [idOp]: k.id } }] };
}

/** Builds the page from `limit + 1` fetched rows: the extra row only tells whether there is more. */
export function keysetPage<R extends { id: string }>(
  rows: R[],
  limit: number,
  sortValue: (row: R) => SortValue,
): { rows: R[]; meta: CursorMeta } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    rows: page,
    meta: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeKeyset(sortValue(last), last.id) : null,
      serverTime: new Date().toISOString(),
    },
  };
}

/** Counts stop here: a list never scans more rows than this just to print a total. */
export const COUNT_CAP = 10_000;

/** `total` for page-style lists from a count taken with `take: COUNT_CAP + 1`. */
/** `totalCapped: true` is added only when the cap was hit, so normal answers keep their old shape. */
export function cappedTotal(counted: number): { total: number; totalCapped?: true } {
  return counted > COUNT_CAP ? { total: COUNT_CAP, totalCapped: true } : { total: counted };
}
