import { execSync } from 'node:child_process';
import path from 'node:path';
import { AUTOMATION_CATALOG, hashDownloadToken } from '@cfe/business-rules';
import { PrismaClient } from '@cfe/database';
import {
  FulfillmentProvider,
  FulfillmentRequest,
  NormalizedShopifyOrder,
  ProviderOrder,
  ProviderTimeoutError,
} from '@cfe/integration-sdk';
import type { WorkerContext } from '../src/context';

export const DB_URL = process.env.WORKER_TEST_DATABASE_URL ?? 'postgresql://cfe:cfe@localhost:5432/cfe_worker_test?schema=public';

/** Recreates the disposable test schema. Refuses any database not named *_test. */
export async function resetDatabase(): Promise<PrismaClient> {
  if (!new URL(DB_URL).pathname.endsWith('_test')) throw new Error('Refusing to reset a non-test database');
  const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../../../packages/database'),
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'pipe',
  });
  return prisma;
}

export async function seedOrg(prisma: PrismaClient, slug: string) {
  const org = await prisma.organization.create({ data: { name: slug, slug } });
  for (const { key, name, trigger, action, level } of AUTOMATION_CATALOG) {
    await prisma.automationRule.create({ data: { organizationId: org.id, key, name, trigger, action, level } });
  }
  return org;
}

export class FakeShopify {
  orders = new Map<string, NormalizedShopifyOrder>();
  async getOrder(gid: string) {
    return this.orders.get(gid) ?? null;
  }
  async listOrderIdsUpdatedSince() {
    return { ids: [...this.orders.keys()], nextCursor: null };
  }
}

/** In-memory Printful. `timeoutNextCreate` simulates a request that reached Printful but timed out. */
export class FakePrintful implements FulfillmentProvider {
  orders = new Map<string, ProviderOrder>();
  createCalls = 0;
  timeoutNextCreate = false;

  async getCatalog() {
    return [];
  }
  async getOrder(id: string) {
    const o = id.startsWith('@') ? [...this.orders.values()].find((x) => x.externalId === id.slice(1)) : this.orders.get(id);
    if (!o) throw new Error(`order ${id} not found`);
    return o;
  }
  async findOrderByExternalId(externalId: string) {
    return [...this.orders.values()].find((o) => o.externalId === externalId) ?? null;
  }
  async createOrder(input: FulfillmentRequest) {
    this.createCalls++;
    const order: ProviderOrder = {
      id: String(1000 + this.orders.size),
      externalId: input.externalId,
      status: 'draft',
      rawStatus: 'draft',
      costs: { currency: 'USD', production: '11.50', shipping: '4.69', tax: '0.00', total: '16.19' },
      shipments: [],
    };
    this.orders.set(order.id, order);
    if (this.timeoutNextCreate) {
      this.timeoutNextCreate = false;
      throw new ProviderTimeoutError('POST /orders');
    }
    return order;
  }
  async confirmOrder(id: string) {
    const o = this.orders.get(id)!;
    o.status = 'pending';
    o.rawStatus = 'pending';
    return o;
  }
  async cancelOrder(id: string) {
    const o = this.orders.get(id)!;
    o.status = 'cancelled';
    o.rawStatus = 'canceled';
    return o;
  }
  async getTracking(id: string) {
    return this.orders.get(id)!.shipments;
  }
}

export class FakeMailer {
  sent: { to: string; subject: string; text: string }[] = [];
  failNext = false;
  async send(m: { to: string; subject: string; text: string }) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('SMTP unavailable');
    }
    this.sent.push(m);
  }
  /** Extracts the token from the latest email and returns its hash. */
  lastTokenHash() {
    const token = this.sent.at(-1)!.text.match(/downloads\/access\/([\w-]+)/)![1];
    return hashDownloadToken(token);
  }
}

export class FakeStorage {
  objects = new Map<string, Buffer>();
  async getObject(bucket: string, key: string) {
    const o = this.objects.get(`${bucket}/${key}`);
    if (!o) throw new Error('NoSuchKey');
    return o;
  }
  async presignedGet(bucket: string, key: string, expiry: number) {
    return `https://files.test/${bucket}/${key}?expires=${expiry}`;
  }
  async cleanupTemporaryUploads() {
    return 0;
  }
}

export function buildContext(prisma: PrismaClient) {
  const shopify = new FakeShopify();
  const printful = new FakePrintful();
  const mailer = new FakeMailer();
  const storage = new FakeStorage();
  const ctx: WorkerContext = {
    prisma,
    storage,
    mailer,
    apiUrl: 'https://api.test',
    shopify: async () => shopify,
    printful: async () => printful,
  };
  return { ctx, shopify, printful, mailer, storage };
}

export function shopifyOrder(overrides: Partial<NormalizedShopifyOrder> = {}): NormalizedShopifyOrder {
  return {
    externalId: 'gid://shopify/Order/5001',
    orderNumber: '#5001',
    placedAt: new Date('2026-05-10T12:00:00Z'),
    cancelledAt: null,
    currency: 'USD',
    paymentStatus: 'PAID',
    subtotal: '61.98',
    shippingTotal: '4.99',
    taxTotal: '0.00',
    discountTotal: '0.00',
    total: '66.97',
    customer: { externalId: 'gid://shopify/Customer/1', email: 'buyer@example.com', name: 'Ada Buyer' },
    shippingAddress: { name: 'Ada Buyer', address1: '1 Main St', address2: null, city: 'Austin', provinceCode: 'TX', countryCode: 'US', zip: '78701', phone: null },
    lineItems: [
      { externalId: 'li-pod', variantExternalId: 'gid://shopify/ProductVariant/10', sku: 'CAT-M', title: 'Cat Tee', quantity: 1, unitPrice: '24.99', totalDiscount: '0.00' },
      { externalId: 'li-dig', variantExternalId: 'gid://shopify/ProductVariant/20', sku: 'DIG-1', title: 'Brush Pack', quantity: 1, unitPrice: '12.00', totalDiscount: '0.00' },
      { externalId: 'li-unk', variantExternalId: 'gid://shopify/ProductVariant/99', sku: 'MYSTERY', title: 'Unknown', quantity: 1, unitPrice: '24.99', totalDiscount: '0.00' },
    ],
    payments: [{ externalId: 'gid://shopify/OrderTransaction/1', gateway: 'shopify_payments', amount: '66.97', fee: '2.24', currency: 'USD', succeeded: true, processedAt: new Date('2026-05-10T12:00:00Z') }],
    refunds: [],
    ...overrides,
  };
}
