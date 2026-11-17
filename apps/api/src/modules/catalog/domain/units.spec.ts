import Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain.error';
import {
  QuantityRules,
  UnitInfo,
  assertSellableBaseQuantity,
  assertValidBaseUnit,
  deriveStandardFactor,
  fromBaseQuantity,
  resolveConversionFactor,
  snapshotConversion,
  toBaseQuantity,
} from './units';

const d = (v: string | number) => new Decimal(v);
const unit = (
  code: string,
  dimension: UnitInfo['dimension'],
  std: number | null,
  packaging = false,
): UnitInfo => ({
  id: `id-${code}`,
  code,
  dimension,
  isPackaging: packaging,
  standardFactor: std === null ? null : d(std),
});

const KG = unit('KG', 'WEIGHT', 1);
const G = unit('G', 'WEIGHT', 0.001);
const QUINTAL = unit('QUINTAL', 'WEIGHT', 100);
const L = unit('L', 'VOLUME', 1);
const ML = unit('ML', 'VOLUME', 0.001);
const PCS = unit('PCS', 'COUNT', 1);
const DOZEN = unit('DOZEN', 'COUNT', 12);
const BAG = unit('BAG', 'COUNT', null, true);
const CAN = unit('CAN', 'COUNT', null, true);
const CARTON = unit('CARTON', 'COUNT', null, true);

const weight: QuantityRules = { type: 'WEIGHT', allowFractional: true, minSaleIncrement: null };
const volume: QuantityRules = { type: 'VOLUME', allowFractional: true, minSaleIncrement: null };
const count: QuantityRules = { type: 'COUNT', allowFractional: false, minSaleIncrement: null };

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
};

describe('base unit rules', () => {
  it('accepts a standard unit of the same dimension', () => {
    expect(() => assertValidBaseUnit('WEIGHT', KG)).not.toThrow();
    expect(() => assertValidBaseUnit('WEIGHT', G)).not.toThrow();
    expect(() => assertValidBaseUnit('COUNT', PCS)).not.toThrow();
  });
  it('rejects packaging units and other dimensions as a base unit', () => {
    expect(code(() => assertValidBaseUnit('WEIGHT', BAG))).toBe('BASE_UNIT_INVALID');
    expect(code(() => assertValidBaseUnit('WEIGHT', L))).toBe('BASE_UNIT_INVALID');
    expect(code(() => assertValidBaseUnit('COUNT', KG))).toBe('BASE_UNIT_INVALID');
  });
});

describe('standard conversions', () => {
  it('1 KG = 1000 G and 1 G = 0.001 KG', () => {
    expect(deriveStandardFactor(KG, G).toFixed()).toBe('0.001');
    expect(deriveStandardFactor(G, KG).toFixed()).toBe('1000');
    expect(deriveStandardFactor(KG, QUINTAL).toFixed()).toBe('100');
  });
  it('volume and count', () => {
    expect(deriveStandardFactor(L, ML).toFixed()).toBe('0.001');
    expect(deriveStandardFactor(PCS, DOZEN).toFixed()).toBe('12');
  });
  it('refuses weight <-> volume (no density) and packaging', () => {
    expect(code(() => deriveStandardFactor(KG, L))).toBe('UNIT_DIMENSION_MISMATCH');
    expect(code(() => deriveStandardFactor(L, G))).toBe('UNIT_DIMENSION_MISMATCH');
    expect(code(() => deriveStandardFactor(KG, BAG))).toBe('UNIT_DIMENSION_MISMATCH');
  });
});

describe('resolveConversionFactor', () => {
  it('base unit is always 1', () => {
    expect(resolveConversionFactor(weight, KG, KG).toFixed()).toBe('1');
    expect(code(() => resolveConversionFactor(weight, KG, KG, d(2)))).toBe('CONVERSION_MISMATCH');
  });

  it('loose rice: KG base, G derived automatically', () => {
    expect(resolveConversionFactor(weight, KG, G).toFixed()).toBe('0.001');
    expect(resolveConversionFactor(weight, KG, G, d('0.001')).toFixed()).toBe('0.001'); // matching value is fine
  });

  it('rejects a standard-unit factor that contradicts physics', () => {
    expect(code(() => resolveConversionFactor(weight, KG, G, d('0.01')))).toBe(
      'CONVERSION_MISMATCH',
    );
  });

  it('rice bag: 1 BAG = 25 KG needs an explicit factor', () => {
    expect(resolveConversionFactor(weight, KG, BAG, d(25)).toFixed()).toBe('25');
    expect(code(() => resolveConversionFactor(weight, KG, BAG))).toBe('CONVERSION_FACTOR_REQUIRED');
    expect(code(() => resolveConversionFactor(weight, KG, BAG, d(0)))).toBe('CONVERSION_INVALID');
    expect(code(() => resolveConversionFactor(weight, KG, BAG, d(-3)))).toBe('CONVERSION_INVALID');
  });

  it('loose oil: CAN of 15 L; ML derived', () => {
    expect(resolveConversionFactor(volume, L, CAN, d(15)).toFixed()).toBe('15');
    expect(resolveConversionFactor(volume, L, ML).toFixed()).toBe('0.001');
  });

  it('packaged oil: carton of 12 bottles (base PCS)', () => {
    expect(resolveConversionFactor(count, PCS, CARTON, d(12)).toFixed()).toBe('12');
    expect(resolveConversionFactor(count, PCS, DOZEN).toFixed()).toBe('12');
  });

  it('count products need whole-number packs unless fractional is enabled', () => {
    expect(code(() => resolveConversionFactor(count, PCS, CARTON, d('2.5')))).toBe(
      'FRACTIONAL_NOT_ALLOWED',
    );
    expect(
      resolveConversionFactor({ ...count, allowFractional: true }, PCS, CARTON, d('2.5')).toFixed(),
    ).toBe('2.5');
  });

  it('NEVER converts weight to volume (or the reverse) without density', () => {
    expect(code(() => resolveConversionFactor(weight, KG, L))).toBe('UNIT_DIMENSION_MISMATCH');
    expect(code(() => resolveConversionFactor(weight, KG, ML))).toBe('UNIT_DIMENSION_MISMATCH');
    expect(code(() => resolveConversionFactor(volume, L, KG, d(1)))).toBe(
      'UNIT_DIMENSION_MISMATCH',
    );
    expect(code(() => resolveConversionFactor(count, PCS, KG))).toBe('UNIT_DIMENSION_MISMATCH');
  });

  it('works for a gram-based product too (base G, KG = 1000)', () => {
    expect(resolveConversionFactor(weight, G, KG).toFixed()).toBe('1000');
  });
});

describe('toBaseQuantity', () => {
  it('5 bags of 25 kg = 125 kg', () => {
    expect(toBaseQuantity(d(5), d(25)).toFixed()).toBe('125');
  });
  it('500 g of a kg product = 0.5 kg; 2 kg = 2 kg', () => {
    expect(toBaseQuantity(d(500), d('0.001')).toFixed()).toBe('0.5');
    expect(toBaseQuantity(d(2), d(1)).toFixed()).toBe('2');
  });
  it('is exact: 3 x 0.1 has no float drift', () => {
    expect(toBaseQuantity(d('0.3'), d(1)).toFixed()).toBe('0.3');
    expect(toBaseQuantity(d(300), d('0.001')).toFixed()).toBe('0.3');
  });
  it('1 g of a kg product is representable (0.001) but half a gram is NOT silently rounded', () => {
    expect(toBaseQuantity(d(1), d('0.001')).toFixed()).toBe('0.001');
    expect(code(() => toBaseQuantity(d('0.5'), d('0.001')))).toBe('QUANTITY_PRECISION');
  });
  it('rejects zero and negative quantities', () => {
    expect(code(() => toBaseQuantity(d(0), d(1)))).toBe('QUANTITY_INVALID');
    expect(code(() => toBaseQuantity(d(-1), d(1)))).toBe('QUANTITY_INVALID');
  });
  it('round-trips through fromBaseQuantity', () => {
    const base = toBaseQuantity(d(5), d(25));
    expect(fromBaseQuantity(base, d(25)).toFixed()).toBe('5');
  });
});

describe('assertSellableBaseQuantity', () => {
  it('count products sell whole pieces only unless configured', () => {
    expect(() => assertSellableBaseQuantity(count, d(3))).not.toThrow();
    expect(code(() => assertSellableBaseQuantity(count, d('0.5')))).toBe('FRACTIONAL_NOT_ALLOWED');
    expect(() =>
      assertSellableBaseQuantity({ ...count, allowFractional: true }, d('0.5')),
    ).not.toThrow();
  });
  it('half a dozen is fine (6 pieces); half a piece is not', () => {
    expect(() => assertSellableBaseQuantity(count, toBaseQuantity(d('0.5'), d(12)))).not.toThrow();
  });
  it('enforces the minimum sale step (50 g)', () => {
    const rules = { ...weight, minSaleIncrement: d('0.05') };
    expect(() => assertSellableBaseQuantity(rules, d('0.25'))).not.toThrow();
    expect(() => assertSellableBaseQuantity(rules, d('1'))).not.toThrow();
    expect(code(() => assertSellableBaseQuantity(rules, d('0.075')))).toBe('INCREMENT_VIOLATION');
    expect(code(() => assertSellableBaseQuantity(rules, d('0.04')))).toBe('INCREMENT_VIOLATION');
  });
  it('increment check has no float drift (0.3 is a multiple of 0.1)', () => {
    expect(() =>
      assertSellableBaseQuantity({ ...weight, minSaleIncrement: d('0.1') }, d('0.3')),
    ).not.toThrow();
  });
  it('rejects non-positive', () => {
    expect(code(() => assertSellableBaseQuantity(weight, d(0)))).toBe('QUANTITY_INVALID');
  });
});

describe('conversion snapshots', () => {
  it('are frozen copies: later conversion edits cannot alter a stored line', () => {
    let factor = d(25);
    const line = snapshotConversion({ id: 'u1', code: 'BAG' }, factor);
    factor = d(30); // the shop later changes "1 BAG" to 30 kg
    expect(line.factorToBase).toBe('25.000000');
    expect(Object.isFrozen(line)).toBe(true);
    expect(() => {
      (line as { factorToBase: string }).factorToBase = '99';
    }).toThrow();
    expect(factor.toFixed()).toBe('30');
  });

  it('historical purchase math stays correct after the factor changes', () => {
    const oldLine = snapshotConversion({ id: 'u1', code: 'BAG' }, d(25));
    const stockFromOldPurchase = toBaseQuantity(d(5), d(oldLine.factorToBase));
    expect(stockFromOldPurchase.toFixed()).toBe('125'); // not 150, even though a bag is now 30 kg
  });
});
