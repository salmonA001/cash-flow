import { Decimal, money, MoneyInput, round2 } from './money';

export interface RateLookup {
  /** Returns the rate where 1 `from` = rate `to`, for the given date. */
  (from: string, to: string, date: Date): Decimal | undefined;
}

export class MissingExchangeRateError extends Error {
  constructor(from: string, to: string, date: Date) {
    super(`No exchange rate ${from}->${to} on or before ${date.toISOString().slice(0, 10)}`);
  }
}

export interface ConvertedAmount {
  originalAmount: string;
  originalCurrency: string;
  amount: Decimal;
  currency: string;
  rate: string;
  rateDate: string;
}

/** Converts an amount, preserving the original values and the rate used (auditable). */
export function convert(
  amount: MoneyInput,
  from: string,
  to: string,
  date: Date,
  lookup: RateLookup,
): ConvertedAmount {
  const original = money(amount);
  const rate = from === to ? new Decimal(1) : lookup(from, to, date);
  if (!rate) throw new MissingExchangeRateError(from, to, date);
  return {
    originalAmount: original.toFixed(2),
    originalCurrency: from,
    amount: round2(original.times(rate)),
    currency: to,
    rate: rate.toString(),
    rateDate: date.toISOString().slice(0, 10),
  };
}

export interface StoredRate {
  base: string;
  quote: string;
  rate: MoneyInput;
  rateDate: Date;
}

/**
 * Builds a lookup that uses the most recent rate on or before the requested date.
 * Inverse pairs are derived from stored rates when the direct pair is missing.
 */
export function buildRateLookup(rates: StoredRate[]): RateLookup {
  const byPair = new Map<string, { date: number; rate: Decimal }[]>();
  const add = (base: string, quote: string, date: number, rate: Decimal) => {
    const key = `${base}/${quote}`;
    const list = byPair.get(key) ?? [];
    list.push({ date, rate });
    byPair.set(key, list);
  };
  for (const r of rates) {
    const rate = money(r.rate);
    add(r.base, r.quote, r.rateDate.getTime(), rate);
    add(r.quote, r.base, r.rateDate.getTime(), new Decimal(1).dividedBy(rate));
  }
  for (const list of byPair.values()) list.sort((a, b) => b.date - a.date);

  return (from, to, date) => {
    const list = byPair.get(`${from}/${to}`);
    return list?.find((r) => r.date <= date.getTime())?.rate;
  };
}
