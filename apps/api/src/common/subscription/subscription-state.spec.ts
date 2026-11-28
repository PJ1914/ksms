import { SUBSCRIPTION_STATES } from '@ksms/constants';
import { addDays, addMonths, DAY_MS, subscriptionState } from './subscription-state';

const endsAt = new Date('2026-12-31T18:30:00.000Z'); // 1 Jan 2027 00:00 IST
const base = { endsAt, graceDays: 5, isTrial: false, locked: false };
const at = (ms: number) => new Date(endsAt.getTime() + ms);

describe('subscriptionState', () => {
  it('ACTIVE before endsAt, with full access and days left rounded up', () => {
    const s = subscriptionState({ ...base, now: at(-2.5 * DAY_MS) });
    expect(s).toMatchObject({ state: 'ACTIVE', canRead: true, canWrite: true, daysLeft: 3 });
  });

  it('TRIAL instead of ACTIVE on a trial plan', () => {
    expect(subscriptionState({ ...base, isTrial: true, now: at(-1) }).state).toBe('TRIAL');
  });

  it('boundary: exactly at endsAt the grace period starts', () => {
    expect(subscriptionState({ ...base, now: at(-1) }).state).toBe('ACTIVE');
    const s = subscriptionState({ ...base, now: at(0) });
    expect(s).toMatchObject({ state: 'GRACE', canWrite: true, daysLeft: 0, graceDaysLeft: 5 });
  });

  it('boundary: exactly at endsAt + grace the shop becomes read-only', () => {
    expect(subscriptionState({ ...base, now: at(5 * DAY_MS - 1) }).state).toBe('GRACE');
    const s = subscriptionState({ ...base, now: at(5 * DAY_MS) });
    expect(s).toMatchObject({ state: 'EXPIRED', canRead: true, canWrite: false, graceDaysLeft: 0 });
    expect(s.graceEndsAt.toISOString()).toBe('2027-01-05T18:30:00.000Z');
  });

  it('grace 0 goes straight from ACTIVE to EXPIRED', () => {
    expect(subscriptionState({ ...base, graceDays: 0, now: at(0) }).state).toBe('EXPIRED');
  });

  it('LOCKED overrides every date, with no reads and no writes', () => {
    for (const offset of [-30 * DAY_MS, 0, 2 * DAY_MS, 90 * DAY_MS]) {
      for (const isTrial of [true, false]) {
        const s = subscriptionState({ ...base, isTrial, locked: true, now: at(offset) });
        expect(s).toMatchObject({ state: 'LOCKED', canRead: false, canWrite: false });
      }
    }
  });

  it('only ever moves forward through ACTIVE → GRACE → EXPIRED as time passes (sampled every hour)', () => {
    const order = ['ACTIVE', 'GRACE', 'EXPIRED'];
    let last = 0;
    for (let h = -24 * 10; h <= 24 * 10; h++) {
      const s = subscriptionState({ ...base, now: at(h * 3_600_000) });
      const idx = order.indexOf(s.state);
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
      expect(SUBSCRIPTION_STATES).toContain(s.state);
      expect(s.canWrite).toBe(s.state !== 'EXPIRED');
    }
  });
});

describe('addMonths (UTC, end-of-month safe)', () => {
  const d = (iso: string) => new Date(iso);
  it.each([
    ['2027-01-31T10:00:00.000Z', 1, '2027-02-28T10:00:00.000Z'],
    ['2028-01-31T10:00:00.000Z', 1, '2028-02-29T10:00:00.000Z'], // leap year
    ['2027-01-15T10:00:00.000Z', 1, '2027-02-15T10:00:00.000Z'],
    ['2027-03-31T00:00:00.000Z', 1, '2027-04-30T00:00:00.000Z'],
    ['2027-08-31T00:00:00.000Z', 6, '2028-02-29T00:00:00.000Z'],
    ['2026-11-30T23:59:59.999Z', 3, '2027-02-28T23:59:59.999Z'],
    ['2027-12-31T00:00:00.000Z', 12, '2028-12-31T00:00:00.000Z'],
    ['2027-05-31T00:00:00.000Z', 9, '2028-02-29T00:00:00.000Z'],
    ['2027-03-31T00:00:00.000Z', -1, '2027-02-28T00:00:00.000Z'],
    ['2027-01-15T00:00:00.000Z', -13, '2025-12-15T00:00:00.000Z'],
    ['2027-06-10T05:00:00.000Z', 0, '2027-06-10T05:00:00.000Z'],
  ])('%s + %i months = %s', (from, months, expected) => {
    expect(addMonths(d(from), months).toISOString()).toBe(expected);
  });

  it('refuses fractional months', () => {
    expect(() => addMonths(new Date(), 1.5)).toThrow();
  });

  it('addDays is plain UTC arithmetic', () => {
    expect(addDays(d('2027-03-27T12:00:00.000Z'), 14).toISOString()).toBe(
      '2027-04-10T12:00:00.000Z',
    );
  });
});
