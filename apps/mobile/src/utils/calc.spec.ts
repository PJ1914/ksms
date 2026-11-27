import {
  addGst,
  backspace,
  changeDue,
  evaluate,
  formatNumber,
  prettyExpression,
  pressKey,
  removeGst,
  type Key,
} from './calc';

const calc = (expr: string) => {
  const r = evaluate(expr);
  return r.ok ? r.value.toFixed() : r.error;
};
const type = (keys: string): string => {
  let e = '';
  for (const k of keys.split(' ')) e = pressKey(e, k as Key);
  return e;
};

describe('evaluate', () => {
  it('is exact: 0.1 + 0.2 = 0.3', () => {
    expect(calc('0.1+0.2')).toBe('0.3');
  });
  it('does × and ÷ before + and −', () => {
    expect(calc('2+3×4')).toBe('14');
    expect(calc('10-6÷2')).toBe('7');
  });
  it('shop-style percent', () => {
    expect(calc('200+18%')).toBe('236'); // add 18%
    expect(calc('500-10%')).toBe('450'); // take off 10%
    expect(calc('200×5%')).toBe('10'); // 5% of 200
    expect(calc('50%')).toBe('0.5');
    expect(calc('100+10+10%')).toBe('121'); // 10% of the running 110
    expect(calc('200÷50%')).toBe('400');
  });
  it('ignores a trailing operator and handles divide by zero', () => {
    expect(calc('12+')).toBe('12');
    expect(calc('5÷0')).toBe('DIV0');
    expect(calc('')).toBe('EMPTY');
  });
  it('supports a negative start (a result carried on)', () => {
    expect(calc('-5+2')).toBe('-3');
    expect(calc('-5×-')).toBe('-5');
  });
});

describe('typing', () => {
  it('builds numbers and blocks nonsense', () => {
    expect(type('1 2 . 5 + 3')).toBe('12.5+3');
    expect(type('1 . 2 . 3')).toBe('1.23'); // one dot only
    expect(type('0 0 7')).toBe('7'); // no leading zeros
    expect(type('+ 5')).toBe('5'); // cannot start with +
    expect(type('5 + × 3')).toBe('5×3'); // operator replaced
    expect(type('5 % 7')).toBe('5%'); // no digits after %
    expect(type('% 5')).toBe('5');
  });
  it('00 key adds two zeros', () => {
    expect(type('5 00')).toBe('500');
    expect(type('00')).toBe('0');
  });
  it('limits the length of a number', () => {
    expect(type('1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7').length).toBe(15);
  });
  it('backspace removes the last key', () => {
    expect(backspace('12+3')).toBe('12+');
    expect(backspace('-')).toBe('');
  });
});

describe('showing numbers', () => {
  it('groups the Indian way and trims zeros', () => {
    expect(formatNumber('1234567.5')).toBe('12,34,567.5');
    expect(formatNumber('999')).toBe('999');
    expect(formatNumber('-1500.25')).toBe('-1,500.25');
    expect(formatNumber('0.30000')).toBe('0.3');
  });
  it('makes the typed line readable', () => {
    expect(prettyExpression('1000+10%')).toBe('1,000 + 10%');
    expect(prettyExpression('5-2×3.5')).toBe('5 − 2 × 3.5');
    expect(prettyExpression('-5+2')).toBe('-5 + 2');
  });
});

describe('GST and change', () => {
  it('adds GST: 1000 at 18% = 1180 (90 + 90)', () => {
    expect(addGst('1000', 18)).toEqual({
      taxable: '1000.00',
      gst: '180.00',
      cgst: '90.00',
      sgst: '90.00',
      total: '1180.00',
    });
  });
  it('removes GST: 1180 at 18% = 1000 + 180', () => {
    expect(removeGst('1180', 18)).toMatchObject({ taxable: '1000.00', gst: '180.00' });
  });
  it('splits an odd paisa without losing any', () => {
    const r = removeGst('100', 5);
    expect(r.taxable).toBe('95.24');
    expect(r.gst).toBe('4.76');
    expect(Number(r.cgst) + Number(r.sgst)).toBeCloseTo(4.76, 2);
  });
  it('change to give back', () => {
    expect(changeDue('347.50', '500')).toBe('152.50');
    expect(changeDue('347.50', '300')).toBe('-47.50');
  });
});
