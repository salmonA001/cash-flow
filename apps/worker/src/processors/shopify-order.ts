import { classifyOrderItem } from '@cfe/business-rules';
import { NormalizedShopifyOrder } from '@cfe/integration-sdk';
import { Prisma } from '@cfe/database';
import { runAutomation } from '../automation/engine';
import type { WorkerContext } from '../context';
import { runOrderWorkflow } from './order-workflow';

/**
 * Upserts an order from Shopify's authoritative state (re-fetched via GraphQL, never trusted
 * from the webhook body), classifies its line items, then runs the order workflow.
 * Idempotent: every write is keyed by Shopify IDs.
 */
export async function syncShopifyOrder(ctx: WorkerContext, organizationId: string, orderGid: string): Promise<string | null> {
  const client = await ctx.shopify(organizationId);
  const remote = await client.getOrder(orderGid);
  if (!remote) return null;

  const orderId = await runAutomation(ctx, 'shopify.order.classify', { organizationId, subjectType: 'ShopifyOrder', subjectId: orderGid }, async () => {
    const id = await upsertOrder(ctx, organizationId, remote);
    return { status: 'SUCCEEDED', output: { orderId: id } };
  }).then((o) => (o.output as { orderId: string }).orderId);

  await runOrderWorkflow(ctx, orderId);
  return orderId;
}

async function upsertOrder(ctx: WorkerContext, organizationId: string, o: NormalizedShopifyOrder): Promise<string> {
  const variants = await ctx.prisma.productVariant.findMany({
    where: { organizationId, shopifyVariantId: { in: o.lineItems.map((li) => li.variantExternalId).filter((v): v is string => !!v) } },
    include: { product: { select: { type: true } } },
  });
  const byShopifyId = new Map(variants.map((v) => [v.shopifyVariantId!, v]));

  return ctx.prisma.$transaction(async (tx) => {
    const customer = o.customer
      ? await tx.customer.upsert({
          where: { organizationId_shopifyCustomerId: { organizationId, shopifyCustomerId: o.customer.externalId } },
          update: { email: o.customer.email, name: o.customer.name, country: o.shippingAddress?.countryCode ?? undefined },
          create: { organizationId, shopifyCustomerId: o.customer.externalId, email: o.customer.email, name: o.customer.name, country: o.shippingAddress?.countryCode ?? null },
        })
      : null;

    const fields = {
      orderNumber: o.orderNumber,
      customerId: customer?.id ?? null,
      status: o.cancelledAt ? ('CANCELLED' as const) : ('OPEN' as const),
      paymentStatus: o.paymentStatus,
      currency: o.currency,
      subtotal: o.subtotal,
      shippingTotal: o.shippingTotal,
      taxTotal: o.taxTotal,
      discountTotal: o.discountTotal,
      total: o.total,
      shippingAddress: (o.shippingAddress ?? Prisma.DbNull) as Prisma.InputJsonValue,
      placedAt: o.placedAt,
      cancelledAt: o.cancelledAt,
    };
    const order = await tx.order.upsert({
      where: { organizationId_source_externalId: { organizationId, source: 'SHOPIFY', externalId: o.externalId } },
      update: fields,
      create: { organizationId, source: 'SHOPIFY', externalId: o.externalId, ...fields },
    });

    for (const li of o.lineItems) {
      const variant = li.variantExternalId ? byShopifyId.get(li.variantExternalId) : undefined;
      const mapped = variant ? { variantId: variant.id, itemType: classifyOrderItem({ productType: variant.product.type }) } : {};
      await tx.orderItem.upsert({
        where: { orderId_externalLineItemId: { orderId: order.id, externalLineItemId: li.externalId } },
        // Never overwrite a manual mapping with "unmapped" on re-sync.
        update: { title: li.title, sku: li.sku, quantity: li.quantity, unitPrice: li.unitPrice, totalDiscount: li.totalDiscount, ...mapped },
        create: {
          organizationId, orderId: order.id, externalLineItemId: li.externalId, title: li.title, sku: li.sku,
          quantity: li.quantity, unitPrice: li.unitPrice, totalDiscount: li.totalDiscount, itemType: 'UNCLASSIFIED', ...mapped,
        },
      });
    }

    for (const p of o.payments) {
      const data = { amount: p.amount, fee: p.fee, currency: p.currency, status: p.succeeded ? ('SUCCEEDED' as const) : ('FAILED' as const), processedAt: p.processedAt };
      await tx.payment.upsert({
        where: { organizationId_provider_externalId: { organizationId, provider: `shopify:${p.gateway}`, externalId: p.externalId } },
        update: data,
        create: { organizationId, orderId: order.id, provider: `shopify:${p.gateway}`, externalId: p.externalId, ...data },
      });
    }

    for (const r of o.refunds) {
      await tx.refund.upsert({
        where: { organizationId_externalId: { organizationId, externalId: r.externalId } },
        update: { amount: r.amount, currency: r.currency, reason: r.reason },
        create: { organizationId, orderId: order.id, externalId: r.externalId, amount: r.amount, currency: r.currency, reason: r.reason, processedAt: r.processedAt },
      });
    }
    return order.id;
  });
}
