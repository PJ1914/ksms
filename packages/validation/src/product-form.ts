import { moneyString } from './decimal';

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
}

export interface UnitRow {
  id: string;
  code: string;
}

/** Returns a message for the first problem, or null when the form can be sent. */
export function validateProductForm(input: ProductFormInput): string | null {
  const name = input.name.trim();
  if (name.length < 2) return 'Enter the product name (at least 2 letters).';
  if (name.length > 150) return 'The product name is too long.';
  const price = input.price.trim();
  if (!moneyString.safeParse(price).success) {
    return 'Enter the price in rupees, like 52 or 52.50.';
  }
  return null;
}

/**
 * Builds the POST /products body. The price is sent as a decimal STRING (never a number),
 * for one base unit (1 kg, 1 litre or 1 piece).
 */
export function buildProductPayload(input: ProductFormInput, units: UnitRow[]) {
  const sell = SELL_BY.find((s) => s.key === input.sellBy)!;
  const unit = units.find((u) => u.code === sell.key);
  if (!unit) throw new Error(`Unit ${sell.key} is not set up on the server`);
  return {
    name: input.name.trim(),
    type: sell.type,
    baseUnitId: unit.id,
    prices: [{ unitId: unit.id, price: input.price.trim() }],
  };
}
