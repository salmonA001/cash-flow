import { ProviderOrder, ProviderOrderStatus } from '@cfe/integration-sdk';
import { FulfillmentStatus } from '@cfe/database';
import { notify, runAutomation } from '../automation/engine';
import type { WorkerContext } from '../context';

const STATUS: Record<ProviderOrderStatus, FulfillmentStatus> = {
  draft: 'NEEDS_REVIEW', // we always confirm; a lingering draft needs a human
  pending: 'SUBMITTED',
  in_production: 'IN_PRODUCTION',
  partially_shipped: 'IN_PRODUCTION',
  shipped: 'SHIPPED',
  on_hold: 'NEEDS_REVIEW',
  cancelled: 'CANCELLED',
  failed: 'FAILED',
};

/** Writes the provider's authoritative state (status, costs, tracking) onto our record. */
export async function applyProviderOrder(ctx: WorkerContext, fulfillmentOrderId: string, p: ProviderOrder, eventType: string) {
  const fo = await ctx.prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: fulfillmentOrderId } });
  const status = STATUS[p.status];
  const tracking = p.shipments.at(-1);
  await ctx.prisma.fulfillmentOrder.update({
    where: { id: fo.id },
    data: {
      externalId: p.id,
      status,
      lastError: status === 'FAILED' || status === 'NEEDS_REVIEW' ? `Printful status: ${p.rawStatus}` : null,
      ...(p.costs ? { currency: p.costs.currency, productionCost: p.costs.production, shippingCost: p.costs.shipping, taxCost: p.costs.tax } : {}),
      ...(tracking ? { carrier: tracking.carrier, trackingNumber: tracking.trackingNumber, trackingUrl: tracking.trackingUrl } : {}),
      events: { create: { organizationId: fo.organizationId, type: eventType, message: `Printful status ${p.rawStatus}`, payload: { status: p.rawStatus, shipments: p.shipments.length } } },
    },
  });
  if (status !== fo.status && (status === 'FAILED' || status === 'NEEDS_REVIEW')) {
    await notify(ctx, fo.organizationId, 'WARNING', 'Fulfillment needs attention', `Printful reports "${p.rawStatus}" for fulfillment ${fo.id}`, '/fulfillment');
  }
}

/** Handles a Printful webhook: re-fetches the order from the API (payloads are not trusted). */
export async function syncPrintfulOrder(ctx: WorkerContext, organizationId: string, ref: { printfulOrderId: number | null; externalId: string | null }, eventId: string) {
  const fo = await ctx.prisma.fulfillmentOrder.findFirst({
    where: {
      organizationId,
      OR: [
        ...(ref.printfulOrderId ? [{ externalId: String(ref.printfulOrderId) }] : []),
        ...(ref.externalId ? [{ idempotencyKey: ref.externalId }] : []),
      ],
    },
  });
  if (!fo) return { matched: false };
  await runAutomation(ctx, 'printful.webhook.sync', { organizationId, subjectType: 'FulfillmentOrder', subjectId: fo.id, input: { eventId } }, async () => {
    const provider = await ctx.printful(organizationId);
    const order = await provider.getOrder(fo.externalId ?? `@${fo.idempotencyKey}`);
    await applyProviderOrder(ctx, fo.id, order, 'webhook');
    return { status: 'SUCCEEDED', output: { status: order.rawStatus } };
  });
  return { matched: true };
}
