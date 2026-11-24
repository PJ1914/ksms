import {
  absMoney,
  formatINR,
  isMoreThan,
  isNegative,
  isPositive,
  isZero,
  stepQuantity,
} from './currency';

describe('formatINR', () => {
  it.each([
    ['0', '₹0.00'],
    ['52.5', '₹52.50'],
    ['999', '₹999.00'],
    ['1000', '₹1,000.00'],
    ['123456', '₹1,23,456.00'],
    ['1234567.5', '₹12,34,567.50'],
    ['-45.5', '-₹45.50'],
    ['0.005', '₹0.01'],
  ])('%s -> %s', (input, expected) => {
    expect(formatINR(input)).toBe(expected);
  });
});

describe('decimal string helpers', () => {
  it('compares and flips signs exactly, with no floating point drift', () => {
    expect(isPositive('0.01')).toBe(true);
    expect(isPositive('0.00')).toBe(false);
    expect(isNegative('-0.01')).toBe(true);
    expect(isZero('0.000')).toBe(true);
    expect(absMoney('-120.5')).toBe('120.50');
    expect(absMoney('3')).toBe('3.00');
    expect(isMoreThan('0.3', '0.1')).toBe(true);
    expect(isMoreThan('0.30000000000000004', '0.3')).toBe(true);
    expect(isMoreThan('100.10', '100.1')).toBe(false);
  });
});

describe('stepQuantity', () => {
  it('adds and removes whole units on decimal strings', () => {
    expect(stepQuantity('2', 1)).toBe('3');
    expect(stepQuantity('2.5', 1)).toBe('3.5');
    expect(stepQuantity('2.5', -1)).toBe('1.5');
  });
  it('never goes to zero or below', () => {
    expect(stepQuantity('1', -1)).toBe('1');
    expect(stepQuantity('0.5', -1)).toBe('0.5');
  });
  it('treats blank or invalid input as empty', () => {
    expect(stepQuantity('', 1)).toBe('1');
    expect(stepQuantity('abc', 1)).toBe('1');
    expect(stepQuantity('', -1)).toBe('1');
  });
});
