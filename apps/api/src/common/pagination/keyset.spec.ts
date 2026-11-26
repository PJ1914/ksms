import { afterKeyset, decodeKeyset, encodeKeyset, keysetPage } from './keyset';

describe('keyset pagination (FIXES F12)', () => {
  const id = '0190a000-0000-7000-8000-000000000001';

  it('round-trips string, number and date sort values', () => {
    expect(decodeKeyset(encodeKeyset('Rice', id))).toEqual({ value: 'Rice', id });
    expect(decodeKeyset(encodeKeyset(42, id))).toEqual({ value: 42, id });
    const when = new Date('2026-11-26T10:00:00.123Z');
    expect(decodeKeyset(encodeKeyset(when, id))).toEqual({ value: when, id });
  });

  it('refuses tampered cursors with 400 INVALID_CURSOR', () => {
    for (const bad of ['not-base64!', Buffer.from('{"v":1}').toString('base64url'), '']) {
      expect(() => decodeKeyset(bad)).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
    }
  });

  it('builds the "after" condition for both directions', () => {
    const k = { value: 'Rice', id };
    expect(afterKeyset('name', 'asc', 'asc', k)).toEqual({
      OR: [{ name: { gt: 'Rice' } }, { name: 'Rice', id: { gt: id } }],
    });
    expect(afterKeyset('soldAt', 'desc', 'desc', k)).toEqual({
      OR: [{ soldAt: { lt: 'Rice' } }, { soldAt: 'Rice', id: { lt: id } }],
    });
  });

  it('uses the extra row only to decide hasMore', () => {
    const rows = [1, 2, 3].map((n) => ({ id: `${id.slice(0, -1)}${n}`, n }));
    const more = keysetPage(rows, 2, (r) => r.n);
    expect(more.rows).toHaveLength(2);
    expect(more.meta.hasMore).toBe(true);
    expect(decodeKeyset(more.meta.nextCursor!).value).toBe(2);
    const last = keysetPage(rows.slice(0, 2), 2, (r) => r.n);
    expect(last.meta).toMatchObject({ hasMore: false, nextCursor: null });
  });
});
