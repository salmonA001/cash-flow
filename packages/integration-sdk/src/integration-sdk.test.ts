import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildObjectKey,
  decryptSecret,
  DESIGN_FILE_POLICY,
  encryptSecret,
  PrintfulAdapter,
  ProviderTimeoutError,
  ShopifyClient,
  validateFile,
  verifyOAuthCallback,
  verifyShopifyWebhook,
} from './index';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Shopify webhook verification', () => {
  const secret = 'shpss_test';
  const body = Buffer.from('{"id":1}');
  const valid = createHmac('sha256', secret).update(body).digest('base64');

  it('accepts a correctly signed body', () => expect(verifyShopifyWebhook(body, valid, secret)).toBe(true));
  it('rejects tampered bodies, wrong secrets and missing headers', () => {
    expect(verifyShopifyWebhook(Buffer.from('{"id":2}'), valid, secret)).toBe(false);
    expect(verifyShopifyWebhook(body, valid, 'other')).toBe(false);
    expect(verifyShopifyWebhook(body, undefined, secret)).toBe(false);
  });

  it('verifies OAuth callback query HMAC', () => {
    const params = { code: 'abc', shop: 'demo.myshopify.com', state: 'n1', timestamp: '1700000000' };
    const msg = 'code=abc&shop=demo.myshopify.com&state=n1&timestamp=1700000000';
    const hmac = createHmac('sha256', secret).update(msg).digest('hex');
    expect(verifyOAuthCallback({ ...params, hmac }, secret)).toBe(true);
    expect(verifyOAuthCallback({ ...params, shop: 'evil.myshopify.com', hmac }, secret)).toBe(false);
  });
});

describe('ShopifyClient', () => {
  it('waits and retries when throttled', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, {
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          extensions: { cost: { requestedQueryCost: 50, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } } },
        }),
      )
      .mockResolvedValueOnce(json(200, { data: { shop: { name: 'Demo', currencyCode: 'USD', myshopifyDomain: 'demo.myshopify.com' } } }));
    const client = new ShopifyClient({ shop: 'demo.myshopify.com', accessToken: 't', fetchImpl, sleep });
    expect((await client.getShop()).name).toBe('Demo');
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(fetchImpl.mock.calls[0][0]).toContain('/admin/api/2026-07/graphql.json');
  });

  it('rejects invalid shop domains', () => {
    expect(() => new ShopifyClient({ shop: 'evil.com', accessToken: 't' })).toThrow();
  });
});

describe('PrintfulAdapter', () => {
  const order = { id: 77, external_id: 'ord_1:printful', status: 'draft', costs: { currency: 'USD', subtotal: '12.95', shipping: '4.75', tax: '0.00', total: '17.70' }, shipments: [] };

  it('creates draft orders with the idempotency key as external_id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { code: 200, result: order }));
    const adapter = new PrintfulAdapter({ apiToken: 'tok', fetchImpl });
    const result = await adapter.createOrder({
      externalId: 'ord_1:printful',
      recipient: { name: 'Ada', address1: '1 Main', city: 'Austin', countryCode: 'US', stateCode: 'TX', zip: '78701' },
      items: [{ providerVariantId: 4012, quantity: 1, printFileUrl: 'https://f/x.png' }],
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.printful.com/orders?confirm=false');
    expect(JSON.parse(init.body).external_id).toBe('ord_1:printful');
    expect(result).toMatchObject({ id: '77', status: 'draft', costs: { production: '12.95', shipping: '4.75' } });
  });

  it('surfaces timeouts as outcome-unknown errors', async () => {
    const err = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const adapter = new PrintfulAdapter({ apiToken: 'tok', fetchImpl: vi.fn().mockRejectedValue(err) });
    await expect(adapter.getOrder('1')).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('looks up by external ID and returns null when absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(404, { code: 404, result: 'Not found', error: { message: 'Not found' } }));
    const adapter = new PrintfulAdapter({ apiToken: 'tok', fetchImpl });
    expect(await adapter.findOrderByExternalId('ord_1:printful')).toBeNull();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.printful.com/orders/%40ord_1%3Aprintful');
  });
});

describe('credential encryption', () => {
  it('round-trips and detects tampering', () => {
    const key = randomBytes(32);
    const enc = encryptSecret('shpat_secret', key);
    expect(enc).not.toContain('shpat_secret');
    expect(decryptSecret(enc, key)).toBe('shpat_secret');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });
});

describe('file validation', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  it('accepts a real PNG', () => {
    expect(() => validateFile({ originalname: 'a.png', mimetype: 'image/png', size: png.length, buffer: png }, DESIGN_FILE_POLICY)).not.toThrow();
  });
  it('rejects spoofed content, wrong extensions and scripted SVGs', () => {
    const fake = Buffer.from('not a png');
    expect(() => validateFile({ originalname: 'a.png', mimetype: 'image/png', size: fake.length, buffer: fake }, DESIGN_FILE_POLICY)).toThrow();
    expect(() => validateFile({ originalname: 'a.exe', mimetype: 'image/png', size: png.length, buffer: png }, DESIGN_FILE_POLICY)).toThrow();
    const svg = Buffer.from('<svg onload="alert(1)"></svg>');
    expect(() => validateFile({ originalname: 'a.svg', mimetype: 'image/svg+xml', size: svg.length, buffer: svg }, DESIGN_FILE_POLICY)).toThrow();
  });
  it('builds structured, sanitized object keys', () => {
    expect(buildObjectKey('org1', 'designs', 'd1', '../My File!.png', new Date(1000))).toBe('org1/designs/d1/1000-.._My_File_.png');
  });
});
