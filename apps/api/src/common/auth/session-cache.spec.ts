import { type CachedAuth, SESSION_CACHE_TTL_MS, SessionCache } from './session-cache';

const entry = (userId: string): CachedAuth => ({
  session: {
    userId,
    organizationId: 'org',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    user: { isActive: true, tokenVersion: 0 },
  },
  member: { id: 'm', roleId: 'r', status: 'ACTIVE', branches: [] },
});

describe('SessionCache (FIXES F7)', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-26T10:00:00Z') }));
  afterEach(() => jest.useRealTimers());

  it('returns what was stored until the TTL passes', () => {
    const c = new SessionCache();
    c.set('s1', entry('u1'));
    expect(c.get('s1')?.session.userId).toBe('u1');
    jest.advanceTimersByTime(SESSION_CACHE_TTL_MS + 1);
    expect(c.get('s1')).toBeUndefined();
  });

  it('invalidating a session drops it and refuses to re-cache it for a while', () => {
    const c = new SessionCache();
    c.set('s1', entry('u1'));
    c.invalidateSession('s1');
    expect(c.get('s1')).toBeUndefined();
    c.set('s1', entry('u1')); // e.g. read before the revoking transaction committed
    expect(c.get('s1')).toBeUndefined();
    jest.advanceTimersByTime(70_000);
    c.set('s1', entry('u1'));
    expect(c.get('s1')).toBeDefined();
  });

  it('invalidating a user drops all of their sessions only', () => {
    const c = new SessionCache();
    c.set('a', entry('u1'));
    c.set('b', entry('u1'));
    c.set('c', entry('u2'));
    c.invalidateUser('u1');
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBeDefined();
  });

  it('invalidateAll empties and pauses the cache', () => {
    const c = new SessionCache();
    c.set('a', entry('u1'));
    c.invalidateAll();
    expect(c.get('a')).toBeUndefined();
    c.set('b', entry('u2'));
    expect(c.get('b')).toBeUndefined();
  });
});
