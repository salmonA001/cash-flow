import { describe, expect, it } from 'vitest';
import { allocateProportionally, computeContributions, splitOrderSalesByChannel } from './finance';
import { Decimal } from './money';
import { buildRateLookup, convert, MissingExchangeRateError } from './currency';

const byChannel = (r: ReturnType<typeof computeContributions>, c: string) => r.channels.find((x) => x.channel === c)!;

describe('computeContributions', () => {
  it('applies the Shopify POD formula', () => {
    const r = computeContributions([
      { channel: 'SHOPIFY_POD', kind: 'GROSS_SALES', amount: '1000.00' },
      { channel: 'SHOPIFY_POD', kind: 'REFUND', amount: '50.00' },
      { channel: 'SHOPIFY_POD', kind: 'PRODUCTION_COST', amount: '300.00' },
      { channel: 'SHOPIFY_POD', kind: 'SHIPPING_COST', amount: '80.00' },
      { channel: 'SHOPIFY_POD', kind: 'PAYMENT_FEE', amount: '29.30' },
      { channel: 'SHOPIFY_POD', kind: 'PLATFORM_FEE', amount: '39.00' },
      { channel: 'SHOPIFY_POD', kind: 'ADVERTISING', amount: '100.00' },
      { channel: 'SHOPIFY_POD', kind: 'OPERATING', amount: '20.00' },
    ]);
    // 1000 - 50 - 300 - 80 - 29.30 - 39 - 100 - 20
    expect(byChannel(r, 'SHOPIFY_POD').netContribution).toBe('381.70');
    expect(r.totalNetContribution).toBe('381.70');
  });

  it('applies the Amazon Merch formula: royalties minus allocated expenses', () => {
    const r = computeContributions([
      { channel: 'AMAZON_MERCH', kind: 'ROYALTY', amount: '412.55' },
      { channel: 'AMAZON_MERCH', kind: 'ADVERTISING', amount: '12.55' },
    ]);
    expect(byChannel(r, 'AMAZON_MERCH').netContribution).toBe('400.00');
    expect(byChannel(r, 'AMAZON_MERCH').grossSales).toBe('0.00');
  });

  it('applies the Digital formula', () => {
    const r = computeContributions([
      { channel: 'DIGITAL', kind: 'GROSS_SALES', amount: '200.00' },
      { channel: 'DIGITAL', kind: 'REFUND', amount: '20.00' },
      { channel: 'DIGITAL', kind: 'PAYMENT_FEE', amount: '6.10' },
      { channel: 'DIGITAL', kind: 'ADVERTISING', amount: '10.00' },
    ]);
    expect(byChannel(r, 'DIGITAL').netContribution).toBe('163.90');
  });

  it('allocates shared costs by net revenue share and conserves the total', () => {
    const r = computeContributions([
      { channel: 'SHOPIFY_POD', kind: 'GROSS_SALES', amount: '300.00' },
      { channel: 'AMAZON_MERCH', kind: 'ROYALTY', amount: '100.00' },
      { channel: null, kind: 'OPERATING', amount: '100.00' },
    ]);
    expect(byChannel(r, 'SHOPIFY_POD').allocatedOperating).toBe('75.00');
    expect(byChannel(r, 'AMAZON_MERCH').allocatedOperating).toBe('25.00');
    expect(byChannel(r, 'DIGITAL').allocatedOperating).toBe('0.00');
    expect(r.totalNetContribution).toBe('300.00');
    expect(r.unallocatedSharedCosts).toBe('0.00');
  });

  it('keeps shared costs unallocated (but still deducted) when there is no revenue', () => {
    const r = computeContributions([{ channel: null, kind: 'OPERATING', amount: '49.99' }]);
    expect(r.unallocatedSharedCosts).toBe('49.99');
    expect(r.totalNetContribution).toBe('-49.99');
  });

  it('rejects invalid channel/kind combinations', () => {
    expect(() => computeContributions([{ channel: 'AMAZON_MERCH', kind: 'GROSS_SALES', amount: '1' }])).toThrow();
    expect(() => computeContributions([{ channel: 'DIGITAL', kind: 'ROYALTY', amount: '1' }])).toThrow();
    expect(() => computeContributions([{ channel: null, kind: 'REFUND', amount: '1' }])).toThrow();
  });

  it('accepts net-negative royalties (returns exceed sales) but no other negative amounts', () => {
    const r = computeContributions([{ channel: 'AMAZON_MERCH', kind: 'ROYALTY', amount: '-3.20' }]);
    expect(byChannel(r, 'AMAZON_MERCH').netContribution).toBe('-3.20');
  });

  it('rejects negative amounts and float-like garbage', () => {
    expect(() => computeContributions([{ channel: 'DIGITAL', kind: 'GROSS_SALES', amount: '-1.00' }])).toThrow();
    expect(() => computeContributions([{ channel: 'DIGITAL', kind: 'GROSS_SALES', amount: '1e3' }])).toThrow();
  });

  it('is exact where binary floats are not', () => {
    const r = computeContributions([
      { channel: 'DIGITAL', kind: 'GROSS_SALES', amount: '0.10' },
      { channel: 'DIGITAL', kind: 'GROSS_SALES', amount: '0.20' },
    ]);
    expect(byChannel(r, 'DIGITAL').grossSales).toBe('0.30');
  });
});

describe('allocateProportionally', () => {
  it('assigns the rounding remainder so parts sum exactly', () => {
    const parts = allocateProportionally('100.00', { a: new Decimal(1), b: new Decimal(1), c: new Decimal(1) });
    const total = parts.a.plus(parts.b).plus(parts.c);
    expect(total.toFixed(2)).toBe('100.00');
  });

  it('throws on zero weights', () => {
    expect(() => allocateProportionally('10', { a: new Decimal(0) })).toThrow();
  });
});

describe('splitOrderSalesByChannel', () => {
  it('splits a mixed POD + digital order, assigning shipping to POD', () => {
    const split = splitOrderSalesByChannel(
      [
        { itemType: 'POD', quantity: 2, unitPrice: '25.00', totalDiscount: '5.00' },
        { itemType: 'DIGITAL', quantity: 1, unitPrice: '12.00', totalDiscount: '0.00' },
      ],
      '6.99',
    );
    expect(split.SHOPIFY_POD.toFixed(2)).toBe('51.99');
    expect(split.DIGITAL.toFixed(2)).toBe('12.00');
  });
});

describe('currency conversion', () => {
  const lookup = buildRateLookup([
    { base: 'EUR', quote: 'USD', rate: '1.10', rateDate: new Date('2026-01-01') },
    { base: 'EUR', quote: 'USD', rate: '1.20', rateDate: new Date('2026-02-01') },
  ]);

  it('uses the latest rate on or before the date and preserves the original', () => {
    const c = convert('100.00', 'EUR', 'USD', new Date('2026-01-15'), lookup);
    expect(c.amount.toFixed(2)).toBe('110.00');
    expect(c.originalAmount).toBe('100.00');
    expect(c.originalCurrency).toBe('EUR');
    expect(c.rate).toBe('1.1');
  });

  it('derives inverse rates', () => {
    expect(convert('120.00', 'USD', 'EUR', new Date('2026-03-01'), lookup).amount.toFixed(2)).toBe('100.00');
  });

  it('fails fast when no rate exists', () => {
    expect(() => convert('1.00', 'GBP', 'USD', new Date('2026-03-01'), lookup)).toThrow(MissingExchangeRateError);
    expect(() => convert('1.00', 'EUR', 'USD', new Date('2025-12-31'), lookup)).toThrow(MissingExchangeRateError);
  });
});
