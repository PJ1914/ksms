import { discountFor, quote } from './pricing';

const TIERS = { '3': '5', '6': '10', '9': '12', '12': '15' };

describe('subscription pricing (decimal.js, ADMIN_PANEL.md decision 3)', () => {
  it.each([
    // plan, months, expected amount
    ['599', 1, '599.00'],
    ['599', 3, '1707.15'], // 1797 - 5%
    ['599', 6, '3234.60'], // 3594 - 10%
    ['599', 9, '4744.08'], // 5391 - 12%
    ['599', 12, '6109.80'], // 7188 - 15%
    ['599', 2, '1198.00'], // custom: no discount
    ['299', 12, '3049.80'],
    ['0', 3, '0.00'],
  ])('%s × %i months = %s', (price, months, amount) => {
    expect(quote(price, months, TIERS).amount).toBe(amount);
  });

  it('reports gross and discount', () => {
    expect(quote('299', 3, TIERS)).toEqual({
      monthlyPrice: '299.00',
      months: 3,
      gross: '897.00',
      discountPercent: '5',
      amount: '852.15',
    });
  });

  it('rounds half-up to paise without float error', () => {
    expect(quote('333.33', 3, { '3': '7.5' }).amount).toBe('924.99'); // 999.99 × 0.925 = 924.990…
    expect(quote('0.10', 3, {}).gross).toBe('0.30'); // 0.1 × 3 is exactly 0.30, not 0.30000000000000004
  });

  it('ignores bad discount data instead of failing', () => {
    expect(discountFor(null, 3).toString()).toBe('0');
    expect(discountFor({ '3': 'abc' }, 3).toString()).toBe('0');
    expect(discountFor({ '3': '150' }, 3).toString()).toBe('0');
    expect(discountFor({ '3': '-5' }, 3).toString()).toBe('0');
  });

  it('refuses non-positive or fractional months', () => {
    expect(() => quote('599', 0, TIERS)).toThrow();
    expect(() => quote('599', 1.5, TIERS)).toThrow();
  });
});
