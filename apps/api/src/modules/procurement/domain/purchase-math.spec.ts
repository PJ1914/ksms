import Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain.error';
import {
  allocateProportionally,
  computePurchase,
  cumulativeAmount,
  type PurchaseLineInput,
} from './purchase-math';

const d = (v: string | number) => new Decimal(v);
const fx = (v: Decimal) => v.toFixed(2);

const line = (over: Partial<Record<keyof PurchaseLineInput, string>> = {}): PurchaseLineInput => ({
  quantity: d(over.quantity ?? '5'),
  baseQuantity: d(over.baseQuantity ?? '125'),
  unitCost: d(over.unitCost ?? '1400'),
  discount: d(over.discount ?? '0'),
  taxRatePercent: d(over.taxRatePercent ?? '0'),
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'NO_ERROR';
};

describe('allocateProportionally', () => {
  it('splits exactly in proportion when it divides evenly', () => {
    expect(allocateProportionally(d('100'), [d('1'), d('3')]).map(fx)).toEqual(['25.00', '75.00']);
  });

  it('always adds up to the total, even when thirds do not divide (largest remainder)', () => {
    const shares = allocateProportionally(d('100'), [d('1'), d('1'), d('1')]);
    expect(shares.map(fx)).toEqual(['33.34', '33.33', '33.33']);
    expect(shares.reduce((a, s) => a.plus(s), d(0)).toFixed(2)).toBe('100.00');
  });

  it('adds up exactly for awkward weights', () => {
    const weights = [d('333.33'), d('0.01'), d('1234.5'), d('77.77')];
    const total = d('999.99');
    const shares = allocateProportionally(total, weights);
    expect(shares.reduce((a, s) => a.plus(s), d(0)).toFixed(2)).toBe('999.99');
    shares.forEach((s) => expect(s.decimalPlaces()).toBeLessThanOrEqual(2));
  });

  it('gives zeros when there is nothing to spread', () => {
    expect(allocateProportionally(d(0), [d(5), d(5)]).map(fx)).toEqual(['0.00', '0.00']);
  });

  it('refuses to spread costs over free lines only', () => {
    expect(code(() => allocateProportionally(d('10'), [d(0), d(0)]))).toBe(
      'ADDITIONAL_COST_UNALLOCATABLE',
    );
  });
});

describe('computePurchase', () => {
  it('SPEC: 5 bags (25 kg each) at 1400 -> 125 kg at 56.00 per kg', () => {
    const f = computePurchase([line()], d(0), d(0), true);
    expect(fx(f.total)).toBe('7000.00');
    expect(fx(f.lines[0]!.payable)).toBe('7000.00');
    expect(f.lines[0]!.baseUnitCost.toFixed(4)).toBe('56.0000');
  });

  it('spreads freight into the cost of the goods and into what is owed', () => {
    const f = computePurchase(
      [
        line({ quantity: '1', baseQuantity: '25', unitCost: '1000' }),
        line({ quantity: '1', baseQuantity: '10', unitCost: '3000' }),
      ],
      d('400'),
      d(0),
      true,
    );
    // freight 400 split 1000:3000 -> 100 and 300
    expect(f.lines.map((l) => fx(l.extra))).toEqual(['100.00', '300.00']);
    expect(f.lines[0]!.baseUnitCost.toFixed(4)).toBe('44.0000'); // (1000+100)/25
    expect(f.lines[1]!.baseUnitCost.toFixed(4)).toBe('330.0000'); // (3000+300)/10
    expect(fx(f.total)).toBe('4400.00');
  });

  it('applies the line discount before tax', () => {
    const f = computePurchase(
      [
        line({
          quantity: '10',
          baseQuantity: '10',
          unitCost: '100',
          discount: '50',
          taxRatePercent: '5',
        }),
      ],
      d(0),
      d(0),
      true,
    );
    const l = f.lines[0]!;
    expect([fx(l.gross), fx(l.net), fx(l.tax), fx(l.lineTotal)]).toEqual([
      '1000.00',
      '950.00',
      '47.50',
      '997.50',
    ]);
    expect(fx(f.discountTotal)).toBe('50.00');
  });

  it('GST shop: input tax is claimed back, so it is NOT in the stock cost', () => {
    const f = computePurchase(
      [line({ quantity: '10', baseQuantity: '10', unitCost: '100', taxRatePercent: '18' })],
      d(0),
      d(0),
      true,
    );
    expect(fx(f.lines[0]!.payable)).toBe('1180.00');
    expect(f.lines[0]!.baseUnitCost.toFixed(4)).toBe('100.0000');
  });

  it('non-GST shop: tax paid is part of the stock cost', () => {
    const f = computePurchase(
      [line({ quantity: '10', baseQuantity: '10', unitCost: '100', taxRatePercent: '18' })],
      d(0),
      d(0),
      false,
    );
    expect(f.lines[0]!.baseUnitCost.toFixed(4)).toBe('118.0000');
  });

  it('rounds the base unit cost half-up to 4 decimals', () => {
    const f = computePurchase(
      [line({ quantity: '1', baseQuantity: '3', unitCost: '10' })],
      d(0),
      d(0),
      true,
    );
    expect(f.lines[0]!.baseUnitCost.toFixed(4)).toBe('3.3333');
  });

  it('adds round-off to the total but not to the stock cost', () => {
    const f = computePurchase(
      [line({ quantity: '1', baseQuantity: '1', unitCost: '99.60' })],
      d(0),
      d('0.40'),
      true,
    );
    expect(fx(f.total)).toBe('100.00');
    expect(f.lines[0]!.baseUnitCost.toFixed(4)).toBe('99.6000');
  });

  it('totals are the exact sum of the lines', () => {
    const f = computePurchase(
      [
        line({ quantity: '3', baseQuantity: '3', unitCost: '33.33', taxRatePercent: '12' }),
        line({
          quantity: '7',
          baseQuantity: '7',
          unitCost: '14.29',
          discount: '1.5',
          taxRatePercent: '5',
        }),
      ],
      d('10'),
      d(0),
      true,
    );
    const sum = f.lines.reduce((a, l) => a.plus(l.payable), d(0));
    expect(fx(f.total)).toBe(fx(sum));
  });

  it.each([
    [
      'discount bigger than the line',
      () => computePurchase([line({ discount: '8000' })], d(0), d(0), true),
      'DISCOUNT_EXCEEDS_LINE',
    ],
    ['no items', () => computePurchase([], d(0), d(0), true), 'PURCHASE_EMPTY'],
    [
      'round-off above 5',
      () => computePurchase([line()], d(0), d('6'), true),
      'ROUND_OFF_TOO_LARGE',
    ],
    [
      'negative total through round-off',
      () =>
        computePurchase(
          [line({ quantity: '1', baseQuantity: '1', unitCost: '1', discount: '1' })],
          d(0),
          d('-1'),
          true,
        ),
      'PURCHASE_TOTAL_NEGATIVE',
    ],
    [
      'total beyond the database limit',
      () =>
        computePurchase(
          [line({ quantity: '1000000', baseQuantity: '1', unitCost: '100000' })],
          d(0),
          d(0),
          true,
        ),
      'AMOUNT_TOO_LARGE',
    ],
    [
      'freight on free goods',
      () => computePurchase([line({ unitCost: '0' })], d('50'), d(0), true),
      'ADDITIONAL_COST_UNALLOCATABLE',
    ],
  ])('refuses: %s', (_name, fn, expected) => {
    expect(code(fn)).toBe(expected);
  });
});

describe('cumulativeAmount (exact partial billing)', () => {
  it('bills in proportion and is exact when everything is received', () => {
    expect(fx(cumulativeAmount(d('100'), d('1'), d('3')))).toBe('33.33');
    expect(fx(cumulativeAmount(d('100'), d('2'), d('3')))).toBe('66.67');
    expect(fx(cumulativeAmount(d('100'), d('3'), d('3')))).toBe('100.00');
  });

  it('never exceeds the payable and never loses paise across many receipts', () => {
    const payable = d('1000.01');
    const ordered = d('7');
    let posted = d(0);
    for (let received = 1; received <= 7; received++) {
      const target = cumulativeAmount(payable, d(received), ordered);
      expect(target.gte(posted)).toBe(true);
      posted = target;
    }
    expect(fx(posted)).toBe('1000.01');
  });

  it('is zero when nothing is done', () => {
    expect(fx(cumulativeAmount(d('500'), d(0), d('10')))).toBe('0.00');
  });

  it('refuses more than ordered', () => {
    expect(() => cumulativeAmount(d('1'), d('2'), d('1'))).toThrow(RangeError);
  });
});
