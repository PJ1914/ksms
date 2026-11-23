import { randomUUID } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
import {
  decodeIdCursor,
  decodeSyncCursor,
  encodeIdCursor,
  encodeSyncCursor,
  parseUpdatedSince,
} from './sync-cursor';

describe('sync-cursor', () => {
  it('round-trips a composite (updatedAt, id) cursor', () => {
    const updatedAt = new Date('2026-11-23T10:15:30.123Z');
    const id = randomUUID();
    const encoded = encodeSyncCursor(updatedAt, id);
    const decoded = decodeSyncCursor(encoded);
    expect(decoded.updatedAt.toISOString()).toBe(updatedAt.toISOString());
    expect(decoded.id).toBe(id);
  });

  it('round-trips an id-only cursor', () => {
    const id = randomUUID();
    expect(decodeIdCursor(encodeIdCursor(id))).toEqual({ id });
  });

  it('rejects malformed, non-UUID or oversized cursors with 400 INVALID_CURSOR', () => {
    const badInputs = [
      '',
      'not-base64-json!!!',
      Buffer.from(JSON.stringify({ u: '2026-01-01T00:00:00.000Z', i: 'not-a-uuid' })).toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify({ u: 'not-a-date', i: randomUUID() })).toString('base64url'),
      'a'.repeat(600),
    ];
    for (const bad of badInputs) {
      expect(() => decodeSyncCursor(bad)).toThrow(AppException);
      try {
        decodeSyncCursor(bad);
      } catch (e) {
        expect((e as AppException).code).toBe('INVALID_CURSOR');
        expect((e as AppException).getStatus()).toBe(400);
      }
    }
    expect(() => decodeIdCursor(Buffer.from('{"i":"bad"}').toString('base64url'))).toThrow(
      AppException,
    );
  });

  it('parses valid ISO-8601 updated_since and rejects invalid timestamps', () => {
    const d = parseUpdatedSince('2026-05-01T08:30:00.500Z');
    expect(d.toISOString()).toBe('2026-05-01T08:30:00.500Z');

    const withOffset = parseUpdatedSince('2026-05-01T14:00:00+05:30');
    expect(withOffset.toISOString()).toBe('2026-05-01T08:30:00.000Z');

    for (const bad of ['2026-05-01', 'not-a-date', '12345', '']) {
      expect(() => parseUpdatedSince(bad)).toThrow(AppException);
      try {
        parseUpdatedSince(bad);
      } catch (e) {
        expect((e as AppException).code).toBe('INVALID_UPDATED_SINCE');
        expect((e as AppException).getStatus()).toBe(400);
      }
    }
  });
});
