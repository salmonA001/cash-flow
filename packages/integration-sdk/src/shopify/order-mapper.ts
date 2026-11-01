import { sum } from '@cfe/business-rules';

/** Shop-currency money. Shop money is always in the order's shop currency (`currencyCode`). */
type Money = { shopMoney: { amount: string } };

export interface ShopifyOrderNode {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  currencyCode: string;
  displayFinancialStatus: string | null;
  subtotalPriceSet: Money;
  totalShippingPriceSet: Money;
  totalTaxSet: Money;
  totalDiscountsSet: Money;
  totalPriceSet: Money;
  customer: { id: string; email: string | null; displayName: string | null } | null;
  shippingAddress: {
    name: string | null; address1: string | null; address2: string | null; city: string | null;
    provinceCode: string | null; countryCodeV2: string | null; zip: string | null; phone: string | null;
  } | null;
  lineItems: {
    nodes: {
      id: string; sku: string | null; name: string; quantity: number;
      variant: { id: string } | null;
      originalUnitPriceSet: Money; totalDiscountSet: Money;
    }[];
  };
  transactions: {
    id: string; kind: string; status: string; gateway: string; processedAt: string | null;
    amountSet: Money; fees: { amount: { amount: string } }[];
  }[];
  refunds: { id: string; createdAt: string; note: string | null; totalRefundedSet: Money }[];
}

export type PaymentStatus = 'PENDING' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOIDED' | 'FAILED';

export interface NormalizedShopifyOrder {
  externalId: string;
  orderNumber: string;
  placedAt: Date;
  cancelledAt: Date | null;
  currency: string;
  paymentStatus: PaymentStatus;
  subtotal: string;
  shippingTotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  customer: { externalId: string; email: string | null; name: string | null } | null;
  shippingAddress: {
    name: string | null; address1: string | null; address2: string | null; city: string | null;
    provinceCode: string | null; countryCode: string | null; zip: string | null; phone: string | null;
  } | null;
  lineItems: {
    externalId: string; variantExternalId: string | null; sku: string | null; title: string;
    quantity: number; unitPrice: string; totalDiscount: string;
  }[];
  payments: { externalId: string; gateway: string; amount: string; fee: string; currency: string; succeeded: boolean; processedAt: Date }[];
  refunds: { externalId: string; amount: string; currency: string; reason: string | null; processedAt: Date }[];
}

const FINANCIAL_STATUS: Record<string, PaymentStatus> = {
  PAID: 'PAID',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
  VOIDED: 'VOIDED',
  EXPIRED: 'FAILED',
  PENDING: 'PENDING',
  AUTHORIZED: 'PENDING',
  PARTIALLY_PAID: 'PENDING',
};

export function normalizeShopifyOrder(o: ShopifyOrderNode): NormalizedShopifyOrder {
  const status = o.displayFinancialStatus ?? 'PENDING';
  const paymentStatus = FINANCIAL_STATUS[status];
  if (!paymentStatus) throw new Error(`Unknown Shopify financial status "${status}"`);
  return {
    externalId: o.id,
    orderNumber: o.name,
    placedAt: new Date(o.createdAt),
    cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : null,
    currency: o.currencyCode,
    paymentStatus,
    subtotal: o.subtotalPriceSet.shopMoney.amount,
    shippingTotal: o.totalShippingPriceSet.shopMoney.amount,
    taxTotal: o.totalTaxSet.shopMoney.amount,
    discountTotal: o.totalDiscountsSet.shopMoney.amount,
    total: o.totalPriceSet.shopMoney.amount,
    customer: o.customer ? { externalId: o.customer.id, email: o.customer.email, name: o.customer.displayName } : null,
    shippingAddress: o.shippingAddress
      ? { ...o.shippingAddress, countryCode: o.shippingAddress.countryCodeV2 }
      : null,
    lineItems: o.lineItems.nodes.map((li) => ({
      externalId: li.id,
      variantExternalId: li.variant?.id ?? null,
      sku: li.sku,
      title: li.name,
      quantity: li.quantity,
      unitPrice: li.originalUnitPriceSet.shopMoney.amount,
      totalDiscount: li.totalDiscountSet.shopMoney.amount,
    })),
    payments: o.transactions
      .filter((t) => t.kind === 'SALE' || t.kind === 'CAPTURE')
      .map((t) => ({
        externalId: t.id,
        gateway: t.gateway,
        amount: t.amountSet.shopMoney.amount,
        fee: sum(t.fees.map((f) => f.amount.amount)).toFixed(2),
        currency: o.currencyCode,
        succeeded: t.status === 'SUCCESS',
        processedAt: new Date(t.processedAt ?? o.createdAt),
      })),
    refunds: o.refunds.map((r) => ({
      externalId: r.id,
      amount: r.totalRefundedSet.shopMoney.amount,
      currency: o.currencyCode,
      reason: r.note,
      processedAt: new Date(r.createdAt),
    })),
  };
}
