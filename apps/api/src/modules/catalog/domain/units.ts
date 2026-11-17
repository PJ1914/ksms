import Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain.error';

/**
 * Unit conversion and quantity rules. Pure functions: no database, no framework, no JS floats.
 * Every stock quantity is stored in the product's canonical BASE unit with at most 3 decimals.
 */

export type Dimension = 'WEIGHT' | 'VOLUME' | 'COUNT';

export interface UnitInfo {
  id: string;
  code: string;
  dimension: Dimension;
  /** Container units (BAG, CARTON, CAN...) whose content differs per product. */
  isPackaging: boolean;
  /** Size relative to the dimension's canonical unit (KG, L, PCS); null for packaging units. */
  standardFactor: Decimal | null;
}

export interface QuantityRules {
  type: Dimension;
  allowFractional: boolean;
  /** Smallest sellable step in base units, or null. */
  minSaleIncrement: Decimal | null;
}

export const QTY_SCALE = 3;
export const FACTOR_SCALE = 6;
export const MONEY_SCALE = 2;

const bad = (code: string, message: string, details?: unknown): never => {
  throw new DomainError(code, message, details);
};

/** A base unit must be a standard (non-packaging) unit of the product's own dimension. */
export function assertValidBaseUnit(type: Dimension, base: UnitInfo): void {
  if (base.isPackaging || base.dimension !== type) {
    bad(
      'BASE_UNIT_INVALID',
      `A ${type.toLowerCase()} product needs a standard ${type.toLowerCase()} unit as its base unit (not ${base.code})`,
    );
  }
}

/** Factor that converts `unit` into `base` for two standard units of the same dimension (e.g. G -> KG = 0.001). */
export function deriveStandardFactor(base: UnitInfo, unit: UnitInfo): Decimal {
  if (unit.dimension !== base.dimension || unit.isPackaging || base.isPackaging) {
    return bad(
      'UNIT_DIMENSION_MISMATCH',
      `${unit.code} cannot be converted to ${base.code} automatically`,
    );
  }
  if (!unit.standardFactor || !base.standardFactor) {
    return bad('UNIT_DIMENSION_MISMATCH', `${unit.code} has no standard size`);
  }
  const factor = unit.standardFactor.div(base.standardFactor);
  if (factor.decimalPlaces() > FACTOR_SCALE) {
    return bad(
      'CONVERSION_NOT_REPRESENTABLE',
      `${unit.code} to ${base.code} needs more than ${FACTOR_SCALE} decimals`,
    );
  }
  return factor;
}

/**
 * Decides the factor (base units per 1 of `unit`) for a product's unit.
 *  - the base unit itself is always 1;
 *  - standard units of the same dimension are derived and a supplied factor must agree;
 *  - packaging units REQUIRE an explicit factor (1 BAG = 25 KG);
 *  - units of another dimension are refused: weight and volume are never converted without density.
 */
export function resolveConversionFactor(
  product: QuantityRules,
  base: UnitInfo,
  unit: UnitInfo,
  supplied?: Decimal,
): Decimal {
  if (unit.id === base.id) {
    if (supplied && !supplied.equals(1))
      bad('CONVERSION_MISMATCH', 'The base unit always equals 1');
    return new Decimal(1);
  }

  if (unit.isPackaging) {
    if (!supplied)
      return bad(
        'CONVERSION_FACTOR_REQUIRED',
        `Say how much one ${unit.code} holds (e.g. 1 ${unit.code} = 25 ${base.code})`,
      );
    if (supplied.lte(0))
      return bad('CONVERSION_INVALID', 'A conversion factor must be greater than zero');
    if (supplied.decimalPlaces() > FACTOR_SCALE)
      return bad('CONVERSION_NOT_REPRESENTABLE', `At most ${FACTOR_SCALE} decimals`);
    if (product.type === 'COUNT' && !product.allowFractional && !supplied.isInteger()) {
      return bad(
        'FRACTIONAL_NOT_ALLOWED',
        `One ${unit.code} must hold a whole number of ${base.code}`,
      );
    }
    return supplied;
  }

  if (unit.dimension !== product.type) {
    return bad(
      'UNIT_DIMENSION_MISMATCH',
      `${unit.code} is a ${unit.dimension.toLowerCase()} unit but this is a ${product.type.toLowerCase()} product; weight and volume are never converted without density`,
    );
  }
  const derived = deriveStandardFactor(base, unit);
  if (supplied && !supplied.equals(derived)) {
    return bad(
      'CONVERSION_MISMATCH',
      `1 ${unit.code} is always ${derived.toFixed()} ${base.code}`,
      { expected: derived.toFixed() },
    );
  }
  return derived;
}

/** Quantity in a selling/purchase unit -> base units. Refuses (never rounds) results finer than 3 decimals. */
export function toBaseQuantity(quantity: Decimal, factorToBase: Decimal): Decimal {
  if (quantity.lte(0)) bad('QUANTITY_INVALID', 'Quantity must be greater than zero');
  const base = quantity.mul(factorToBase);
  if (base.decimalPlaces() > QTY_SCALE) {
    bad(
      'QUANTITY_PRECISION',
      `Quantity is finer than ${new Decimal(10).pow(-QTY_SCALE).toFixed()} of the base unit`,
      { baseQuantity: base.toFixed() },
    );
  }
  return base;
}

export function fromBaseQuantity(baseQuantity: Decimal, factorToBase: Decimal): Decimal {
  return baseQuantity.div(factorToBase);
}

/** Whole-number and minimum-step rules for a quantity that is about to be SOLD (expressed in base units). */
/**
 * Rules for a quantity entering or leaving STOCK (receipts, adjustments, write-offs): positive, and whole
 * pieces for piece-counted products. The minimum sale step does not apply to stock (a bag holds 25 kg).
 */
export function assertStockBaseQuantity(rules: QuantityRules, baseQuantity: Decimal): void {
  if (baseQuantity.lte(0)) bad('QUANTITY_INVALID', 'Quantity must be greater than zero');
  if (rules.type === 'COUNT' && !rules.allowFractional && !baseQuantity.isInteger()) {
    bad('FRACTIONAL_NOT_ALLOWED', 'This item is counted in whole pieces only');
  }
}

export function assertSellableBaseQuantity(rules: QuantityRules, baseQuantity: Decimal): void {
  if (baseQuantity.lte(0)) bad('QUANTITY_INVALID', 'Quantity must be greater than zero');
  if (rules.type === 'COUNT' && !rules.allowFractional && !baseQuantity.isInteger()) {
    bad('FRACTIONAL_NOT_ALLOWED', 'This item is sold in whole pieces only');
  }
  if (rules.minSaleIncrement && !baseQuantity.mod(rules.minSaleIncrement).isZero()) {
    bad(
      'INCREMENT_VIOLATION',
      `Quantity must be a multiple of ${rules.minSaleIncrement.toFixed()}`,
      {
        increment: rules.minSaleIncrement.toFixed(),
      },
    );
  }
}

/**
 * Immutable copy of a conversion to store on a transaction line. Later edits to the product's
 * conversions must never change a line that was already written.
 */
export function snapshotConversion(unit: { id: string; code: string }, factorToBase: Decimal) {
  return Object.freeze({
    unitId: unit.id,
    unitCode: unit.code,
    factorToBase: factorToBase.toFixed(FACTOR_SCALE),
  });
}
