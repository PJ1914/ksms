import Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain.error';
import { PricePoint, priceForQuantity } from './pricing';

const d = (v: string | number) => new Decimal(v);
const factors = new Map<string, Decimal>([
  ['KG', d(1)],
  ['G', d('0.001')],
  ['BAG', d(25)],
]);
const point = (unitId: string, quantity: number, price: string): PricePoint => ({
  unitId,
  quantity: d(quantity),
  price: d(price),
});
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
};

describe('priceForQuantity (loose rice, base KG)', () => {
  const points = [point('KG', 1, '58'), point('G', 500, '30'), point('BAG', 1, '1400')];
  const quote = (unit: string, qty: string) =>
    priceForQuantity(points, 'KG', factors, unit, d(qty));

  it('uses an exact price point first (500 g = 30, not the proportional 29)', () => {
    const q = quote('G', '500');
    expect(q.amount.toFixed(2)).toBe('30.00');
    expect(q.source).toBe('EXACT');
  });

  it('multiplies the per-unit price: 2 kg = 116', () => {
    const q = quote('KG', '2');
    expect(q.amount.toFixed(2)).toBe('116.00');
    expect(q.source).toBe('UNIT_PRICE');
  });

  it('derives from the base price for other quantities: 250 g = 14.50, 2 bags via bag price', () => {
    const q = quote('G', '250');
    expect(q.amount.toFixed(2)).toBe('14.50');
    expect(q.source).toBe('DERIVED_FROM_BASE');
    expect(quote('BAG', '2').amount.toFixed(2)).toBe('2800.00');
  });

  it('rounds half-up to paise and says so', () => {
    const q = quote('G', '333'); // 58 x 0.333 = 19.314
    expect(q.amount.toFixed(2)).toBe('19.31');
    expect(q.rounded).toBe(true);
    expect(quote('G', '500').rounded).toBe(false);
  });

  it("rounds exactly half up (never banker's rounding)", () => {
    const half = [point('KG', 1, '0.05')];
    expect(priceForQuantity(half, 'KG', factors, 'KG', d('0.1')).amount.toFixed(2)).toBe('0.01'); // 0.005 -> 0.01
  });

  it('has no float drift on tricky sums', () => {
    const p = [point('KG', 1, '0.10')];
    expect(priceForQuantity(p, 'KG', factors, 'KG', d(3)).amount.toFixed(2)).toBe('0.30'); // 0.1*3 in floats is 0.30000000000000004
  });
});

describe('priceForQuantity failures', () => {
  it('fails clearly when nothing usable is configured', () => {
    expect(code(() => priceForQuantity([], 'KG', factors, 'KG', d(1)))).toBe(
      'PRICE_NOT_CONFIGURED',
    );
    expect(
      code(() => priceForQuantity([point('BAG', 1, '1400')], 'KG', factors, 'G', d(500))),
    ).toBe('PRICE_NOT_CONFIGURED');
  });
  it('rejects unknown units and non-positive quantities', () => {
    expect(code(() => priceForQuantity([point('KG', 1, '58')], 'KG', factors, 'L', d(1)))).toBe(
      'UNIT_NOT_CONFIGURED',
    );
    expect(code(() => priceForQuantity([point('KG', 1, '58')], 'KG', factors, 'KG', d(0)))).toBe(
      'QUANTITY_INVALID',
    );
  });
  it('refuses a derived price whose quantity cannot be represented', () => {
    expect(code(() => priceForQuantity([point('KG', 1, '58')], 'KG', factors, 'G', d('0.5')))).toBe(
      'QUANTITY_PRECISION',
    );
  });
});
