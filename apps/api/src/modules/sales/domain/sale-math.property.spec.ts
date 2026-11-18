import Decimal from 'decimal.js';
import { computeSale } from './sale-math';

/**
 * Independent check of the GST engine (audit of Phase 10). The expected figures are worked out here with a SEPARATE,
 * deliberately simple formula, over many generated bills (fixed seed, so a failure is reproducible), and compared with
 * what `computeSale` returns. The rules checked are the ones every GST invoice must satisfy.
 */

// small deterministic random generator (mulberry32)
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RATES = ['0', '0.25', '3', '5', '12', '18', '28'];
const d = (v: string | number) => new Decimal(v);
const r2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

function randomBill(next: () => number) {
  const n = 1 + Math.floor(next() * 6);
  const inputs = Array.from({ length: n }, () => {
    const gross = d(Math.floor(next() * 500000) / 100); // 0.00 .. 4999.99
    const lineDiscount = next() < 0.4 ? r2(gross.mul(next() * 0.3)) : d(0);
    return {
      gross,
      lineDiscount,
      taxRatePercent: d(RATES[Math.floor(next() * RATES.length)]!),
      taxMode: (next() < 0.5 ? 'INCLUSIVE' : 'EXCLUSIVE') as 'INCLUSIVE' | 'EXCLUSIVE',
    };
  });
  const after = inputs.reduce((a, l) => a.plus(l.gross.minus(l.lineDiscount)), d(0));
  const billDiscount = next() < 0.4 ? r2(after.mul(next() * 0.2)) : d(0);
  return { inputs, billDiscount, interState: next() < 0.5 };
}

describe('GST engine: invariants over 2,000 generated bills', () => {
  const next = rng(20261119);
  const bills = Array.from({ length: 2000 }, () => randomBill(next));

  it('every line: taxable + tax = what the customer pays, and the tax heads add up to the tax', () => {
    for (const b of bills) {
      const s = computeSale(b.inputs, b.billDiscount, {
        gstEnabled: true,
        interState: b.interState,
      });
      for (const l of s.lines) {
        expect(l.taxableValue.plus(l.tax).toFixed(2)).toBe(l.net.toFixed(2));
        expect(l.cgst.plus(l.sgst).plus(l.igst).toFixed(2)).toBe(l.tax.toFixed(2));
        if (b.interState) expect([l.cgst.toFixed(2), l.sgst.toFixed(2)]).toEqual(['0.00', '0.00']);
        else expect(l.igst.toFixed(2)).toBe('0.00');
        expect(l.tax.gte(0)).toBe(true);
        expect(l.taxableValue.gte(0)).toBe(true);
      }
    }
  });

  it('INCLUSIVE: the customer pays exactly the discounted price; EXCLUSIVE: discounted price plus tax', () => {
    for (const b of bills) {
      const s = computeSale(b.inputs, b.billDiscount, {
        gstEnabled: true,
        interState: b.interState,
      });
      s.lines.forEach((l, i) => {
        const after = b.inputs[i]!.gross.minus(l.discount);
        if (l.taxMode === 'INCLUSIVE') expect(l.net.toFixed(2)).toBe(after.toFixed(2));
        else expect(l.net.toFixed(2)).toBe(after.plus(l.tax).toFixed(2));
      });
    }
  });

  it('the tax of each line equals an independently computed figure (half-up, to the paisa)', () => {
    for (const b of bills) {
      const s = computeSale(b.inputs, b.billDiscount, {
        gstEnabled: true,
        interState: b.interState,
      });
      s.lines.forEach((l) => {
        const rate = l.taxRatePercent;
        const expected =
          rate.isZero() || l.afterDiscount.lte(0)
            ? d(0)
            : l.taxMode === 'INCLUSIVE'
              ? r2(l.afterDiscount.mul(rate).div(d(100).plus(rate)))
              : r2(l.afterDiscount.mul(rate).div(100));
        expect(l.tax.toFixed(2)).toBe(expected.toFixed(2));
      });
    }
  });

  it('bill totals are the exact sums of the lines; the total is the rupee-rounded sum; round-off is within 50 paise', () => {
    for (const b of bills) {
      const s = computeSale(b.inputs, b.billDiscount, {
        gstEnabled: true,
        interState: b.interState,
      });
      const sum = (f: (l: (typeof s.lines)[number]) => Decimal) =>
        s.lines.reduce((a, l) => a.plus(f(l)), d(0));
      expect(s.taxableTotal.toFixed(2)).toBe(sum((l) => l.taxableValue).toFixed(2));
      expect(s.cgstTotal.toFixed(2)).toBe(sum((l) => l.cgst).toFixed(2));
      expect(s.sgstTotal.toFixed(2)).toBe(sum((l) => l.sgst).toFixed(2));
      expect(s.igstTotal.toFixed(2)).toBe(sum((l) => l.igst).toFixed(2));
      expect(s.taxTotal.toFixed(2)).toBe(sum((l) => l.tax).toFixed(2));
      expect(s.exactTotal.toFixed(2)).toBe(sum((l) => l.net).toFixed(2));
      expect(s.total.toFixed(2)).toBe(
        s.exactTotal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(2),
      );
      expect(s.roundOff.abs().lte('0.5')).toBe(true);
      expect(s.total.minus(s.exactTotal).toFixed(2)).toBe(s.roundOff.toFixed(2));
    }
  });

  it('discounts are shared exactly: the shares add up to the bill discount and lines never go below zero', () => {
    for (const b of bills) {
      const s = computeSale(b.inputs, b.billDiscount, {
        gstEnabled: true,
        interState: b.interState,
      });
      const shared = s.lines.reduce((a, l) => a.plus(l.billDiscountShare), d(0));
      expect(shared.toFixed(2)).toBe(b.billDiscount.toFixed(2));
      s.lines.forEach((l) => expect(l.afterDiscount.gte(0)).toBe(true));
    }
  });

  it('with GST switched off nothing is taxed whatever the products say', () => {
    for (const b of bills.slice(0, 300)) {
      const s = computeSale(b.inputs, b.billDiscount, { gstEnabled: false });
      expect(s.taxTotal.toFixed(2)).toBe('0.00');
      s.lines.forEach((l) => expect(l.net.toFixed(2)).toBe(l.afterDiscount.toFixed(2)));
    }
  });
});

describe('GST engine: worked examples a shopkeeper would recognise', () => {
  const one = (gross: string, rate: string, mode: 'INCLUSIVE' | 'EXCLUSIVE', interState = false) =>
    computeSale(
      [{ gross: d(gross), lineDiscount: d(0), taxRatePercent: d(rate), taxMode: mode }],
      d(0),
      { gstEnabled: true, interState },
    );

  it('Rs 118 with 18% included is Rs 100 plus Rs 18 tax', () => {
    const s = one('118', '18', 'INCLUSIVE');
    expect([s.taxableTotal, s.taxTotal, s.total].map((v) => v.toFixed(2))).toEqual([
      '100.00',
      '18.00',
      '118.00',
    ]);
    expect([s.cgstTotal, s.sgstTotal].map((v) => v.toFixed(2))).toEqual(['9.00', '9.00']);
  });

  it('Rs 100 plus 28% is Rs 128', () => {
    const s = one('100', '28', 'EXCLUSIVE');
    expect([s.taxTotal, s.total].map((v) => v.toFixed(2))).toEqual(['28.00', '128.00']);
  });

  it('a 0% item on a GST bill carries no tax', () => {
    expect(one('50', '0', 'INCLUSIVE').taxTotal.toFixed(2)).toBe('0.00');
  });

  it('a free (zero price) line is allowed and carries no tax', () => {
    expect(one('0', '18', 'EXCLUSIVE').taxTotal.toFixed(2)).toBe('0.00');
  });

  it('a mixed bill with two rates and a bill discount keeps each rate on its own line', () => {
    const s = computeSale(
      [
        { gross: d('105'), lineDiscount: d(0), taxRatePercent: d('5'), taxMode: 'INCLUSIVE' },
        { gross: d('236'), lineDiscount: d(0), taxRatePercent: d('18'), taxMode: 'INCLUSIVE' },
      ],
      d('34.1'), // 10% of 341, shared 105:236
      { gstEnabled: true, interState: false },
    );
    // line 1: 105 - 10.50 = 94.50 incl 5%; line 2: 236 - 23.60 = 212.40 incl 18%
    expect(s.lines.map((l) => [l.afterDiscount.toFixed(2), l.tax.toFixed(2)])).toEqual([
      ['94.50', '4.50'],
      ['212.40', '32.40'],
    ]);
    expect(s.total.toFixed(2)).toBe('307.00'); // 306.90 rounded
  });

  it('the two halves of CGST and SGST differ by one paisa when the tax is an odd number of paise', () => {
    // KNOWN BEHAVIOUR, reported to the owner for the accountant: tax 0.05 is split 0.02 + 0.03
    const s = one('1.00', '5', 'EXCLUSIVE');
    expect([s.cgstTotal, s.sgstTotal].map((v) => v.toFixed(2))).toEqual(['0.02', '0.03']);
  });
});
