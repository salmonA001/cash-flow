import Decimal from 'decimal.js';

/** Anything with an exact decimal string form: strings, decimal.js / Prisma.Decimal instances. */
export type MoneyInput = string | { toString(): string };

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export function money(value: MoneyInput): Decimal {
  const str = value.toString();
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid money value: "${str}"`);
  }
  return new Decimal(str);
}

export function sum(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

/** Round to currency minor units (2 dp; banker's rounding avoids systematic bias). */
export function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

export function toMoneyString(value: Decimal): string {
  return round2(value).toFixed(2);
}

export { Decimal };
