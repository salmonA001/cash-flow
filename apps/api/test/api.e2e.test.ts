import { createHmac } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@cfe/database';
import { createTestApp, PASSWORD, seedOrg } from './app';
import { FakeStorage } from './fake-storage';

const ORIGIN = 'http://localhost:3000';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let app: NestExpressApplication;
let prisma: PrismaClient;
let storage: FakeStorage;
let orgId: string;
let owner: TestAgent;
let viewer: TestAgent;
let otherOrg: TestAgent;

async function login(email: string) {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/v1/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD }).expect(204);
  return agent;
}

beforeAll(async () => {
  ({ app, prisma, storage } = await createTestApp());
  const { org } = await seedOrg(prisma, 'acme', [
    { email: 'owner@acme.test', role: 'Owner' },
    { email: 'viewer@acme.test', role: 'Viewer' },
  ]);
  orgId = org.id;
  await seedOrg(prisma, 'other', [{ email: 'owner@other.test', role: 'Owner' }]);
  owner = await login('owner@acme.test');
  viewer = await login('viewer@acme.test');
  otherOrg = await login('owner@other.test');
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe('platform', () => {
  it('reports health of database, redis and storage', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok', storage: 'ok' } });
  });

  it('rejects bad credentials without revealing which part was wrong', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ email: 'owner@acme.test', password: 'nope' }).expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
  });

  it('returns the session user with permissions', async () => {
    const res = await owner.get('/api/v1/auth/me').expect(200);
    expect(res.body).toMatchObject({ email: 'owner@acme.test', organizationId: orgId, roleName: 'Owner' });
    expect(res.body.permissions).toContain('fulfillment:approve');
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/designs').expect(401);
  });

  it('rejects cross-origin state-changing requests (CSRF)', async () => {
    await owner.post('/api/v1/collections').send({ name: 'x' }).expect(403);
    await owner.post('/api/v1/collections').set('Origin', 'https://evil.test').send({ name: 'x' }).expect(403);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const agent = await login('owner@acme.test');
    await agent.post('/api/v1/auth/refresh').set('Origin', ORIGIN).expect(204);
    await agent.get('/api/v1/auth/me').expect(200);
    await agent.post('/api/v1/auth/logout').set('Origin', ORIGIN).expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('returns consistent validation errors', async () => {
    const res = await owner.post('/api/v1/designs').set('Origin', ORIGIN).send({ title: '' }).expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
    expect(res.body.details[0].path).toBe('title');
  });
});

describe('design → product → listing workflow', () => {
  let designId: string;
  let printFileId: string;

  it('creates a design inside a collection', async () => {
    const col = await owner.post('/api/v1/collections').set('Origin', ORIGIN).send({ name: 'Cats' }).expect(201);
    const res = await owner.post('/api/v1/designs').set('Origin', ORIGIN).send({ title: 'Cat Tee', tags: ['Cats'], collectionIds: [col.body.id] }).expect(201);
    designId = res.body.id;
    const list = await owner.get('/api/v1/designs?q=cats').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]._count.versions).toBe(1);
  });

  it('uploads artwork with validation, checksum and a new version', async () => {
    await owner.post(`/api/v1/designs/${designId}/assets`).set('Origin', ORIGIN).field('kind', 'PRINT_FILE').attach('file', Buffer.from('not png'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
    const res = await owner
      .post(`/api/v1/designs/${designId}/assets`)
      .set('Origin', ORIGIN)
      .field('kind', 'PRINT_FILE')
      .field('newVersion', 'true')
      .attach('file', PNG, { filename: 'cat.png', contentType: 'image/png' })
      .expect(201);
    printFileId = res.body.id;
    expect(res.body.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect([...storage.objects.keys()][0]).toMatch(new RegExp(`^design-exports/${orgId}/designs/${designId}/\\d+-cat.png$`));
    const design = await owner.get(`/api/v1/designs/${designId}`).expect(200);
    expect(design.body.versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
    const url = await owner.get(`/api/v1/assets/${printFileId}/url`).expect(200);
    expect(url.body.expiresInSeconds).toBe(300);
  });

  it('blocks listings for unapproved designs, then allows them after approval', async () => {
    const listing = { channel: 'AMAZON_MERCH', marketplace: 'amazon.com', externalId: 'B0CATTEE01', designId };
    await owner.post('/api/v1/listings').set('Origin', ORIGIN).send(listing).expect(400);
    await viewer.patch(`/api/v1/designs/${designId}`).set('Origin', ORIGIN).send({ status: 'APPROVED' }).expect(403);
    await owner.patch(`/api/v1/designs/${designId}`).set('Origin', ORIGIN).send({ status: 'APPROVED' }).expect(200);
    await owner.post('/api/v1/listings').set('Origin', ORIGIN).send(listing).expect(201);
    await owner.post('/api/v1/listings').set('Origin', ORIGIN).send(listing).expect(409);
  });

  it('creates a POD product with a mapped variant', async () => {
    const res = await owner
      .post('/api/v1/products')
      .set('Origin', ORIGIN)
      .send({ title: 'Cat Tee', designId, variants: [{ sku: 'CAT-M-BLK', size: 'M', color: 'Black', price: '24.99', currency: 'USD', printfulVariantId: 4012, printFileAssetId: printFileId, shopifyVariantId: 'gid://shopify/ProductVariant/1' }] })
      .expect(201);
    expect(res.body.type).toBe('POD');
    expect(res.body.variants[0].price).toBe('24.99');
  });

  it('isolates organizations', async () => {
    await otherOrg.get(`/api/v1/designs/${designId}`).expect(404);
    const list = await otherOrg.get('/api/v1/designs').expect(200);
    expect(list.body.total).toBe(0);
  });
});

describe('webhooks', () => {
  const sign = (body: string) => createHmac('sha256', 'test-shopify-secret').update(body).digest('base64');

  beforeAll(async () => {
    await prisma.integrationCredential.create({ data: { organizationId: orgId, provider: 'SHOPIFY', accountRef: 'acme.myshopify.com', encryptedSecret: 'x' } });
  });

  it('rejects unsigned Shopify webhooks', async () => {
    await request(app.getHttpServer()).post('/api/v1/webhooks/shopify').set('Content-Type', 'application/json').set('X-Shopify-Hmac-Sha256', 'bad').send('{"id":1}').expect(401);
  });

  it('accepts a signed webhook once and deduplicates redeliveries', async () => {
    const body = JSON.stringify({ admin_graphql_api_id: 'gid://shopify/Order/1001' });
    const send = () =>
      request(app.getHttpServer())
        .post('/api/v1/webhooks/shopify')
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', sign(body))
        .set('X-Shopify-Shop-Domain', 'acme.myshopify.com')
        .set('X-Shopify-Topic', 'orders/create')
        .set('X-Shopify-Webhook-Id', 'wh-1')
        .send(body);
    expect((await send().expect(200)).body.status).toBe('accepted');
    expect((await send().expect(200)).body.status).toBe('duplicate');
    const events = await prisma.integrationEvent.findMany({ where: { organizationId: orgId } });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ orderGid: 'gid://shopify/Order/1001' });
  });

  it('rejects Printful webhooks without the shared token', async () => {
    await request(app.getHttpServer()).post('/api/v1/webhooks/printful?token=wrong').send({ type: 'package_shipped', store: 1, created: 1, retries: 0, data: {} }).expect(401);
  });
});

describe('Amazon Merch import', () => {
  const csv = 'Date,ASIN,Marketplace,Title,Product Type,Purchased,Returned,Royalties,Currency\n2026-05-01,B0CATTEE01,amazon.com,Cat Tee,Standard T-Shirt,3,0,7.41,USD\n2026-05-02,BAD,amazon.com,X,Y,1,0,1.00,USD\n';

  it('previews a report with row-level errors', async () => {
    const res = await owner.post('/api/v1/amazon-merch/reports/preview').set('Origin', ORIGIN).attach('file', Buffer.from(csv), { filename: 'r.csv', contentType: 'text/csv' }).expect(200);
    expect(res.body).toMatchObject({ formatId: 'merch-royalties-v1', validRows: 1, alreadyImported: 0 });
    expect(res.body.errors).toEqual([{ rowNumber: 3, field: 'ASIN', message: 'Invalid ASIN "BAD"' }]);
  });

  it('archives and queues an import, rejecting an identical re-upload', async () => {
    const upload = () => owner.post('/api/v1/amazon-merch/reports/import').set('Origin', ORIGIN).attach('file', Buffer.from(csv), { filename: 'r.csv', contentType: 'text/csv' });
    const res = await upload().expect(202);
    expect(res.body.status).toBe('PENDING');
    expect(storage.objects.has(`report-archives/${res.body.objectKey}`)).toBe(true);
    await upload().expect(409);
  });
});

describe('finance', () => {
  it('fails loudly when an exchange rate is missing, then computes once it exists', async () => {
    await owner.post('/api/v1/finance/expenses').set('Origin', ORIGIN).send({ category: 'SOFTWARE', description: 'Design tool', amount: '20.00', currency: 'EUR', incurredOn: '2026-05-01' }).expect(201);
    const missing = await owner.get('/api/v1/finance/summary?from=2026-05-01&to=2026-05-31').expect(422);
    expect(missing.body.details).toEqual(['EUR->USD on/before 2026-05-01']);
    await owner.post('/api/v1/finance/exchange-rates').set('Origin', ORIGIN).send({ base: 'EUR', quote: 'USD', rate: '1.10', rateDate: '2026-04-30' }).expect(201);
    const res = await owner.get('/api/v1/finance/summary?from=2026-05-01&to=2026-05-31').expect(200);
    expect(res.body).toMatchObject({ baseCurrency: 'USD', totalExpenses: '22.00', estimatedNetProfit: '-22.00', unallocatedSharedCosts: '22.00' });
  });

  it('enforces permissions', async () => {
    await viewer.get('/api/v1/finance/summary').expect(200);
    await viewer.post('/api/v1/finance/expenses').set('Origin', ORIGIN).send({ category: 'OTHER', description: 'x', amount: '1.00', currency: 'USD', incurredOn: '2026-05-01' }).expect(403);
  });

  it('validates platform fees belong to the Shopify channel', async () => {
    await owner.post('/api/v1/finance/expenses').set('Origin', ORIGIN).send({ category: 'PLATFORM_FEES', description: 'Shopify plan', amount: '39.00', currency: 'USD', incurredOn: '2026-05-01' }).expect(400);
  });
});

describe('fulfillment and digital delivery safeguards', () => {
  let digitalProductId: string;
  let orderItemId: string;
  let fulfillmentId: string;

  beforeAll(async () => {
    const dp = await owner.post('/api/v1/digital-products').set('Origin', ORIGIN).send({ title: 'Brush Pack', sku: 'DIG-BRUSH', price: '12.00', currency: 'USD' }).expect(201);
    digitalProductId = dp.body.id;
    const order = await prisma.order.create({
      data: {
        organizationId: orgId, source: 'SHOPIFY', externalId: 'gid://shopify/Order/2002', orderNumber: '#2002', currency: 'USD',
        paymentStatus: 'PENDING', subtotal: '12.00', shippingTotal: '0', taxTotal: '0', discountTotal: '0', total: '12.00', placedAt: new Date(),
        items: { create: { organizationId: orgId, externalLineItemId: 'li-1', title: 'Brush Pack', quantity: 1, unitPrice: '12.00', totalDiscount: '0', itemType: 'DIGITAL', variantId: dp.body.product.variants[0].id } },
        fulfillments: { create: { organizationId: orgId, provider: 'PRINTFUL', idempotencyKey: 'test:printful' } },
      },
      include: { items: true, fulfillments: true },
    });
    orderItemId = order.items[0].id;
    fulfillmentId = order.fulfillments[0].id;
  });

  it('uploads versioned digital files', async () => {
    await owner.post(`/api/v1/digital-products/${digitalProductId}/files`).set('Origin', ORIGIN).attach('file', PNG, { filename: 'v1.png', contentType: 'image/png' }).expect(201);
    const v2 = await owner.post(`/api/v1/digital-products/${digitalProductId}/files`).set('Origin', ORIGIN).attach('file', PNG, { filename: 'v2.png', contentType: 'image/png' }).expect(201);
    expect(v2.body.version).toBe(2);
    const detail = await owner.get(`/api/v1/digital-products/${digitalProductId}`).expect(200);
    expect(detail.body.assets.filter((a: { isCurrent: boolean }) => a.isCurrent)).toHaveLength(1);
  });

  it('refuses download grants for unpaid orders (server-side payment check)', async () => {
    const res = await owner.post(`/api/v1/downloads/${digitalProductId}/grant`).set('Origin', ORIGIN).send({ orderItemId }).expect(409);
    expect(res.body.message).toContain('PENDING');
  });

  it('queues the grant once the order is paid', async () => {
    await prisma.order.updateMany({ where: { externalId: 'gid://shopify/Order/2002' }, data: { paymentStatus: 'PAID' } });
    const res = await owner.post(`/api/v1/downloads/${digitalProductId}/grant`).set('Origin', ORIGIN).send({ orderItemId }).expect(202);
    expect(res.body.status).toBe('QUEUED');
  });

  it('returns 410 for unknown download tokens', async () => {
    await request(app.getHttpServer()).get('/api/v1/downloads/access/not-a-real-token').expect(410);
  });

  it('requires explicit confirmation and blocks live fulfillment in demo mode', async () => {
    await owner.post(`/api/v1/fulfillment/${fulfillmentId}/submit`).set('Origin', ORIGIN).send({}).expect(400);
    const res = await owner.post(`/api/v1/fulfillment/${fulfillmentId}/submit`).set('Origin', ORIGIN).send({ confirm: true }).expect(409);
    expect(res.body.message).toContain('Demo mode');
    await viewer.post(`/api/v1/fulfillment/${fulfillmentId}/submit`).set('Origin', ORIGIN).send({ confirm: true }).expect(403);
  });
});

describe('automation', () => {
  it('lists built-in rules and refuses to disable core workflow steps', async () => {
    const res = await owner.get('/api/v1/automation/rules').expect(200);
    const core = res.body.rules.find((r: { key: string }) => r.key === 'shopify.order.classify');
    const optional = res.body.rules.find((r: { key: string }) => r.key === 'digital.entitlement.grant');
    await owner.patch(`/api/v1/automation/rules/${core.id}`).set('Origin', ORIGIN).send({ enabled: false }).expect(409);
    await owner.patch(`/api/v1/automation/rules/${optional.id}`).set('Origin', ORIGIN).send({ enabled: false }).expect(200);
  });

  it('records automation runs for workflow events', async () => {
    const runs = await owner.get('/api/v1/automation/runs').expect(200);
    const actions = runs.body.items.map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['design.create_version', 'listing.allow', 'finance.refresh', 'entitlement.grant']));
  });
});
