import { moneyString, quantityString, toDecimal } from './index';

describe('decimal string validation', () => {
  it('accepts valid money', () => {
    expect(moneyString.safeParse('125.50').success).toBe(true);
    expect(moneyString.safeParse('0').success).toBe(true);
  });

  it('rejects too many decimals, negatives and non-numbers', () => {
    expect(moneyString.safeParse('1.234').success).toBe(false);
    expect(moneyString.safeParse('-1').success).toBe(false);
    expect(moneyString.safeParse('abc').success).toBe(false);
  });

  it('accepts 3-decimal quantities', () => {
    expect(quantityString.safeParse('0.500').success).toBe(true);
  });

  it('does decimal math without float drift', () => {
    expect(toDecimal('0.1').plus(toDecimal('0.2')).toString()).toBe('0.3');
  });
});
