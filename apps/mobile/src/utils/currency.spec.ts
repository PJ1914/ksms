import { formatINR } from './currency';

describe('formatINR', () => {
  it('uses Indian grouping', () => {
    expect(formatINR('1234567.5')).toBe('₹12,34,567.50');
    expect(formatINR('999')).toBe('₹999.00');
    expect(formatINR('1000')).toBe('₹1,000.00');
    expect(formatINR('100000')).toBe('₹1,00,000.00');
  });

  it('rounds half up to paise and handles negatives', () => {
    expect(formatINR('10.005')).toBe('₹10.01');
    expect(formatINR('-250.5')).toBe('-₹250.50');
  });

  it('formats zero', () => {
    expect(formatINR('0')).toBe('₹0.00');
  });
});
