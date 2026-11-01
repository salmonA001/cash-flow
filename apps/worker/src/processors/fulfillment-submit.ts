import { checkFulfillmentEligibility, ShippingAddress } from '@cfe/business-rules';
import { BucketName, ProviderOrder, ProviderRequestError, ProviderTimeoutError } from '@cfe/integration-sdk';
import { FulfillmentStatus, Prisma } from '@cfe/database';
import { notify, openReviewTask } from '../automation/engine';
import type { WorkerContext } from '../context';
import { applyProviderOrder } from './printful-sync';

/**
 * Submits an approved fulfillment to Printful exactly once.
 *  1. Look up the provider order by our idempotency key — adopt it if it exists (covers earlier timeouts).
 *  2. Otherwise create a draft, then confirm it.
 *  3. Timeout ⇒ outcome unknown ⇒ NEEDS_REVIEW (never auto-retried). Provider error ⇒ FAILED.
 */
export async function submitFulfillment(ctx: WorkerContext, fulfillmentOrderId: string, automationRunId: string): Promise<void> {
  const fo = await ctx.prisma.fulfillmentOrder.findUniqueOrThrow({
    where: { id: fulfillmentOrderId },
    include: {
      organization: true,
      order: { include: { customer: true, items: { include: { variant: true } } } },
    },
  });
  const run = (data: Prisma.AutomationRunUpdateInput) => ctx.prisma.automationRun.update({ where: { id: automationRunId }, data });
  const fail = async (status: FulfillmentStatus, message: string) => {
    await ctx.prisma.fulfillmentOrder.update({
      where: { id: fo.id },
      data: { status, lastError: message, events: { create: { organizationId: fo.organizationId, type: status.toLowerCase(), message } } },
    });
    await run({ status: 'FAILED', error: message, finishedAt: new Date() });
  };

  await run({ status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } });
  if (fo.status !== 'SUBMITTING') return fail('FAILED', `Unexpected status ${fo.status} at submission`);
  if (fo.organization.demoMode) return fail('FAILED', 'Demo mode is on; live submission refused');

  const eligibility = checkFulfillmentEligibility({
    order: { status: fo.order.status, paymentStatus: fo.order.paymentStatus, shippingAddress: fo.order.shippingAddress as ShippingAddress | null },
    items: fo.order.items.map((i) => ({ itemType: i.itemType, quantity: i.quantity, printfulVariantId: i.variant?.printfulVariantId ?? null, printFileUrl: i.variant?.printFileAssetId ?? null })),
    existingFulfillmentStatus: null,
  });
  if (!eligibility.eligible) return fail('FAILED', `Not eligible: ${eligibility.reasons.join('; ')}`);

  const printFiles = await ctx.prisma.designAsset.findMany({
    where: { id: { in: fo.order.items.map((i) => i.variant?.printFileAssetId).filter((x): x is string => !!x) }, organizationId: fo.organizationId },
  });
  const fileUrl = async (assetId: string) => {
    const asset = printFiles.find((a) => a.id === assetId);
    if (!asset) throw new Error(`Print file ${assetId} not found`);
    // Printful downloads the file while creating the order; one hour is ample.
    return ctx.storage.presignedGet(asset.bucket as BucketName, asset.objectKey, 3600);
  };

  const address = fo.order.shippingAddress as ShippingAddress & { address2?: string | null; phone?: string | null };
  const provider = await ctx.printful(fo.organizationId);
  let result: ProviderOrder;
  try {
    const existing = await provider.findOrderByExternalId(fo.idempotencyKey);
    if (existing) {
      result = existing;
    } else {
      const items = await Promise.all(
        fo.order.items
          .filter((i) => i.itemType === 'POD')
          .map(async (i) => ({ providerVariantId: i.variant!.printfulVariantId!, quantity: i.quantity, printFileUrl: await fileUrl(i.variant!.printFileAssetId!), retailPrice: i.unitPrice.toFixed(2) })),
      );
      result = await provider.createOrder({
        externalId: fo.idempotencyKey,
        recipient: {
          name: address.name!, address1: address.address1!, address2: address.address2, city: address.city!,
          stateCode: address.provinceCode, countryCode: address.countryCode!, zip: address.zip,
          email: fo.order.customer?.email, phone: address.phone,
        },
        items,
      });
    }
    if (result.status === 'draft') result = await provider.confirmOrder(result.id);
  } catch (err) {
    if (err instanceof ProviderTimeoutError) {
      await fail('NEEDS_REVIEW', `${err.message}. Retry is safe: it looks up the order by its idempotency key first.`);
      await openReviewTask(ctx, fo.organizationId, 'fulfillment.timeout', 'FulfillmentOrder', fo.id, `Printful timed out for ${fo.order.orderNumber}; verify before retrying`);
      await notify(ctx, fo.organizationId, 'WARNING', 'Fulfillment needs review', `Printful timed out while submitting ${fo.order.orderNumber}.`, '/fulfillment');
      return;
    }
    const message = err instanceof ProviderRequestError ? `Printful ${err.status}: ${err.message}` : (err as Error).message;
    await fail('FAILED', message);
    await notify(ctx, fo.organizationId, 'CRITICAL', 'Fulfillment failed', `${fo.order.orderNumber}: ${message}`, '/fulfillment');
    return;
  }

  await ctx.prisma.fulfillmentOrder.update({ where: { id: fo.id }, data: { submittedAt: new Date(), attemptCount: { increment: 1 } } });
  await applyProviderOrder(ctx, fo.id, result, 'submitted');
  await run({ status: 'SUCCEEDED', output: { providerOrderId: result.id, providerStatus: result.rawStatus }, finishedAt: new Date() });
}
