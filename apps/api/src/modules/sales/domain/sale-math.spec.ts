import Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain.error';
import { computeSale, effectiveUnitPrice, grossFromUnitPrice, settle } from './sale-math';

const d = (v: string | number) => new Decimal(v);
const fx = (v: Decimal) => v.toFixed(2);
const line = (gross: string, lineDiscount = '0') => ({
  gross: d(gross),
  lineDiscount: d(lineDiscount),
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'NO_ERROR';
};

describe('computeSale', () => {
  it('adds up the lines and rounds the bill to the nearest rupee', () => {
    const s = computeSale([line('52.50'), line('180'), line('35.25')], d(0));
    expect([fx(s.subtotal), fx(s.exactTotal), fx(s.roundOff), fx(s.total)]).toEqual([
      '267.75',
      '267.75',
      '0.25',
      '268.00',
    ]);
  });

  it('rounds half a rupee up and small amounts down', () => {
    expect(fx(computeSale([line('10.50')], d(0)).total)).toBe('11.00');
    expect(fx(computeSale([line('10.49')], d(0)).total)).toBe('10.00');
    expect(fx(computeSale([line('10.49')], d(0)).roundOff)).toBe('-0.49');
  });

  it('applies line discounts, then shares the bill discount across lines by value (exact to the paisa)', () => {
    const s = computeSale([line('100', '10'), line('200'), line('300')], d('59'));
    // after line discounts: 90, 200, 300 = 590; 59 shared 9 : 20 : 30
    expect(s.lines.map((l) => fx(l.billDiscountShare))).toEqual(['9.00', '20.00', '30.00']);
    expect(s.lines.map((l) => fx(l.net))).toEqual(['81.00', '180.00', '270.00']);
    expect([fx(s.discountTotal), fx(s.total)]).toEqual(['69.00', '531.00']);
  });

  it('bill discount shares always add up exactly, even in thirds', () => {
    const s = computeSale([line('10'), line('10'), line('10')], d('1'));
    expect(s.lines.map((l) => fx(l.billDiscountShare))).toEqual(['0.34', '0.33', '0.33']);
    expect(fx(s.discountTotal)).toBe('1.00');
  });

  it('reports the discount as a percentage of the subtotal (for the cashier limit)', () => {
    expect(computeSale([line('200', '10')], d(0)).discountPercent.toFixed(2)).toBe('5.00');
    expect(computeSale([line('200')], d(0)).discountPercent.toFixed(2)).toBe('0.00');
  });

  it('a fully free bill is allowed (total 0)', () => {
    expect(fx(computeSale([line('50', '50')], d(0)).total)).toBe('0.00');
  });

  it.each([
    ['no lines', () => computeSale([], d(0)), 'SALE_EMPTY'],
    [
      'line discount above the line',
      () => computeSale([line('10', '10.01')], d(0)),
      'DISCOUNT_EXCEEDS_LINE',
    ],
    ['negative line discount', () => computeSale([line('10', '-1')], d(0)), 'DISCOUNT_INVALID'],
    [
      'bill discount above the bill',
      () => computeSale([line('10', '4')], d('6.01')),
      'DISCOUNT_EXCEEDS_BILL',
    ],
    ['negative bill discount', () => computeSale([line('10')], d('-1')), 'DISCOUNT_INVALID'],
    [
      'total beyond the database limit',
      () => computeSale([line('100000000000')], d(0)),
      'AMOUNT_TOO_LARGE',
    ],
  ])('refuses: %s', (_n, fn, expected) => {
    expect(code(fn)).toBe(expected);
  });
});

describe('prices', () => {
  it('a typed unit price makes the line quantity x price, to the paisa', () => {
    expect(fx(grossFromUnitPrice(d('1.255'), d('40')))).toBe('50.20');
    expect(fx(grossFromUnitPrice(d('0.333'), d('10')))).toBe('3.33');
  });
  it('the price shown per unit is the line amount divided by the quantity', () => {
    expect(fx(effectiveUnitPrice(d('30'), d('0.5')))).toBe('60.00');
  });
});

describe('settle', () => {
  it('fully paid: nothing on credit', () => {
    const r = settle(d('500'), [
      { method: 'CASH', amount: d('300') },
      { method: 'UPI', amount: d('200') },
    ]);
    expect([fx(r.paid), fx(r.credit)]).toEqual(['500.00', '0.00']);
  });
  it('part paid: the rest goes on the customer account', () => {
    const r = settle(d('500'), [{ method: 'CASH', amount: d('120') }]);
    expect([fx(r.paid), fx(r.credit)]).toEqual(['120.00', '380.00']);
  });
  it('nothing paid: all on credit', () => {
    expect(fx(settle(d('500'), []).credit)).toBe('500.00');
  });
  it.each([
    ['more than the bill', [{ method: 'CASH', amount: d('501') }], 'PAYMENT_EXCEEDS_TOTAL'],
    ['a zero payment', [{ method: 'CASH', amount: d('0') }], 'PAYMENT_AMOUNT_INVALID'],
  ])('refuses %s', (_n, payments, expected) => {
    expect(code(() => settle(d('500'), payments))).toBe(expected);
  });
});
