import Decimal from 'decimal.js';
import { moneyString, quantityString } from './decimal';

/** The three ways a kirana product is sold in this simple form. */
export const SELL_BY = [
  { key: 'KG', label: 'By weight (kg)', type: 'WEIGHT' },
  { key: 'L', label: 'By volume (litre)', type: 'VOLUME' },
  { key: 'PCS', label: 'By piece', type: 'COUNT' },
] as const;

export type SellBy = (typeof SELL_BY)[number]['key'];

export interface ProductFormInput {
  name: string;
  sellBy: SellBy;
  price: string;
  mrp?: string;
  barcode?: string;
  categoryId?: string;
  autoCategorize?: boolean;
  openingQuantity?: string;
  openingCost?: string;
  isTaxable?: boolean;
  gstRatePercent?: string;
  hsnCode?: string;
}

export interface UnitRow {
  id: string;
  code: string;
}

const HSN_RE = /^\d{4,8}$/;
const RATE_RE = /^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/;
const BARCODE_RE = /^[A-Za-z0-9._-]{3,64}$/;

/** Returns a message for the first problem, or null when the form can be sent. */
export function validateProductForm(input: ProductFormInput): string | null {
  const name = input.name.trim();
  if (name.length < 2) return 'Enter the product name (at least 2 letters).';
  if (name.length > 150) return 'The product name is too long.';
  const price = input.price.trim();
  if (!moneyString.safeParse(price).success) {
    return 'Enter the price in rupees, like 52 or 52.50.';
  }
  const mrp = (input.mrp ?? '').trim();
  if (mrp !== '' && !moneyString.safeParse(mrp).success) {
    return 'Enter the MRP in rupees, like 60 or 60.00, or leave it empty.';
  }
  const barcode = (input.barcode ?? '').trim();
  if (barcode !== '' && !BARCODE_RE.test(barcode)) {
    return 'Barcode must be 3 to 64 letters, digits, or . _ - (or leave it empty).';
  }
  const hsn = (input.hsnCode ?? '').trim();
  if (hsn !== '' && !HSN_RE.test(hsn)) {
    return 'Enter the HSN code as 4 to 8 digits, like 1006, or leave it empty.';
  }
  const rate = (input.gstRatePercent ?? '').trim();
  if (input.isTaxable && !RATE_RE.test(rate)) {
    return 'Enter the GST rate percent, like 5, 12 or 18.';
  }
  const qty = (input.openingQuantity ?? '').trim();
  if (qty !== '') {
    if (!quantityString.safeParse(qty).success || new Decimal(qty).lte(0)) {
      return 'Opening stock must be more than zero (up to 3 decimals), or leave it empty.';
    }
  }
  const cost = (input.openingCost ?? '').trim();
  if (cost !== '' && !moneyString.safeParse(cost).success) {
    return 'Cost price must be in rupees, like 40 or 40.50, or leave it empty.';
  }
  return null;
}

/**
 * Builds the optional POST /inventory/opening-stock body from the Add Product form.
 * Returns null when no opening quantity was entered.
 */
export function buildOpeningStockPayload(
  productId: string,
  unitId: string,
  input: Pick<ProductFormInput, 'openingQuantity' | 'openingCost'>,
  supplierId?: string,
) {
  const qty = (input.openingQuantity ?? '').trim();
  if (!qty) return null;
  const cost = (input.openingCost ?? '').trim();
  return {
    productId,
    unitId,
    quantity: qty,
    unitCost: cost || '0',
    ...(supplierId ? { supplierId } : {}),
  };
}

/**
 * Builds the POST /products body. The price is sent as a decimal STRING (never a number),
 * for one base unit (1 kg, 1 litre or 1 piece).
 */
export function buildProductPayload(input: ProductFormInput, units: UnitRow[]) {
  const sell = SELL_BY.find((s) => s.key === input.sellBy)!;
  const unit = units.find((u) => u.code === sell.key);
  if (!unit) throw new Error(`Unit ${sell.key} is not set up on the server`);
  const mrp = (input.mrp ?? '').trim();
  const barcode = (input.barcode ?? '').trim();
  const categoryId = (input.categoryId ?? '').trim();
  const hsn = (input.hsnCode ?? '').trim();
  const rate = (input.gstRatePercent ?? '').trim();
  return {
    name: input.name.trim(),
    type: sell.type,
    baseUnitId: unit.id,
    prices: [{ unitId: unit.id, price: input.price.trim() }],
    ...(categoryId ? { categoryId } : input.autoCategorize ? { autoCategorize: true } : {}),
    ...(mrp ? { mrp } : {}),
    ...(barcode ? { barcodes: [barcode] } : {}),
    ...(input.isTaxable ? { isTaxable: true, gstRatePercent: rate } : {}),
    ...(hsn ? { hsnCode: hsn } : {}),
  };
}
