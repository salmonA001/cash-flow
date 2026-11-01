import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@cfe/database';
import { processIntegrationEvent } from '../src/processors/integration-event';
import { submitFulfillment } from '../src/processors/fulfillment-submit';
import { importAmazonReport } from '../src/processors/amazon-import';
import { grantEntitlement } from '../src/processors/entitlement';
import { reconcilePayouts } from '../src/processors/maintenance';
import { runOrderWorkflow } from '../src/processors/order-workflow';
import { buildContext, FakeMailer, FakePrintful, FakeShopify, FakeStorage, resetDatabase, seedOrg, shopifyOrder } from './harness';
import type { WorkerContext } from '../src/context';

let prisma: PrismaClient;
let ctx: WorkerContext;
let shopify: FakeShopify;
let printful: FakePrintful;
let mailer: FakeMailer;
let storage: FakeStorage;
let orgId: string;
let orderId: string;

async function shopifyEvent(eventId: string, orderGid: string, topic = 'orders/updated') {
  const e = await prisma.integrationEvent.create({ data: { organizationId: orgId, provider: 'SHOPIFY', eventId, topic, payload: { orderGid } } });
  await processIntegrationEvent(ctx, e.id);
  return prisma.integrationEvent.findUniqueOrThrow({ where: { id: e.id } });
}

async function approveAndSubmit(fulfillmentId: string) {
  await prisma.fulfillmentOrder.update({ where: { id: fulfillmentId }, data: { status: 'SUBMITTING' } });
  const run = await prisma.automationRun.create({
    data: { organizationId: orgId, trigger: 'fulfillment.approved', action: 'printful.create_order', level: 'APPROVAL_REQUIRED', subjectType: 'FulfillmentOrder', subjectId: fulfillmentId },
  });
  await submitFulfillment(ctx, fulfillmentId, run.id);
  return prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: fulfillmentId } });
}

beforeAll(async () => {
  prisma = await resetDatabase();
  ({ ctx, shopify, printful, mailer, storage } = buildContext(prisma));
  const org = await seedOrg(prisma, 'acme');
  orgId = org.id;
  const design = await prisma.design.create({ data: { organizationId: orgId, title: 'Cat', status: 'APPROVED', versions: { create: { versionNumber: 1 } } }, include: { versions: true } });
  const printFile = await prisma.designAsset.create({
    data: { organizationId: orgId, designVersionId: design.versions[0].id, kind: 'PRINT_FILE', bucket: 'design-exports', objectKey: 'k/cat.png', fileName: 'cat.png', contentType: 'image/png', sizeBytes: 10, checksumSha256: 'x' },
  });
  await prisma.product.create({
    data: {
      organizationId: orgId, title: 'Cat Tee', type: 'POD', designId: design.id,
      variants: { create: { organizationId: orgId, sku: 'CAT-M', price: '24.99', currency: 'USD', shopifyVariantId: 'gid://shopify/ProductVariant/10', printfulVariantId: 4012, printFileAssetId: printFile.id } },
    },
  });
  const digital = await prisma.product.create({
    data: { organizationId: orgId, title: 'Brush Pack', type: 'DIGITAL', variants: { create: { organizationId: orgId, sku: 'DIG-1', price: '12.00', currency: 'USD', shopifyVariantId: 'gid://shopify/ProductVariant/20' } } },
  });
  await prisma.digitalProduct.create({ data: { organizationId: orgId, productId: digital.id, maxDownloads: 3, accessDays: 14 } });
  await prisma.integrationCredential.create({ data: { organizationId: orgId, provider: 'PRINTFUL', accountRef: '777', encryptedSecret: 'x' } });
  shopify.orders.set('gid://shopify/Order/5001', shopifyOrder());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Shopify order intake', () => {
  it('stores, classifies and processes a mixed order from a webhook event', async () => {
    const event = await shopifyEvent('wh-1', 'gid://shopify/Order/5001', 'orders/create');
    expect(event.status).toBe('PROCESSED');
    const order = await prisma.order.findFirstOrThrow({ where: { organizationId: orgId }, include: { items: true, payments: true, customer: true } });
    orderId = order.id;
    expect(Object.fromEntries(order.items.map((i) => [i.sku, i.itemType]))).toEqual({ 'CAT-M': 'POD', 'DIG-1': 'DIGITAL', MYSTERY: 'UNCLASSIFIED' });
    expect(order.payments[0].fee.toFixed(2)).toBe('2.24');
    expect(order.customer?.email).toBe('buyer@example.com');
  });

  it('opens review tasks instead of guessing: unmapped items block fulfillment', async () => {
    const tasks = await prisma.reviewTask.findMany({ where: { organizationId: orgId }, orderBy: { kind: 'asc' } });
    expect(tasks.map((t) => t.kind)).toEqual(['fulfillment.ineligible', 'order.unmapped_items']);
    expect(await prisma.fulfillmentOrder.count()).toBe(0);
  });

  it('grants a digital entitlement on confirmed payment and emails a working link', async () => {
    const ent = await prisma.downloadEntitlement.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(ent).toMatchObject({ email: 'buyer@example.com', maxDownloads: 3, status: 'ACTIVE' });
    expect(ent.emailSentAt).not.toBeNull();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.lastTokenHash()).toBe(ent.tokenHash);
  });

  it('creates exactly one fulfillment task once items are mapped, however often the workflow runs', async () => {
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId, sku: 'MYSTERY' } });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { sku: 'CAT-M' } });
    await prisma.orderItem.update({ where: { id: item.id }, data: { variantId: variant.id, itemType: 'POD' } });
    await runOrderWorkflow(ctx, orderId);
    await runOrderWorkflow(ctx, orderId);
    await shopifyEvent('wh-2', 'gid://shopify/Order/5001');
    const fos = await prisma.fulfillmentOrder.findMany({ where: { orderId } });
    expect(fos).toHaveLength(1);
    expect(fos[0].status).toBe('AWAITING_APPROVAL');
    expect(mailer.sent).toHaveLength(1); // no duplicate download emails on re-sync
  });
});

describe('Printful fulfillment', () => {
  it('refuses live submission in demo mode', async () => {
    const fo = await prisma.fulfillmentOrder.findFirstOrThrow({ where: { orderId } });
    const after = await approveAndSubmit(fo.id);
    expect(after.status).toBe('FAILED');
    expect(printful.createCalls).toBe(0);
  });

  it('treats a timeout as unknown, then a retry adopts the existing provider order instead of duplicating it', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { demoMode: false } });
    const fo = await prisma.fulfillmentOrder.findFirstOrThrow({ where: { orderId } });
    printful.timeoutNextCreate = true;
    const timedOut = await approveAndSubmit(fo.id);
    expect(timedOut.status).toBe('NEEDS_REVIEW');
    expect(await prisma.reviewTask.count({ where: { kind: 'fulfillment.timeout' } })).toBe(1);

    const retried = await approveAndSubmit(fo.id);
    expect(printful.createCalls).toBe(1);
    expect(printful.orders.size).toBe(1);
    expect(retried).toMatchObject({ status: 'SUBMITTED', externalId: '1000', currency: 'USD' });
    expect(retried.productionCost?.toFixed(2)).toBe('11.50');
    expect(retried.idempotencyKey).toBe(`${orderId}:printful`);
  });

  it('applies Printful shipment webhooks using re-fetched provider state', async () => {
    const provider = printful.orders.get('1000')!;
    provider.status = 'shipped';
    provider.rawStatus = 'fulfilled';
    provider.shipments = [{ carrier: 'USPS', trackingNumber: '9400', trackingUrl: 'https://t/9400', shippedAt: '2026-05-12' }];
    const e = await prisma.integrationEvent.create({
      data: { organizationId: orgId, provider: 'PRINTFUL', eventId: 'package_shipped:1000:1', topic: 'package_shipped', payload: { printfulOrderId: 1000, externalId: `${orderId}:printful` } },
    });
    await processIntegrationEvent(ctx, e.id);
    const fo = await prisma.fulfillmentOrder.findFirstOrThrow({ where: { orderId }, include: { events: true } });
    expect(fo).toMatchObject({ status: 'SHIPPED', carrier: 'USPS', trackingNumber: '9400' });
    expect(fo.events.map((ev) => ev.type)).toContain('webhook');
  });
});

describe('refunds', () => {
  it('revokes digital access when the order is fully refunded', async () => {
    shopify.orders.set('gid://shopify/Order/5001', shopifyOrder({
      paymentStatus: 'REFUNDED',
      refunds: [{ externalId: 'gid://shopify/Refund/1', amount: '66.97', currency: 'USD', reason: 'Customer request', processedAt: new Date('2026-05-15') }],
    }));
    await shopifyEvent('wh-3', 'gid://shopify/Order/5001', 'refunds/create');
    const ent = await prisma.downloadEntitlement.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(ent).toMatchObject({ status: 'REVOKED', revokedReason: 'Order fully refunded' });
    expect(await prisma.refund.count({ where: { orderId } })).toBe(1);
  });
});

describe('digital delivery edge cases', () => {
  it('rotates the token and re-sends when the first email failed', async () => {
    shopify.orders.set('gid://shopify/Order/6001', shopifyOrder({
      externalId: 'gid://shopify/Order/6001', orderNumber: '#6001',
      lineItems: [{ externalId: 'li-6', variantExternalId: 'gid://shopify/ProductVariant/20', sku: 'DIG-1', title: 'Brush Pack', quantity: 1, unitPrice: '12.00', totalDiscount: '0.00' }],
      payments: [],
    }));
    mailer.failNext = true;
    await expect(shopifyEvent('wh-6', 'gid://shopify/Order/6001', 'orders/create')).rejects.toThrow('SMTP unavailable');
    const item = await prisma.orderItem.findFirstOrThrow({ where: { externalLineItemId: 'li-6' }, include: { entitlement: true } });
    expect(item.entitlement?.emailSentAt).toBeNull();
    const firstHash = item.entitlement!.tokenHash;

    await grantEntitlement(ctx, item.id);
    const ent = await prisma.downloadEntitlement.findUniqueOrThrow({ where: { orderItemId: item.id } });
    expect(ent.tokenHash).not.toBe(firstHash);
    expect(mailer.lastTokenHash()).toBe(ent.tokenHash);
    expect(await prisma.downloadEntitlement.count({ where: { orderItemId: item.id } })).toBe(1);
  });

  it('logs SKIPPED and grants nothing when the optional rule is disabled', async () => {
    await prisma.automationRule.updateMany({ where: { organizationId: orgId, key: 'digital.entitlement.grant' }, data: { enabled: false } });
    shopify.orders.set('gid://shopify/Order/7001', shopifyOrder({
      externalId: 'gid://shopify/Order/7001', orderNumber: '#7001',
      lineItems: [{ externalId: 'li-7', variantExternalId: 'gid://shopify/ProductVariant/20', sku: 'DIG-1', title: 'Brush Pack', quantity: 1, unitPrice: '12.00', totalDiscount: '0.00' }],
      payments: [],
    }));
    await shopifyEvent('wh-7', 'gid://shopify/Order/7001', 'orders/create');
    const item = await prisma.orderItem.findFirstOrThrow({ where: { externalLineItemId: 'li-7' }, include: { entitlement: true } });
    expect(item.entitlement).toBeNull();
    expect(await prisma.automationRun.count({ where: { subjectId: item.id, status: 'SKIPPED' } })).toBe(1);
  });
});

describe('Amazon Merch royalties', () => {
  const header = 'Date,ASIN,Marketplace,Title,Product Type,Purchased,Returned,Royalties,Currency\n';
  const rowA = '2026-05-01,B0CATTEE01,amazon.com,Cat Tee,Standard T-Shirt,3,0,7.41,USD\n';
  const rowB = '2026-05-02,B0CATTEE01,amazon.com,Cat Tee,Standard T-Shirt,1,0,2.47,USD\n';

  async function upload(name: string, csv: string) {
    storage.objects.set(`report-archives/${name}`, Buffer.from(csv));
    const rec = await prisma.amazonReportImport.create({
      data: { organizationId: orgId, formatId: 'merch-royalties-v1', fileName: name, bucket: 'report-archives', objectKey: name, checksumSha256: name, uploadedById: 'u' },
    });
    await importAmazonReport(ctx, rec.id);
    return prisma.amazonReportImport.findUniqueOrThrow({ where: { id: rec.id } });
  }

  it('imports royalties, maps them to listings and dedupes overlapping reports', async () => {
    const design = await prisma.design.findFirstOrThrow({ where: { organizationId: orgId } });
    await prisma.marketplaceListing.create({ data: { organizationId: orgId, channel: 'AMAZON_MERCH', marketplace: 'amazon.com', externalId: 'B0CATTEE01', designId: design.id, status: 'LIVE' } });
    const first = await upload('may-1.csv', header + rowA);
    expect(first).toMatchObject({ status: 'COMPLETED', importedCount: 1, duplicateCount: 0 });
    const second = await upload('may-2.csv', header + rowA + rowB);
    expect(second).toMatchObject({ status: 'COMPLETED', importedCount: 1, duplicateCount: 1 });
    const royalties = await prisma.royaltyTransaction.findMany({ where: { organizationId: orgId } });
    expect(royalties).toHaveLength(2);
    expect(royalties.every((r) => r.listingId !== null)).toBe(true);
  });

  it('flags payout mismatches for review and reconciles matching payouts', async () => {
    const period = { periodStart: new Date('2026-05-01'), periodEnd: new Date('2026-05-31'), currency: 'USD', source: 'AMAZON_MERCH' as const, status: 'PAID' as const, organizationId: orgId };
    const good = await prisma.payout.create({ data: { ...period, externalId: 'p-ok', amount: '9.88' } });
    await reconcilePayouts(ctx);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: good.id } })).status).toBe('RECONCILED');
    const bad = await prisma.payout.create({ data: { ...period, externalId: 'p-bad', amount: '50.00' } });
    await reconcilePayouts(ctx);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe('MISMATCH');
    expect(await prisma.reviewTask.count({ where: { kind: 'payout.mismatch', subjectId: bad.id } })).toBe(1);
  });
});
