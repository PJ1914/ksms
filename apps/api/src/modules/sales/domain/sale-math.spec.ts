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
    [
      'negative tax rate',
      () => computeSale([{ ...line('10'), taxRatePercent: d('-1') }], d(0), { gstEnabled: true }),
      'TAX_RATE_INVALID',
    ],
    [
      'tax rate above 100%',
      () => computeSale([{ ...line('10'), taxRatePercent: d('101') }], d(0), { gstEnabled: true }),
      'TAX_RATE_INVALID',
    ],
  ])('refuses: %s', (_n, fn, expected) => {
    expect(code(fn)).toBe(expected);
  });

  it('GST off: ignores product tax rates and keeps tax at 0', () => {
    const s = computeSale(
      [{ gross: d('105'), lineDiscount: d(0), taxRatePercent: d('5'), taxMode: 'INCLUSIVE' }],
      d(0),
      { gstEnabled: false },
    );
    expect([fx(s.taxableTotal), fx(s.taxTotal), fx(s.total)]).toEqual(['105.00', '0.00', '105.00']);
  });

  it('GST INCLUSIVE intra-state: extracts tax from discounted price and splits CGST + SGST evenly', () => {
    // 105 inclusive of 5% GST -> taxable 100.00, tax 5.00 -> CGST 2.50, SGST 2.50, net 105.00
    const s = computeSale(
      [{ gross: d('105'), lineDiscount: d(0), taxRatePercent: d('5'), taxMode: 'INCLUSIVE' }],
      d(0),
      { gstEnabled: true, interState: false },
    );
    expect(s.lines[0]).toMatchObject({
      taxableValue: d('100'),
      cgst: d('2.5'),
      sgst: d('2.5'),
      igst: d('0'),
      tax: d('5'),
      net: d('105'),
    });
    expect([
      fx(s.taxableTotal),
      fx(s.cgstTotal),
      fx(s.sgstTotal),
      fx(s.igstTotal),
      fx(s.total),
    ]).toEqual(['100.00', '2.50', '2.50', '0.00', '105.00']);
  });

  it('GST EXCLUSIVE intra-state: adds tax on top of discounted price and rounds bill to the rupee', () => {
    // 100 - 10 discount = 90 taxable; 18% GST = 16.20 (CGST 8.10 + SGST 8.10); net 106.20 -> rounded 106.00 (-0.20)
    const s = computeSale(
      [{ gross: d('100'), lineDiscount: d('10'), taxRatePercent: d('18'), taxMode: 'EXCLUSIVE' }],
      d(0),
      { gstEnabled: true, interState: false },
    );
    expect([
      fx(s.taxableTotal),
      fx(s.cgstTotal),
      fx(s.sgstTotal),
      fx(s.exactTotal),
      fx(s.roundOff),
      fx(s.total),
    ]).toEqual(['90.00', '8.10', '8.10', '106.20', '-0.20', '106.00']);
  });

  it('GST inter-state: charges IGST instead of CGST + SGST', () => {
    const s = computeSale(
      [{ gross: d('100'), lineDiscount: d(0), taxRatePercent: d('12'), taxMode: 'EXCLUSIVE' }],
      d(0),
      { gstEnabled: true, interState: true },
    );
    expect([
      fx(s.taxableTotal),
      fx(s.cgstTotal),
      fx(s.sgstTotal),
      fx(s.igstTotal),
      fx(s.total),
    ]).toEqual(['100.00', '0.00', '0.00', '12.00', '112.00']);
  });

  it('odd-paisa intra-state tax splits without losing a paisa (CGST + SGST == tax)', () => {
    // 1.00 at 5% exclusive -> tax 0.05 -> CGST 0.02 + SGST 0.03 = 0.05
    const s = computeSale(
      [{ gross: d('1.00'), lineDiscount: d(0), taxRatePercent: d('5'), taxMode: 'EXCLUSIVE' }],
      d(0),
      { gstEnabled: true, interState: false },
    );
    expect([fx(s.cgstTotal), fx(s.sgstTotal), fx(s.taxTotal)]).toEqual(['0.02', '0.03', '0.05']);
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
