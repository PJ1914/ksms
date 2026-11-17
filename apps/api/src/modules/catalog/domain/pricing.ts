import Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain.error';
import { MONEY_SCALE, toBaseQuantity } from './units';

export interface PricePoint {
  unitId: string;
  /** How many of `unitId` the price is for (500 for "500 G = 30"). */
  quantity: Decimal;
  price: Decimal;
}

export interface Quote {
  /** Amount payable for the requested quantity, rounded half-up to paise. */
  amount: Decimal;
  source: 'EXACT' | 'UNIT_PRICE' | 'DERIVED_FROM_BASE';
  /** True when rounding to paise changed the exact value. */
  rounded: boolean;
}

const bad = (code: string, message: string): never => {
  throw new DomainError(code, message);
};

/**
 * Price for `quantity` of `unitId`, using the shop's configured price points in this order:
 *  1. EXACT: a price point for exactly this unit and quantity ("500 G = 30.00");
 *  2. UNIT_PRICE: the price of 1 of this unit, multiplied ("1 KG = 58" -> 2 KG = 116);
 *  3. DERIVED_FROM_BASE: the price of 1 base unit, scaled by the conversion (1 KG = 58 -> 250 G = 14.50).
 * Never guesses: with no usable price point it fails with PRICE_NOT_CONFIGURED.
 */
export function priceForQuantity(
  points: PricePoint[],
  baseUnitId: string,
  factorsByUnit: ReadonlyMap<string, Decimal>,
  unitId: string,
  quantity: Decimal,
): Quote {
  if (quantity.lte(0)) bad('QUANTITY_INVALID', 'Quantity must be greater than zero');
  const factor = factorsByUnit.get(unitId);
  if (!factor) bad('UNIT_NOT_CONFIGURED', 'This unit is not set up for the product');

  const finish = (raw: Decimal, source: Quote['source']): Quote => {
    const amount = raw.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
    return { amount, source, rounded: !amount.equals(raw) };
  };

  const exact = points.find((p) => p.unitId === unitId && p.quantity.equals(quantity));
  if (exact) return finish(exact.price, 'EXACT');

  const perUnit = points.find((p) => p.unitId === unitId && p.quantity.equals(1));
  if (perUnit) return finish(perUnit.price.mul(quantity), 'UNIT_PRICE');

  const perBase = points.find((p) => p.unitId === baseUnitId && p.quantity.equals(1));
  if (perBase) {
    const baseQuantity = toBaseQuantity(quantity, factor!);
    return finish(perBase.price.mul(baseQuantity), 'DERIVED_FROM_BASE');
  }
  return bad('PRICE_NOT_CONFIGURED', 'No selling price is configured for this product');
}
