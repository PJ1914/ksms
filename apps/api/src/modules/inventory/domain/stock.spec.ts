import Decimal from 'decimal.js';
import {
  BatchStock,
  allocateFefo,
  isExpired,
  isRealIsoDate,
  stockValue,
  todayInIndia,
  weightedAverageCost,
} from './stock';

const d = (v: string | number) => new Decimal(v);
const batch = (id: string, expiryDate: string | null, qty: string | number): BatchStock => ({
  id,
  expiryDate,
  quantity: d(qty),
});
const summary = (r: ReturnType<typeof allocateFefo>) => ({
  allocations: r.allocations.map((a) => `${a.batchId}:${a.quantity.toFixed()}`),
  shortfall: r.shortfall.toFixed(),
  expired: r.expiredQuantity.toFixed(),
});

describe('weightedAverageCost', () => {
  it('first receipt sets the cost', () => {
    expect(weightedAverageCost(d(0), d(0), d(100), d(50)).toFixed()).toBe('50');
  });

  it('spec example: 100 kg at 50 then 25 kg at 60 -> 52', () => {
    // (100 x 50 + 25 x 60) / 125 = 6500 / 125 = 52
    expect(weightedAverageCost(d(100), d(50), d(25), d(60)).toFixed()).toBe('52');
  });

  it('is exact decimal arithmetic, rounded half-up to 4 decimals', () => {
    // (1 x 10 + 2 x 11) / 3 = 10.666666... -> 10.6667
    expect(weightedAverageCost(d(1), d(10), d(2), d(11)).toFixed()).toBe('10.6667');
    // (3 x 0.1 + 3 x 0.2) / 6 = 0.15 exactly (floats give 0.15000000000000002)
    expect(weightedAverageCost(d(3), d('0.1'), d(3), d('0.2')).toFixed()).toBe('0.15');
  });

  it('a deficit (negative stock after an override) does not distort the new average', () => {
    expect(weightedAverageCost(d(-3), d(40), d(10), d(55)).toFixed()).toBe('55');
  });

  it('rejects nonsense inputs', () => {
    expect(() => weightedAverageCost(d(1), d(1), d(0), d(1))).toThrow(RangeError);
    expect(() => weightedAverageCost(d(1), d(1), d(1), d(-1))).toThrow(RangeError);
  });
});

describe('FEFO allocation', () => {
  const today = '2026-11-18';

  it('consumes the earliest-expiring batch first and spills into the next', () => {
    const r = allocateFefo(
      [batch('MAR', '2027-03-31', 10), batch('JAN', '2027-01-31', 4), batch('NOEXP', null, 50)],
      d(6),
      today,
    );
    expect(summary(r)).toEqual({ allocations: ['JAN:4', 'MAR:2'], shortfall: '0', expired: '0' });
  });

  it('never sells expired stock, and reports how much is expired', () => {
    const r = allocateFefo(
      [batch('OLD', '2026-11-01', 5), batch('NEW', '2027-02-01', 3)],
      d(4),
      today,
    );
    expect(summary(r)).toEqual({ allocations: ['NEW:3'], shortfall: '1', expired: '5' });
  });

  it('stock expiring today is still sellable today', () => {
    expect(isExpired('2026-11-18', today)).toBe(false);
    expect(isExpired('2026-11-17', today)).toBe(true);
    expect(isExpired(null, today)).toBe(false);
    expect(
      summary(allocateFefo([batch('TODAY', '2026-11-18', 2)], d(2), today)).allocations,
    ).toEqual(['TODAY:2']);
  });

  it('batches without an expiry date are used last', () => {
    const r = allocateFefo([batch('NOEXP', null, 10), batch('SOON', '2026-12-01', 1)], d(2), today);
    expect(summary(r).allocations).toEqual(['SOON:1', 'NOEXP:1']);
  });

  it('keeps received order for equal expiry dates', () => {
    const r = allocateFefo(
      [batch('FIRST', '2027-01-01', 1), batch('SECOND', '2027-01-01', 1)],
      d(1),
      today,
    );
    expect(summary(r).allocations).toEqual(['FIRST:1']);
  });

  it('includes expired batches only when writing expired stock off', () => {
    const r = allocateFefo([batch('OLD', '2026-11-01', 5)], d(5), today, true);
    expect(summary(r)).toEqual({ allocations: ['OLD:5'], shortfall: '0', expired: '0' });
  });

  it('handles fractional base quantities exactly (loose goods)', () => {
    const r = allocateFefo(
      [batch('A', '2027-01-01', '0.3'), batch('B', '2027-02-01', '0.2')],
      d('0.45'),
      today,
    );
    expect(summary(r)).toEqual({ allocations: ['A:0.3', 'B:0.15'], shortfall: '0', expired: '0' });
  });

  it('reports a shortfall when there is not enough usable stock, and skips empty batches', () => {
    const r = allocateFefo(
      [batch('EMPTY', '2026-12-01', 0), batch('A', '2027-01-01', 2)],
      d(5),
      today,
    );
    expect(summary(r)).toEqual({ allocations: ['A:2'], shortfall: '3', expired: '0' });
  });
});

describe('helpers', () => {
  it('today in India switches at IST midnight, not UTC', () => {
    expect(todayInIndia(new Date('2026-11-18T18:29:00Z'))).toBe('2026-11-18'); // 23:59 IST
    expect(todayInIndia(new Date('2026-11-18T18:31:00Z'))).toBe('2026-11-19'); // 00:01 IST
  });

  it('stock value counts only positive stock and rounds to paise', () => {
    expect(stockValue(d(125), d(52)).toFixed(2)).toBe('6500.00');
    expect(stockValue(d('0.333'), d('10.6667')).toFixed(2)).toBe('3.55'); // 3.5520111
    expect(stockValue(d(-5), d(40)).toFixed(2)).toBe('0.00');
  });
});

describe('isRealIsoDate', () => {
  it.each([
    ['2026-11-18', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-02-31', false],
    ['2026-13-01', false],
    ['2026-1-1', false],
    ['18-11-2026', false],
    ['', false],
  ])('%s -> %s', (value, expected) => {
    expect(isRealIsoDate(value)).toBe(expected);
  });
});
