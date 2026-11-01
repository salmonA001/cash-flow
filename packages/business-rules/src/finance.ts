import { Decimal, money, MoneyInput, round2 } from './money';

export const CHANNELS = ['SHOPIFY_POD', 'AMAZON_MERCH', 'DIGITAL'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * A single base-currency financial fact. Amounts are non-negative magnitudes and the kind
 * decides whether it adds to or subtracts from contribution — except ROYALTY, which Amazon
 * reports net of returns and may therefore be negative for a period.
 * Payouts are deliberately NOT a ledger kind: they move cash for revenue already recognized.
 */
export type LedgerKind =
  | 'GROSS_SALES'
  | 'REFUND'
  | 'ROYALTY'
  | 'PRODUCTION_COST'
  | 'SHIPPING_COST'
  | 'PAYMENT_FEE'
  | 'PLATFORM_FEE'
  | 'ADVERTISING'
  | 'OPERATING';

export interface LedgerLine {
  /** null = shared cost, allocated across channels by revenue share. */
  channel: Channel | null;
  kind: LedgerKind;
  amount: MoneyInput;
}

const ALLOWED: Record<LedgerKind, readonly (Channel | null)[]> = {
  GROSS_SALES: ['SHOPIFY_POD', 'DIGITAL'],
  REFUND: ['SHOPIFY_POD', 'DIGITAL'],
  ROYALTY: ['AMAZON_MERCH'],
  PRODUCTION_COST: ['SHOPIFY_POD'],
  SHIPPING_COST: ['SHOPIFY_POD'],
  PAYMENT_FEE: ['SHOPIFY_POD', 'DIGITAL'],
  PLATFORM_FEE: ['SHOPIFY_POD'],
  ADVERTISING: ['SHOPIFY_POD', 'AMAZON_MERCH', 'DIGITAL', null],
  OPERATING: ['SHOPIFY_POD', 'AMAZON_MERCH', 'DIGITAL', null],
};

export interface ChannelContribution {
  channel: Channel;
  grossSales: string;
  refunds: string;
  royalties: string;
  productionCosts: string;
  shippingCosts: string;
  paymentFees: string;
  platformFees: string;
  advertising: string;
  /** Channel-specific operating costs plus this channel's share of shared costs. */
  allocatedOperating: string;
  /** Sales net of refunds (Shopify/Digital) or royalties (Amazon) — the allocation base. */
  netRevenue: string;
  netContribution: string;
}

export interface ContributionReport {
  channels: ChannelContribution[];
  sharedCosts: string;
  /** Shared costs that could not be allocated because no channel had revenue. */
  unallocatedSharedCosts: string;
  totalNetContribution: string;
}

type Totals = Record<LedgerKind, Decimal>;

function emptyTotals(): Totals {
  const zero = () => new Decimal(0);
  return {
    GROSS_SALES: zero(), REFUND: zero(), ROYALTY: zero(), PRODUCTION_COST: zero(), SHIPPING_COST: zero(),
    PAYMENT_FEE: zero(), PLATFORM_FEE: zero(), ADVERTISING: zero(), OPERATING: zero(),
  };
}

/**
 * Splits `amount` across keys in proportion to `weights`, rounded to cents.
 * The rounding remainder goes to the largest weight so parts always sum to `amount`.
 */
export function allocateProportionally<K extends string>(
  amount: MoneyInput,
  weights: Record<K, Decimal>,
): Record<K, Decimal> {
  const total = money(amount);
  const keys = Object.keys(weights) as K[];
  const weightSum = keys.reduce((acc, k) => acc.plus(weights[k]), new Decimal(0));
  if (weightSum.lte(0)) throw new Error('Cannot allocate against zero total weight');
  if (keys.some((k) => weights[k].isNegative())) throw new Error('Allocation weights must be non-negative');

  const result = {} as Record<K, Decimal>;
  let allocated = new Decimal(0);
  for (const k of keys) {
    result[k] = round2(total.times(weights[k]).dividedBy(weightSum));
    allocated = allocated.plus(result[k]);
  }
  const largest = keys.reduce((a, b) => (weights[b].gt(weights[a]) ? b : a));
  result[largest] = result[largest].plus(total.minus(allocated));
  return result;
}

/**
 * Computes per-channel net contribution:
 *  - Shopify POD: gross − refunds − production − shipping − payment fees − platform fees − ads − allocated operating
 *  - Amazon Merch: royalties − allocated expenses (ads + operating)
 *  - Digital:      gross − refunds − payment fees − ads − allocated operating
 */
export function computeContributions(lines: LedgerLine[]): ContributionReport {
  const perChannel = new Map<Channel, Totals>(CHANNELS.map((c) => [c, emptyTotals()]));
  let shared = new Decimal(0);

  for (const line of lines) {
    if (!ALLOWED[line.kind].includes(line.channel)) {
      throw new Error(`Ledger kind ${line.kind} is not valid for channel ${line.channel ?? 'shared'}`);
    }
    const amount = money(line.amount);
    if (amount.isNegative() && line.kind !== 'ROYALTY') throw new Error(`Ledger amounts must be non-negative (got ${amount} for ${line.kind})`);
    if (line.channel === null) {
      shared = shared.plus(amount);
    } else {
      const t = perChannel.get(line.channel)!;
      t[line.kind] = t[line.kind].plus(amount);
    }
  }

  const netRevenue = (c: Channel) => {
    const t = perChannel.get(c)!;
    return c === 'AMAZON_MERCH' ? t.ROYALTY : t.GROSS_SALES.minus(t.REFUND);
  };
  const weights = Object.fromEntries(
    CHANNELS.map((c) => [c, Decimal.max(netRevenue(c), 0)]),
  ) as Record<Channel, Decimal>;
  const hasRevenue = CHANNELS.some((c) => weights[c].gt(0));
  const sharedAllocation = hasRevenue && shared.gt(0) ? allocateProportionally(shared, weights) : null;

  const channels = CHANNELS.map((c): ChannelContribution => {
    const t = perChannel.get(c)!;
    const allocatedOperating = t.OPERATING.plus(sharedAllocation?.[c] ?? 0);
    const net = netRevenue(c)
      .minus(t.PRODUCTION_COST)
      .minus(t.SHIPPING_COST)
      .minus(t.PAYMENT_FEE)
      .minus(t.PLATFORM_FEE)
      .minus(t.ADVERTISING)
      .minus(allocatedOperating);
    return {
      channel: c,
      grossSales: t.GROSS_SALES.toFixed(2),
      refunds: t.REFUND.toFixed(2),
      royalties: t.ROYALTY.toFixed(2),
      productionCosts: t.PRODUCTION_COST.toFixed(2),
      shippingCosts: t.SHIPPING_COST.toFixed(2),
      paymentFees: t.PAYMENT_FEE.toFixed(2),
      platformFees: t.PLATFORM_FEE.toFixed(2),
      advertising: t.ADVERTISING.toFixed(2),
      allocatedOperating: allocatedOperating.toFixed(2),
      netRevenue: netRevenue(c).toFixed(2),
      netContribution: round2(net).toFixed(2),
    };
  });

  const unallocated = sharedAllocation ? new Decimal(0) : shared;
  const total = channels.reduce((acc, c) => acc.plus(c.netContribution), new Decimal(0)).minus(unallocated);

  return {
    channels,
    sharedCosts: shared.toFixed(2),
    unallocatedSharedCosts: unallocated.toFixed(2),
    totalNetContribution: round2(total).toFixed(2),
  };
}

export interface OrderLineForSplit {
  itemType: 'UNCLASSIFIED' | 'POD' | 'DIGITAL' | 'OTHER';
  quantity: number;
  unitPrice: MoneyInput;
  totalDiscount: MoneyInput;
}

/**
 * Splits a Shopify order's sales between the POD store channel and the Digital channel.
 * Digital lines → DIGITAL; everything else (incl. shipping charged) → SHOPIFY_POD.
 * Tax is a liability, never revenue, so it is excluded.
 */
export function splitOrderSalesByChannel(
  lines: OrderLineForSplit[],
  shippingCharged: MoneyInput,
): Record<'SHOPIFY_POD' | 'DIGITAL', Decimal> {
  const result = { SHOPIFY_POD: money(shippingCharged), DIGITAL: new Decimal(0) };
  for (const l of lines) {
    const net = money(l.unitPrice).times(l.quantity).minus(money(l.totalDiscount));
    const channel = l.itemType === 'DIGITAL' ? 'DIGITAL' : 'SHOPIFY_POD';
    result[channel] = result[channel].plus(net);
  }
  return result;
}
