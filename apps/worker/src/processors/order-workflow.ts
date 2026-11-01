import { checkFulfillmentEligibility, ShippingAddress, summarizeClassification } from '@cfe/business-rules';
import { openReviewTask, runAutomation } from '../automation/engine';
import type { WorkerContext } from '../context';
import { grantEntitlement } from './entitlement';

/**
 * Post-classification workflow. Idempotent — safe to run any number of times per order:
 *  - unmapped items → review task
 *  - paid POD order → fulfillment task (awaiting approval) or review task with reasons
 *  - paid digital items → download entitlements
 *  - full refund → revoke digital access; partial refund with digital items → review task
 *  - cancelled order → cancel fulfillment tasks not yet submitted
 */
export async function runOrderWorkflow(ctx: WorkerContext, orderId: string): Promise<void> {
  const order = await ctx.prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { organization: true, items: { include: { variant: true, entitlement: true } }, fulfillments: true },
  });
  const organizationId = order.organizationId;
  const summary = summarizeClassification(order.items.map((i) => (i.itemType === 'OTHER' ? 'UNCLASSIFIED' : i.itemType)));

  if (summary.unclassifiedCount > 0) {
    await runAutomation(ctx, 'reconciliation.mismatch', { organizationId, subjectType: 'Order', subjectId: orderId }, async () => {
      await openReviewTask(ctx, organizationId, 'order.unmapped_items', 'Order', orderId, `Order ${order.orderNumber} has ${summary.unclassifiedCount} unmapped line item(s)`, {
        items: order.items.filter((i) => i.itemType === 'UNCLASSIFIED').map((i) => ({ id: i.id, title: i.title, sku: i.sku })),
      });
      return { status: 'SUCCEEDED' };
    });
  }

  if (order.status === 'CANCELLED') {
    await ctx.prisma.fulfillmentOrder.updateMany({
      where: { orderId, status: { in: ['AWAITING_APPROVAL', 'APPROVED'] } },
      data: { status: 'CANCELLED', lastError: 'Order cancelled in Shopify' },
    });
  }

  const paid = order.paymentStatus === 'PAID';

  if (paid && summary.hasPod && order.status === 'OPEN' && order.fulfillments.length === 0) {
    await runAutomation(ctx, 'pod.fulfillment.create', { organizationId, subjectType: 'Order', subjectId: orderId }, async () => {
      const eligibility = checkFulfillmentEligibility({
        order: { status: order.status, paymentStatus: order.paymentStatus, shippingAddress: order.shippingAddress as ShippingAddress | null },
        items: order.items.map((i) => ({
          itemType: i.itemType,
          quantity: i.quantity,
          printfulVariantId: i.variant?.printfulVariantId ?? null,
          printFileUrl: i.variant?.printFileAssetId ?? null,
        })),
        existingFulfillmentStatus: null,
      });
      if (!eligibility.eligible) {
        await openReviewTask(ctx, organizationId, 'fulfillment.ineligible', 'Order', orderId, `Order ${order.orderNumber} cannot be fulfilled yet`, { reasons: eligibility.reasons });
        return { status: 'SKIPPED', output: { reasons: eligibility.reasons } };
      }
      const fo = await ctx.prisma.fulfillmentOrder.upsert({
        where: { orderId_provider: { orderId, provider: 'PRINTFUL' } },
        update: {},
        create: {
          organizationId, orderId, provider: 'PRINTFUL',
          idempotencyKey: `${orderId}:printful`,
          status: order.organization.fulfillmentRequiresApproval ? 'AWAITING_APPROVAL' : 'APPROVED',
          events: { create: { organizationId, type: 'created', message: 'Fulfillment task created from paid order' } },
        },
      });
      return { status: 'SUCCEEDED', output: { fulfillmentOrderId: fo.id, status: fo.status } };
    });
  }

  if (paid) {
    for (const item of order.items.filter((i) => i.itemType === 'DIGITAL' && !i.entitlement)) {
      await runAutomation(ctx, 'digital.entitlement.grant', { organizationId, subjectType: 'OrderItem', subjectId: item.id }, async () => ({
        status: 'SUCCEEDED',
        output: await grantEntitlement(ctx, item.id),
      }));
    }
  }

  const digitalWithAccess = order.items.filter((i) => i.entitlement?.status === 'ACTIVE');
  if (order.paymentStatus === 'REFUNDED' && digitalWithAccess.length > 0) {
    await runAutomation(ctx, 'refund.received', { organizationId, subjectType: 'Order', subjectId: orderId }, async () => {
      const revoked = await ctx.prisma.downloadEntitlement.updateMany({
        where: { orderItemId: { in: digitalWithAccess.map((i) => i.id) }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'Order fully refunded' },
      });
      return { status: 'SUCCEEDED', output: { revoked: revoked.count } };
    });
  } else if (order.paymentStatus === 'PARTIALLY_REFUNDED' && digitalWithAccess.length > 0) {
    await runAutomation(ctx, 'refund.received', { organizationId, subjectType: 'Order', subjectId: orderId }, async () => {
      // Shopify partial refunds don't map 1:1 to download access; a human decides.
      await openReviewTask(ctx, organizationId, 'refund.partial_digital', 'Order', orderId, `Partial refund on ${order.orderNumber} — review digital access`);
      return { status: 'SUCCEEDED', output: { reviewRequired: true } };
    });
  }
}
