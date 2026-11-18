import Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain.error';
import { MAX_AMOUNT, allocateProportionally, money, sum } from '../../../common/utils/money';

/**
 * Money rules for a sale. Pure functions: the server always recomputes totals; amounts sent by the app are never
 * trusted. Money is rounded half-up to the paisa; the bill total is rounded half-up to the whole rupee.
 */

export interface SaleTaxOptions {
  /** Whether the shop is GST-registered. When false, no GST is charged regardless of product settings. */
  gstEnabled?: boolean;
  /** True when the buyer's state code differs from the branch's state code (IGST instead of CGST + SGST). */
  interState?: boolean;
}

export interface SaleLineInput {
  /** Price of the line before any discount (quantity x price, from the catalogue or an allowed override). */
  gross: Decimal;
  /** Discount typed on this line, in rupees. */
  lineDiscount: Decimal;
  /** Effective GST rate percent for this line (0 when non-taxable or shop is not GST-registered). */
  taxRatePercent?: Decimal;
  /** Effective tax mode for this line ('INCLUSIVE' or 'EXCLUSIVE'; defaults to 'INCLUSIVE'). */
  taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
}

export interface SaleLineFigures {
  gross: Decimal;
  lineDiscount: Decimal;
  /** This line's share of the bill-level discount. */
  billDiscountShare: Decimal;
  /** lineDiscount + billDiscountShare. */
  discount: Decimal;
  /** Gross minus discount (before adding exclusive tax). */
  afterDiscount: Decimal;
  taxRatePercent: Decimal;
  taxMode: 'INCLUSIVE' | 'EXCLUSIVE';
  /** Taxable value before GST (equals afterDiscount when tax is 0 or EXCLUSIVE; extracted when INCLUSIVE). */
  taxableValue: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  /** cgst + sgst + igst. */
  tax: Decimal;
  /** What the customer pays for this line: taxableValue + tax. */
  net: Decimal;
}

export interface SaleFigures {
  lines: SaleLineFigures[];
  subtotal: Decimal;
  discountTotal: Decimal;
  taxableTotal: Decimal;
  cgstTotal: Decimal;
  sgstTotal: Decimal;
  igstTotal: Decimal;
  taxTotal: Decimal;
  /** Sum of the lines (net), before rounding to the rupee. */
  exactTotal: Decimal;
  /** total - exactTotal, between -0.50 and +0.50. */
  roundOff: Decimal;
  total: Decimal;
  /** Discount as a percentage of the subtotal (for the cashier discount limit). */
  discountPercent: Decimal;
}

export function computeSale(
  inputs: SaleLineInput[],
  billDiscount: Decimal,
  taxOpts: SaleTaxOptions = {},
): SaleFigures {
  if (inputs.length === 0) throw new DomainError('SALE_EMPTY', 'Add at least one item');
  inputs.forEach((l, i) => {
    if (l.lineDiscount.lt(0))
      throw new DomainError('DISCOUNT_INVALID', 'A discount cannot be negative', { line: i + 1 });
    if (l.lineDiscount.gt(l.gross)) {
      throw new DomainError(
        'DISCOUNT_EXCEEDS_LINE',
        'A discount cannot be more than the line amount',
        { line: i + 1 },
      );
    }
    const rate = l.taxRatePercent ?? new Decimal(0);
    if (rate.lt(0) || rate.gt(100)) {
      throw new DomainError('TAX_RATE_INVALID', 'GST rate must be between 0 and 100%', {
        line: i + 1,
      });
    }
  });
  if (billDiscount.lt(0))
    throw new DomainError('DISCOUNT_INVALID', 'A discount cannot be negative');

  const afterLine = inputs.map((l) => l.gross.minus(l.lineDiscount));
  const left = sum(afterLine);
  if (billDiscount.gt(left)) {
    throw new DomainError(
      'DISCOUNT_EXCEEDS_BILL',
      'The bill discount cannot be more than the bill',
      {
        maximum: left.toFixed(2),
      },
    );
  }
  const shares = allocateProportionally(billDiscount, afterLine, {
    code: 'DISCOUNT_EXCEEDS_BILL',
    message: 'There is nothing left on the bill to discount',
  });

  const gstOn = taxOpts.gstEnabled === true;
  const interState = taxOpts.interState === true;

  const lines: SaleLineFigures[] = inputs.map((l, i) => {
    const share = shares[i]!;
    const discount = l.lineDiscount.plus(share);
    const afterDiscount = l.gross.minus(discount);
    const taxMode: 'INCLUSIVE' | 'EXCLUSIVE' = l.taxMode ?? 'INCLUSIVE';
    const taxRatePercent = gstOn ? (l.taxRatePercent ?? new Decimal(0)) : new Decimal(0);

    let taxableValue = afterDiscount;
    let tax = new Decimal(0);
    if (taxRatePercent.gt(0) && afterDiscount.gt(0)) {
      if (taxMode === 'INCLUSIVE') {
        tax = money(afterDiscount.mul(taxRatePercent).div(new Decimal(100).plus(taxRatePercent)));
        taxableValue = afterDiscount.minus(tax);
      } else {
        taxableValue = afterDiscount;
        tax = money(taxableValue.mul(taxRatePercent).div(100));
      }
    }

    let cgst = new Decimal(0);
    let sgst = new Decimal(0);
    let igst = new Decimal(0);
    if (tax.gt(0)) {
      if (interState) {
        igst = tax;
      } else {
        cgst = tax.div(2).toDecimalPlaces(2, Decimal.ROUND_FLOOR);
        sgst = tax.minus(cgst);
      }
    }

    return {
      gross: l.gross,
      lineDiscount: l.lineDiscount,
      billDiscountShare: share,
      discount,
      afterDiscount,
      taxRatePercent,
      taxMode,
      taxableValue,
      cgst,
      sgst,
      igst,
      tax,
      net: taxableValue.plus(tax),
    };
  });

  const subtotal = sum(lines.map((l) => l.gross));
  const discountTotal = sum(lines.map((l) => l.discount));
  const taxableTotal = sum(lines.map((l) => l.taxableValue));
  const cgstTotal = sum(lines.map((l) => l.cgst));
  const sgstTotal = sum(lines.map((l) => l.sgst));
  const igstTotal = sum(lines.map((l) => l.igst));
  const taxTotal = sum(lines.map((l) => l.tax));
  const exactTotal = sum(lines.map((l) => l.net));
  const total = exactTotal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (total.gt(MAX_AMOUNT))
    throw new DomainError('AMOUNT_TOO_LARGE', 'The bill total is too large');

  return {
    lines,
    subtotal,
    discountTotal,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    taxTotal,
    exactTotal,
    roundOff: total.minus(exactTotal),
    total,
    discountPercent: subtotal.isZero() ? new Decimal(0) : discountTotal.mul(100).div(subtotal),
  };
}

/** Price of a line when the cashier is allowed to type the unit price: quantity x price, to the paisa. */
export function grossFromUnitPrice(quantity: Decimal, unitPrice: Decimal): Decimal {
  return money(quantity.mul(unitPrice));
}

/** The price per selling unit to show on the bill (the line amount may come from a pack price, e.g. 500 g). */
export function effectiveUnitPrice(gross: Decimal, quantity: Decimal): Decimal {
  return money(gross.div(quantity));
}

export interface PaymentInput {
  method: string;
  amount: Decimal;
}

/**
 * How a bill is settled: what was paid now and what goes on the customer's account (credit).
 * Paying more than the bill is refused: change for cash is worked out at the counter, the server records only
 * what was applied to the bill.
 */
export function settle(
  total: Decimal,
  payments: PaymentInput[],
): { paid: Decimal; credit: Decimal } {
  payments.forEach((p, i) => {
    if (p.amount.lte(0)) {
      throw new DomainError('PAYMENT_AMOUNT_INVALID', 'Each payment must be more than zero', {
        payment: i + 1,
      });
    }
  });
  const paid = sum(payments.map((p) => p.amount));
  if (paid.gt(total)) {
    throw new DomainError('PAYMENT_EXCEEDS_TOTAL', 'The payments add up to more than the bill', {
      total: total.toFixed(2),
      paid: paid.toFixed(2),
    });
  }
  return { paid, credit: total.minus(paid) };
}
