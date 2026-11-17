import { z } from 'zod';
import Decimal from 'decimal.js';

/** A non-negative decimal string with at most `scale` fractional digits, e.g. "125.50". */
export const decimalString = (scale: number) =>
  z
    .string()
    .regex(
      new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`),
      `Must be a decimal with up to ${scale} digits`,
    );

export const moneyString = decimalString(2);
export const quantityString = decimalString(3);

export const uuid = z.uuid();

/** Parse a validated decimal string into a Decimal (never use Number for money). */
export const toDecimal = (value: string): Decimal => new Decimal(value);
