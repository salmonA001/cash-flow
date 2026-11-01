import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  allocateProportionally,
  buildRateLookup,
  Channel,
  convert,
  Decimal,
  LedgerLine,
  MissingExchangeRateError,
  money,
  splitOrderSalesByChannel,
} from '@cfe/business-rules';
import { PrismaService } from '../common/prisma.service';

export interface DatedLedgerLine extends LedgerLine {
  date: Date;
}

export interface Period {
  from: Date;
  to: Date; // inclusive end of day
}

/** Revenue-recognizing payment states. Pending/voided/failed orders are not revenue. */
const RECOGNIZED = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

/**
 * Builds the base-currency ledger for a period from source records.
 * Every conversion uses a stored, dated exchange rate; any missing rate fails the whole
 * report (422) instead of silently producing a wrong number.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async build(orgId: string, period: Period): Promise<{ baseCurrency: string; lines: DatedLedgerLine[] }> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const base = org.baseCurrency;
    const range = { gte: period.from, lte: period.to };

    const [orders, refunds, payments, fulfillments, royalties, expenses, rates] = await Promise.all([
      this.prisma.order.findMany({
        where: { organizationId: orgId, placedAt: range, paymentStatus: { in: [...RECOGNIZED] } },
        include: { items: true },
      }),
      this.prisma.refund.findMany({ where: { organizationId: orgId, processedAt: range }, include: { order: { include: { items: true } } } }),
      this.prisma.payment.findMany({
        where: { organizationId: orgId, processedAt: range, status: 'SUCCEEDED', fee: { gt: 0 } },
        include: { order: { include: { items: true } } },
      }),
      this.prisma.fulfillmentOrder.findMany({ where: { organizationId: orgId, submittedAt: range, status: { not: 'CANCELLED' }, currency: { not: null } } }),
      this.prisma.royaltyTransaction.findMany({ where: { organizationId: orgId, transactionDate: range } }),
      this.prisma.expense.findMany({ where: { organizationId: orgId, incurredOn: range } }),
      this.prisma.exchangeRate.findMany({ where: { rateDate: { lte: period.to } } }),
    ]);

    const lookup = buildRateLookup(rates);
    const missing = new Set<string>();
    const toBase = (amount: { toString(): string }, currency: string, date: Date): Decimal | null => {
      try {
        return convert(amount, currency, base, date, lookup).amount;
      } catch (err) {
        if (err instanceof MissingExchangeRateError) {
          missing.add(`${currency}->${base} on/before ${date.toISOString().slice(0, 10)}`);
          return null;
        }
        throw err;
      }
    };

    const lines: DatedLedgerLine[] = [];
    const push = (channel: Channel | null, kind: LedgerLine['kind'], amount: Decimal | null, date: Date) => {
      if (amount && !amount.isZero()) lines.push({ channel, kind, amount: amount.toFixed(2), date });
    };
    const orderWeights = (order: { shippingTotal: { toString(): string }; items: Parameters<typeof splitOrderSalesByChannel>[0] }) =>
      splitOrderSalesByChannel(order.items, order.shippingTotal);
    /** Splits an order-level amount (refund, fee) across channels by the order's sales mix. */
    const splitByOrder = (amount: Decimal, order: Parameters<typeof orderWeights>[0]) => {
      const w = orderWeights(order);
      return w.SHOPIFY_POD.plus(w.DIGITAL).gt(0) ? allocateProportionally(amount.toFixed(2), w) : { SHOPIFY_POD: amount, DIGITAL: new Decimal(0) };
    };

    for (const o of orders) {
      const split = orderWeights(o);
      push('SHOPIFY_POD', 'GROSS_SALES', toBase(split.SHOPIFY_POD.toFixed(2), o.currency, o.placedAt), o.placedAt);
      push('DIGITAL', 'GROSS_SALES', toBase(split.DIGITAL.toFixed(2), o.currency, o.placedAt), o.placedAt);
    }
    for (const r of refunds) {
      const amount = toBase(r.amount, r.currency, r.processedAt);
      if (!amount) continue;
      const parts = splitByOrder(amount, r.order);
      push('SHOPIFY_POD', 'REFUND', parts.SHOPIFY_POD, r.processedAt);
      push('DIGITAL', 'REFUND', parts.DIGITAL, r.processedAt);
    }
    for (const p of payments) {
      const fee = toBase(p.fee, p.currency, p.processedAt);
      if (!fee) continue;
      const parts = splitByOrder(fee, p.order);
      push('SHOPIFY_POD', 'PAYMENT_FEE', parts.SHOPIFY_POD, p.processedAt);
      push('DIGITAL', 'PAYMENT_FEE', parts.DIGITAL, p.processedAt);
    }
    for (const f of fulfillments) {
      const date = f.submittedAt!;
      const production = money(f.productionCost ?? '0').plus(money(f.taxCost ?? '0'));
      push('SHOPIFY_POD', 'PRODUCTION_COST', toBase(production.toFixed(2), f.currency!, date), date);
      push('SHOPIFY_POD', 'SHIPPING_COST', toBase(f.shippingCost ?? '0', f.currency!, date), date);
    }
    for (const r of royalties) {
      push('AMAZON_MERCH', 'ROYALTY', toBase(r.royaltyAmount, r.currency, r.transactionDate), r.transactionDate);
    }
    for (const e of expenses) {
      const amount = toBase(e.amount, e.currency, e.incurredOn);
      if (e.category === 'ADVERTISING') push(e.channel, 'ADVERTISING', amount, e.incurredOn);
      else if (e.category === 'PLATFORM_FEES') push('SHOPIFY_POD', 'PLATFORM_FEE', amount, e.incurredOn);
      else push(e.channel, 'OPERATING', amount, e.incurredOn);
    }

    if (missing.size > 0) {
      throw new UnprocessableEntityException({
        message: `Missing exchange rates — add them under Finance → Exchange rates`,
        details: [...missing],
      });
    }
    return { baseCurrency: base, lines };
  }

  /** Converts payouts (cash movements — never revenue) for the outstanding-payouts figure. */
  async outstandingPayouts(orgId: string, baseCurrency: string): Promise<Decimal> {
    const [payouts, rates] = await Promise.all([
      this.prisma.payout.findMany({ where: { organizationId: orgId, status: 'EXPECTED' } }),
      this.prisma.exchangeRate.findMany(),
    ]);
    const lookup = buildRateLookup(rates);
    return payouts.reduce((acc, p) => {
      try {
        return acc.plus(convert(p.amount, p.currency, baseCurrency, p.periodEnd, lookup).amount);
      } catch (err) {
        if (err instanceof MissingExchangeRateError) throw new UnprocessableEntityException({ message: err.message });
        throw err;
      }
    }, new Decimal(0));
  }
}
