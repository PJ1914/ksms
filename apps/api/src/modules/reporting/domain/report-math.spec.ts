import Decimal from 'decimal.js';
import { AppException } from '../../../common/errors/app.exception';
import { addDays, money, percentOf, resolveRange, sumOf } from './report-math';

describe('report period', () => {
  it('defaults to the last 30 days including today', () => {
    const r = resolveRange(undefined, undefined, '2026-11-20');
    expect(r.to).toBe('2026-11-20');
    expect(r.from).toBe('2026-10-22');
    expect(r.days).toBe(30);
  });

  it('covers whole India-time days: from at midnight, to up to the next midnight', () => {
    const r = resolveRange('2026-11-01', '2026-11-02');
    expect(r.fromTs.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(r.toTs.toISOString()).toBe('2026-11-02T18:30:00.000Z');
    expect(r.days).toBe(2);
  });

  it('a single day is allowed', () => {
    expect(resolveRange('2026-11-01', '2026-11-01').days).toBe(1);
  });

  it('refuses impossible dates, reversed periods and periods over a year', () => {
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as AppException).getResponse();
      }
      return null;
    };
    expect(JSON.stringify(code(() => resolveRange('2026-13-45', '2026-11-01')))).toContain(
      'INVALID_DATE',
    );
    expect(JSON.stringify(code(() => resolveRange('2026-02-31')))).toContain('INVALID_DATE');
    expect(JSON.stringify(code(() => resolveRange('2026-11-05', '2026-11-01')))).toContain(
      'INVALID_RANGE',
    );
    expect(JSON.stringify(code(() => resolveRange('2025-01-01', '2026-11-01')))).toContain(
      'INVALID_RANGE',
    );
  });

  it('a leap year of 366 days is the longest allowed', () => {
    expect(resolveRange('2024-01-01', '2024-12-31').days).toBe(366);
    expect(() => resolveRange('2023-12-31', '2024-12-31')).toThrow();
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('report maths', () => {
  it('formats money with two places and never as a float', () => {
    expect(money('0.1')).toBe('0.10');
    expect(money(null)).toBe('0.00');
    expect(money(new Decimal('1234567.895'))).toBe('1234567.90');
  });

  it('percent of a whole, and zero when the whole is zero', () => {
    expect(percentOf(new Decimal('25'), new Decimal('200'))).toBe('12.50');
    expect(percentOf(new Decimal('5'), new Decimal(0))).toBe('0.00');
    expect(percentOf(new Decimal('-10'), new Decimal('40'))).toBe('-25.00');
  });

  it('adds decimals exactly', () => {
    expect(sumOf([new Decimal('0.1'), new Decimal('0.2')]).toFixed(2)).toBe('0.30');
  });
});
