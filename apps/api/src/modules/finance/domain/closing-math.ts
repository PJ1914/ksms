import Decimal from 'decimal.js';

export interface ClosingInput {
  openingCash: Decimal;
  netCashMovements: Decimal;
  actualCash: Decimal;
}

export interface ClosingCalculation {
  openingCash: Decimal;
  netCashMovements: Decimal;
  expectedCash: Decimal;
  actualCash: Decimal;
  difference: Decimal;
}

/**
 * Pure daily cash closing math:
 * - expectedCash = openingCash + netCashMovements
 * - difference   = actualCash - expectedCash (positive = excess cash, negative = cash short)
 */
export function computeDailyClosing(input: ClosingInput): ClosingCalculation {
  const openingCash = input.openingCash.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const netCashMovements = input.netCashMovements.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const actualCash = input.actualCash.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const expectedCash = openingCash.plus(netCashMovements);
  const difference = actualCash.minus(expectedCash);

  return {
    openingCash,
    netCashMovements,
    expectedCash,
    actualCash,
    difference,
  };
}
