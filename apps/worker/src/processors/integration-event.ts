import { notify } from '../automation/engine';
import type { WorkerContext } from '../context';
import { syncShopifyOrder } from './shopify-order';
import { syncPrintfulOrder } from './printful-sync';

/** Routes a stored webhook event to its handler and records the outcome on the event. */
export async function processIntegrationEvent(ctx: WorkerContext, integrationEventId: string): Promise<void> {
  const event = await ctx.prisma.integrationEvent.findUniqueOrThrow({ where: { id: integrationEventId } });
  if (event.status === 'PROCESSED' || event.status === 'IGNORED') return;
  await ctx.prisma.integrationEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 } } });

  const payload = event.payload as Record<string, string | number | null>;
  let status: 'PROCESSED' | 'IGNORED' = 'PROCESSED';
  try {
    if (event.provider === 'SHOPIFY') {
      if (event.topic.startsWith('orders/') || event.topic === 'refunds/create') {
        await syncShopifyOrder(ctx, event.organizationId, String(payload.orderGid));
      } else if (event.topic === 'app/uninstalled') {
        await ctx.prisma.integrationCredential.updateMany({
          where: { organizationId: event.organizationId, provider: 'SHOPIFY' },
          data: { status: 'DISCONNECTED', encryptedSecret: '' },
        });
        await notify(ctx, event.organizationId, 'CRITICAL', 'Shopify disconnected', 'The Shopify app was uninstalled. Orders will not sync until it is reconnected.', '/settings');
      } else {
        // products/update: catalog edits are managed here, not pulled from Shopify (see docs/INTEGRATIONS.md).
        status = 'IGNORED';
      }
    } else if (event.provider === 'PRINTFUL') {
      const result = await syncPrintfulOrder(ctx, event.organizationId, {
        printfulOrderId: payload.printfulOrderId as number | null,
        externalId: payload.externalId as string | null,
      }, event.eventId);
      if (!result.matched) status = 'IGNORED';
    } else {
      status = 'IGNORED';
    }
    await ctx.prisma.integrationEvent.update({ where: { id: event.id }, data: { status, error: null, processedAt: new Date() } });
  } catch (err) {
    await ctx.prisma.integrationEvent.update({ where: { id: event.id }, data: { status: 'FAILED', error: (err as Error).message.slice(0, 2000) } });
    throw err;
  }
}
