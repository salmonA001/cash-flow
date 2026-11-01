import { Decimal } from '@cfe/business-rules';
import { notify, openReviewTask, runAutomation } from '../automation/engine';
import type { WorkerContext } from '../context';
import { applyProviderOrder } from './printful-sync';
import { syncShopifyOrder } from './shopify-order';

const DAY = 24 * 60 * 60 * 1000;

/** Alerts administrators (at most daily) when a required integration is not connected. */
export async function checkIntegrations(ctx: WorkerContext) {
  const orgs = await ctx.prisma.organization.findMany({ include: { integrationCredentials: true } });
  for (const org of orgs) {
    const missing = (['SHOPIFY', 'PRINTFUL'] as const).filter((p) => !org.integrationCredentials.some((c) => c.provider === p && c.status === 'CONNECTED'));
    if (missing.length === 0) continue;
    await runAutomation(ctx, 'integration.missing', { organizationId: org.id, subjectType: 'Organization', subjectId: org.id, input: { missing } }, async () => {
      const title = 'Integration not connected';
      const recent = await ctx.prisma.notification.findFirst({ where: { organizationId: org.id, title, createdAt: { gt: new Date(Date.now() - DAY) } } });
      if (recent) return { status: 'SKIPPED', output: { reason: 'Already alerted in the last 24h' } };
      await notify(ctx, org.id, 'WARNING', title, `Not connected: ${missing.join(', ')}. Connect them under Settings → Integrations.`, '/settings');
      return { status: 'SUCCEEDED', output: { missing } };
    });
  }
}

/** Compares paid Amazon payouts with imported royalties for the same period and currency. */
export async function reconcilePayouts(ctx: WorkerContext) {
  const payouts = await ctx.prisma.payout.findMany({ where: { source: 'AMAZON_MERCH', status: 'PAID' } });
  for (const p of payouts) {
    const agg = await ctx.prisma.royaltyTransaction.aggregate({
      where: { organizationId: p.organizationId, currency: p.currency, transactionDate: { gte: p.periodStart, lte: p.periodEnd } },
      _sum: { royaltyAmount: true },
    });
    const royalties = new Decimal((agg._sum.royaltyAmount ?? 0).toString());
    const diff = royalties.minus(p.amount.toString()).abs();
    if (diff.lte('0.01')) {
      await ctx.prisma.payout.update({ where: { id: p.id }, data: { status: 'RECONCILED' } });
      continue;
    }
    await runAutomation(ctx, 'reconciliation.mismatch', { organizationId: p.organizationId, subjectType: 'Payout', subjectId: p.id }, async () => {
      await ctx.prisma.payout.update({ where: { id: p.id }, data: { status: 'MISMATCH' } });
      await openReviewTask(ctx, p.organizationId, 'payout.mismatch', 'Payout', p.id, `Amazon payout ${p.externalId} differs from imported royalties by ${diff.toFixed(2)} ${p.currency}`, {
        payout: p.amount.toFixed(2),
        royalties: royalties.toFixed(2),
      });
      return { status: 'SUCCEEDED', output: { difference: diff.toFixed(2) } };
    });
  }
}

/** Catches webhooks Shopify failed to deliver: re-syncs every order updated in the last 26 hours. */
export async function reconcileShopify(ctx: WorkerContext) {
  const creds = await ctx.prisma.integrationCredential.findMany({ where: { provider: 'SHOPIFY', status: 'CONNECTED' } });
  const errors: string[] = [];
  for (const cred of creds) {
    const client = await ctx.shopify(cred.organizationId);
    let cursor: string | undefined;
    do {
      const page = await client.listOrderIdsUpdatedSince(new Date(Date.now() - 26 * 60 * 60 * 1000), cursor);
      for (const id of page.ids) {
        await syncShopifyOrder(ctx, cred.organizationId, id).catch((err: Error) => errors.push(`${id}: ${err.message}`));
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  if (errors.length) throw new Error(`Shopify reconciliation had ${errors.length} failures: ${errors.slice(0, 5).join('; ')}`);
}

/** Refreshes in-flight fulfillments from Printful in case a webhook was missed. */
export async function reconcilePrintful(ctx: WorkerContext) {
  const open = await ctx.prisma.fulfillmentOrder.findMany({ where: { status: { in: ['SUBMITTED', 'IN_PRODUCTION'] }, externalId: { not: null } } });
  for (const fo of open) {
    const provider = await ctx.printful(fo.organizationId);
    await applyProviderOrder(ctx, fo.id, await provider.getOrder(fo.externalId!), 'reconciled');
  }
}

export async function cleanupTemporaryUploads(ctx: WorkerContext) {
  return ctx.storage.cleanupTemporaryUploads(DAY);
}
