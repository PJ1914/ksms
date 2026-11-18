import { randomUuid } from './uuid';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUuid', () => {
  it('returns valid distinct RFC 4122 v4 UUIDs', () => {
    const a = randomUuid();
    const b = randomUuid();
    expect(a).toMatch(UUID_V4_RE);
    expect(b).toMatch(UUID_V4_RE);
    expect(a).not.toBe(b);
  });
});
