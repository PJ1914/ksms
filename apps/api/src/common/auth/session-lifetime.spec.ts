import { absoluteExpiry, slidingExpiry } from './session-lifetime';

const DAY = 86_400_000;

describe('session lifetime (FIXES F5)', () => {
  const created = new Date('2026-01-01T00:00:00Z');

  it('slides by the refresh TTL while far from the cap', () => {
    const now = created.getTime() + 10 * DAY;
    expect(slidingExpiry(created, 30, 90, now).getTime()).toBe(now + 30 * DAY);
  });

  it('never slides past the absolute cap', () => {
    const now = created.getTime() + 80 * DAY;
    expect(slidingExpiry(created, 30, 90, now)).toEqual(absoluteExpiry(created, 90));
    expect(absoluteExpiry(created, 90).getTime()).toBe(created.getTime() + 90 * DAY);
  });
});
