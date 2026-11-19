import Decimal from 'decimal.js';
import { computeDailyClosing } from './closing-math';

describe('computeDailyClosing', () => {
  it('computes exact match (zero difference)', () => {
    const r = computeDailyClosing({
      openingCash: new Decimal('1000.00'),
      netCashMovements: new Decimal('2450.50'),
      actualCash: new Decimal('3450.50'),
    });
    expect(r.expectedCash.toFixed(2)).toBe('3450.50');
    expect(r.difference.toFixed(2)).toBe('0.00');
  });

  it('computes positive difference when actual cash exceeds expected', () => {
    const r = computeDailyClosing({
      openingCash: new Decimal('500.00'),
      netCashMovements: new Decimal('-120.25'),
      actualCash: new Decimal('400.00'),
    });
    expect(r.expectedCash.toFixed(2)).toBe('379.75');
    expect(r.difference.toFixed(2)).toBe('20.25');
  });

  it('computes negative difference when cash is short', () => {
    const r = computeDailyClosing({
      openingCash: new Decimal('0.00'),
      netCashMovements: new Decimal('1500.00'),
      actualCash: new Decimal('1450.00'),
    });
    expect(r.expectedCash.toFixed(2)).toBe('1500.00');
    expect(r.difference.toFixed(2)).toBe('-50.00');
  });
});
