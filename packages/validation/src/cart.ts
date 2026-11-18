import Decimal from 'decimal.js';
import { moneyString, quantityString } from './decimal';

/**
 * The counter's cart and everything the app sends to checkout. Pure functions (no screen code) so the rules are
 * unit-tested here and the API tests drive the real server with the SAME builders the phone uses.
 *
 * The cart holds only what the cashier typed. Prices, discounts' effect, rounding, tax and stock are decided by the
 * server (the preview and checkout endpoints use the same code); the app never works out money itself.
 */

export interface CartLine {
  /** Stable id of this line in the cart (for editing and removing). */
  key: string;
  productId: string;
  name: string;
  unitId: string;
  unitCode: string;
  /** Decimal string in the selling unit, e.g. "1.5". */
  quantity: string;
  /** Rupees off this line, "" for none. */
  discount: string;
  /** A price typed at the counter instead of the catalogue price, "" for none (needs permission). */
  unitPrice: string;
}

export interface Cart {
  customerId: string | null;
  customerName: string | null;
  /** Rupees off the whole bill, "" for none. */
  billDiscount: string;
  /** The held bill this cart was resumed from (closed at checkout). */
  heldBillId: string | null;
  lines: CartLine[];
}

export const emptyCart = (): Cart => ({
  customerId: null,
  customerName: null,
  billDiscount: '',
  heldBillId: null,
  lines: [],
});

export const cartIsEmpty = (cart: Cart): boolean => cart.lines.length === 0;

type NewLine = Pick<CartLine, 'productId' | 'name' | 'unitId' | 'unitCode' | 'quantity'> &
  Partial<Pick<CartLine, 'discount' | 'unitPrice'>>;

/** Adds an item. The same product in the same unit (with no special price or discount) is added to its line. */
export function addToCart(cart: Cart, line: NewLine, newKey: () => string): Cart {
  const discount = line.discount ?? '';
  const unitPrice = line.unitPrice ?? '';
  const same = cart.lines.find(
    (l) =>
      l.productId === line.productId &&
      l.unitId === line.unitId &&
      l.unitPrice === unitPrice &&
      l.discount === '' &&
      discount === '',
  );
  if (
    same &&
    quantityString.safeParse(same.quantity).success &&
    quantityString.safeParse(line.quantity).success
  ) {
    return updateLine(cart, same.key, {
      quantity: new Decimal(same.quantity).plus(line.quantity).toFixed(),
    });
  }
  return {
    ...cart,
    lines: [...cart.lines, { ...line, key: newKey(), discount, unitPrice }],
  };
}

export function updateLine(
  cart: Cart,
  key: string,
  patch: Partial<Pick<CartLine, 'quantity' | 'discount' | 'unitPrice'>>,
): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) };
}

export const removeLine = (cart: Cart, key: string): Cart => ({
  ...cart,
  lines: cart.lines.filter((l) => l.key !== key),
});

export const setCustomer = (cart: Cart, id: string | null, name: string | null): Cart => ({
  ...cart,
  customerId: id,
  customerName: id ? name : null,
});

export const setBillDiscount = (cart: Cart, value: string): Cart => ({
  ...cart,
  billDiscount: value,
});

/** A message for the first thing wrong with what was typed, or null when the cart can be priced. */
export function validateCart(cart: Cart): string | null {
  if (cart.lines.length === 0) return 'Add at least one item.';
  for (const l of cart.lines) {
    if (
      !quantityString.safeParse(l.quantity.trim()).success ||
      new Decimal(l.quantity.trim()).lte(0)
    ) {
      return `Enter a quantity for ${l.name} (up to 3 decimals).`;
    }
    if (l.discount.trim() !== '' && !moneyString.safeParse(l.discount.trim()).success) {
      return `Enter the discount for ${l.name} in rupees, like 5 or 5.50.`;
    }
    if (l.unitPrice.trim() !== '' && !moneyString.safeParse(l.unitPrice.trim()).success) {
      return `Enter the price for ${l.name} in rupees, like 52 or 52.50.`;
    }
  }
  if (cart.billDiscount.trim() !== '' && !moneyString.safeParse(cart.billDiscount.trim()).success) {
    return 'Enter the bill discount in rupees, like 10 or 10.50.';
  }
  return null;
}

// ---------------------------------------------------------------- what is sent to the server

export interface SaleItemBody {
  productId: string;
  unitId: string;
  quantity: string;
  discount?: string;
  unitPrice?: string;
}

export interface PaymentEntry {
  method: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
  amount: string;
  referenceNo?: string;
}

function itemsOf(cart: Cart): SaleItemBody[] {
  return cart.lines.map((l) => ({
    productId: l.productId,
    unitId: l.unitId,
    quantity: l.quantity.trim(),
    ...(l.discount.trim() ? { discount: l.discount.trim() } : {}),
    ...(l.unitPrice.trim() ? { unitPrice: l.unitPrice.trim() } : {}),
  }));
}

/** Body of POST /sales/preview. */
export function previewBody(cart: Cart, payments: PaymentEntry[] = []) {
  return {
    ...(cart.customerId ? { customerId: cart.customerId } : {}),
    items: itemsOf(cart),
    ...(cart.billDiscount.trim() ? { billDiscount: cart.billDiscount.trim() } : {}),
    ...(payments.length ? { payments: cleanPayments(payments) } : {}),
  };
}

/** Body of POST /sales (checkout). Payments are what was received now; the rest goes on the customer's account. */
export function saleBody(cart: Cart, payments: PaymentEntry[], overrideCreditLimit = false) {
  return {
    ...(cart.customerId ? { customerId: cart.customerId } : {}),
    items: itemsOf(cart),
    ...(cart.billDiscount.trim() ? { billDiscount: cart.billDiscount.trim() } : {}),
    payments: cleanPayments(payments),
    ...(overrideCreditLimit ? { overrideCreditLimit: true } : {}),
    ...(cart.heldBillId ? { heldBillId: cart.heldBillId } : {}),
  };
}

function cleanPayments(payments: PaymentEntry[]) {
  return payments
    .filter((p) => p.amount.trim() !== '' && new Decimal(p.amount.trim()).gt(0))
    .map((p) => ({
      method: p.method,
      amount: p.amount.trim(),
      ...(p.referenceNo?.trim() ? { referenceNo: p.referenceNo.trim() } : {}),
    }));
}

/** A message when a typed payment is not a valid amount, else null. */
export function validatePayments(payments: PaymentEntry[]): string | null {
  for (const p of payments) {
    const a = p.amount.trim();
    if (a !== '' && !moneyString.safeParse(a).success)
      return 'Enter payment amounts in rupees, like 100 or 100.50.';
  }
  return null;
}

/** What is still unpaid after the payments: `total - sum(payments)`, never below zero, as a 2-decimal string. */
export function amountLeft(total: string, payments: PaymentEntry[]): string {
  const paid = payments.reduce((a, p) => {
    const x = p.amount.trim();
    return a.plus(moneyString.safeParse(x).success ? new Decimal(x) : 0);
  }, new Decimal(0));
  return Decimal.max(new Decimal(total).minus(paid), 0).toFixed(2);
}

// ---------------------------------------------------------------- double-tap protection

/** The same JSON with its keys in a fixed order, so equal requests give equal text. */
export function fingerprint(body: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify(sort(body));
}

export interface IdempotencyHandle {
  key: string;
  fingerprint: string;
}

/**
 * The Idempotency-Key for a request. The SAME key is reused while the request is unchanged (a retry after a bad
 * signal must not sell twice), and a NEW key is made as soon as anything in it changed (the server refuses one key
 * with two different bodies).
 */
export function idempotencyFor(
  previous: IdempotencyHandle | null,
  body: unknown,
  newKey: () => string,
): IdempotencyHandle {
  const fp = fingerprint(body);
  return previous && previous.fingerprint === fp ? previous : { key: newKey(), fingerprint: fp };
}

// ---------------------------------------------------------------- held bills

/** Reads a parked cart back, refusing anything that is not a cart (a held bill is just stored JSON). */
export function parseHeldCart(payload: unknown): Cart | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Partial<Cart>;
  if (!Array.isArray(p.lines)) return null;
  const lines: CartLine[] = [];
  for (const raw of p.lines) {
    const l = raw as Partial<CartLine>;
    if (
      typeof l?.key !== 'string' ||
      typeof l.productId !== 'string' ||
      typeof l.unitId !== 'string' ||
      typeof l.quantity !== 'string'
    ) {
      return null;
    }
    lines.push({
      key: l.key,
      productId: l.productId,
      name: String(l.name ?? ''),
      unitId: l.unitId,
      unitCode: String(l.unitCode ?? ''),
      quantity: l.quantity,
      discount: typeof l.discount === 'string' ? l.discount : '',
      unitPrice: typeof l.unitPrice === 'string' ? l.unitPrice : '',
    });
  }
  return {
    customerId: typeof p.customerId === 'string' ? p.customerId : null,
    customerName: typeof p.customerName === 'string' ? p.customerName : null,
    billDiscount: typeof p.billDiscount === 'string' ? p.billDiscount : '',
    heldBillId: null,
    lines,
  };
}
