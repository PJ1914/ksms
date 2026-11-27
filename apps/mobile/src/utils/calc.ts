import Decimal from 'decimal.js';

/**
 * The shop calculator's brain. All arithmetic is exact decimal (never JS floats), so 0.1 + 0.2 is 0.3.
 * It works the way shopkeepers expect: `200 + 18%` is 236, `500 - 10%` is 450, `200 × 5%` is 10.
 */

export type Op = '+' | '-' | '×' | '÷';
const OPS = ['+', '-', '×', '÷'];
const MAX_DIGITS = 15;

const D = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export type CalcResult = { ok: true; value: Decimal } | { ok: false; error: 'DIV0' | 'EMPTY' };

interface Factor {
  value: Decimal;
  pct: boolean;
}

/** Splits "200+18%×2" into number/percent/operator pieces. A leading "-" is a sign. */
function tokenize(expr: string): { factors: Factor[]; ops: Op[] } {
  const factors: Factor[] = [];
  const ops: Op[] = [];
  let i = 0;
  let negative = false;
  if (expr[0] === '-') {
    negative = true;
    i = 1;
  }
  while (i < expr.length) {
    const ch = expr[i]!;
    if (OPS.includes(ch)) {
      ops.push(ch as Op);
      i += 1;
      continue;
    }
    let j = i;
    while (j < expr.length && /[0-9.]/.test(expr[j]!)) j += 1;
    const text = expr.slice(i, j);
    if (!text) {
      i += 1;
      continue;
    }
    let v = new D(text === '.' ? '0' : text);
    if (negative && factors.length === 0) v = v.negated();
    const pct = expr[j] === '%';
    factors.push({ value: v, pct });
    i = pct ? j + 1 : j;
  }
  // a trailing operator has nothing to work on yet
  while (ops.length >= factors.length && ops.length > 0) ops.pop();
  return { factors, ops };
}

/** Evaluates the expression with × ÷ before + −, and shop-style percentages. */
export function evaluate(expr: string): CalcResult {
  const { factors, ops } = tokenize(expr);
  if (factors.length === 0) return { ok: false, error: 'EMPTY' };

  let acc: Decimal | null = null;
  let sign = 1;
  let idx = 0;
  while (idx < factors.length) {
    // one term: factors joined by × and ÷
    const first = factors[idx]!;
    let termEnd = idx;
    while (termEnd < ops.length && (ops[termEnd] === '×' || ops[termEnd] === '÷')) termEnd += 1;
    const single = termEnd === idx;

    let value: Decimal;
    if (single && first.pct && acc !== null) {
      // "200 + 10%" means 10% OF 200
      value = acc.times(first.value).div(100);
    } else {
      value = first.pct ? first.value.div(100) : first.value;
      for (let k = idx; k < termEnd; k += 1) {
        const f = factors[k + 1]!;
        const operand = f.pct ? f.value.div(100) : f.value;
        if (ops[k] === '×') value = value.times(operand);
        else {
          if (operand.isZero()) return { ok: false, error: 'DIV0' };
          value = value.div(operand);
        }
      }
    }
    acc = acc === null ? value : sign === 1 ? acc.plus(value) : acc.minus(value);
    const next = ops[termEnd];
    sign = next === '-' ? -1 : 1;
    idx = termEnd + 1;
  }
  return { ok: true, value: acc! };
}

// ---------------------------------------------------------------- typing

const isOp = (c: string | undefined) => !!c && OPS.includes(c);
const lastNumber = (expr: string) => /[0-9.]*%?$/.exec(expr)?.[0] ?? '';

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | '%' | Op;

/** Applies one key press to the expression text. Invalid presses are ignored (no double operators etc.). */
export function pressKey(expr: string, key: Key): string {
  const last = expr[expr.length - 1];
  const num = lastNumber(expr);

  if (key === '+' || key === '-' || key === '×' || key === '÷') {
    if (expr === '') return key === '-' ? '-' : expr;
    if (expr === '-') return expr;
    if (isOp(last)) return expr.slice(0, -1) + key; // change your mind
    return expr + key;
  }
  if (key === '%') {
    if (!num || num.endsWith('%') || num === '.') return expr;
    return expr + '%';
  }
  if (key === '.') {
    if (num.endsWith('%')) return expr;
    if (num.includes('.')) return expr;
    return expr + (num === '' ? '0.' : '.');
  }
  // digits
  if (num.endsWith('%')) return expr;
  if (num.replace('.', '').length >= MAX_DIGITS) return expr;
  const digits = key === '00' ? '00' : key;
  if (num === '0' && !num.includes('.')) {
    if (key === '0' || key === '00') return expr; // no 000
    return expr.slice(0, -1) + digits; // 0 then 7 -> 7
  }
  if (num === '' && key === '00') return expr + '0';
  return expr + digits;
}

export function backspace(expr: string): string {
  return expr === '-' ? '' : expr.slice(0, -1);
}

// ---------------------------------------------------------------- showing numbers

/** 1234567.5 -> "12,34,567.5" (Indian grouping), up to 6 decimals, no trailing zeros. */
export function formatNumber(d: Decimal.Value, maxDecimals = 6): string {
  const v = new D(d).toDecimalPlaces(maxDecimals);
  const negative = v.isNegative() && !v.isZero();
  const [int = '0', frac] = v.abs().toFixed().split('.');
  const grouped =
    int.length > 3
      ? int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + int.slice(-3)
      : int;
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** Makes the typed expression easier to read: "1000+10%" -> "1,000 + 10%". */
export function prettyExpression(expr: string): string {
  const parts = expr.match(/[0-9.]+%?|[+\-×÷]/g) ?? [];
  return parts
    .map((part, i) => {
      if (part === '-' && i === 0) return '-';
      if (part === '-') return ' − ';
      if (isOp(part)) return ` ${part} `;
      const pct = part.endsWith('%') ? '%' : '';
      const [int = '', frac] = part.replace('%', '').split('.');
      const grouped = int ? formatNumber(int, 0) : '0';
      return grouped + (frac === undefined ? '' : `.${frac}`) + pct;
    })
    .join('')
    .trim();
}

/** The plain digits of a result, to continue typing from it ("=" then "+ 5"). */
export function resultToExpr(v: Decimal): string {
  return new D(v).toDecimalPlaces(6).toFixed();
}

// ---------------------------------------------------------------- shop helpers

export interface GstBreakup {
  taxable: string;
  gst: string;
  cgst: string;
  sgst: string;
  total: string;
}

const money = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2);

/** Price WITHOUT tax -> price with tax. */
export function addGst(amount: Decimal.Value, ratePercent: Decimal.Value): GstBreakup {
  const taxable = new D(amount).toDecimalPlaces(2);
  const gst = taxable.times(ratePercent).div(100).toDecimalPlaces(2);
  const cgst = gst.div(2).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  return {
    taxable: money(taxable),
    gst: money(gst),
    cgst: money(cgst),
    sgst: money(gst.minus(cgst)),
    total: money(taxable.plus(gst)),
  };
}

/** Price WITH tax -> the price without tax and the tax inside it. */
export function removeGst(total: Decimal.Value, ratePercent: Decimal.Value): GstBreakup {
  const t = new D(total).toDecimalPlaces(2);
  const taxable = t.times(100).div(new D(100).plus(ratePercent)).toDecimalPlaces(2);
  const gst = t.minus(taxable);
  const cgst = gst.div(2).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  return {
    taxable: money(taxable),
    gst: money(gst),
    cgst: money(cgst),
    sgst: money(gst.minus(cgst)),
    total: money(t),
  };
}

/** What to hand back when the customer pays `given` for a bill of `total` (negative = still to pay). */
export function changeDue(total: Decimal.Value, given: Decimal.Value): string {
  return money(new D(given).minus(total));
}

export { D as CalcDecimal };
