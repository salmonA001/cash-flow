import { createHmac, timingSafeEqual } from 'node:crypto';

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function assertShopDomain(shop: string): string {
  const normalized = shop.trim().toLowerCase();
  if (!SHOP_DOMAIN.test(normalized)) throw new Error(`Invalid Shopify shop domain "${shop}"`);
  return normalized;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Verifies X-Shopify-Hmac-Sha256: base64(HMAC-SHA256(raw body, app client secret)). */
export function verifyShopifyWebhook(rawBody: Buffer, hmacHeader: string | undefined, clientSecret: string): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac('sha256', clientSecret).update(rawBody).digest('base64');
  return safeEqual(digest, hmacHeader);
}

export function buildInstallUrl(params: { shop: string; clientId: string; scopes: string; redirectUri: string; state: string }): string {
  const shop = assertShopDomain(params.shop);
  const q = new URLSearchParams({
    client_id: params.clientId,
    scope: params.scopes,
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  return `https://${shop}/admin/oauth/authorize?${q.toString()}`;
}

/** Verifies the `hmac` query parameter on the OAuth callback (hex HMAC over the sorted remaining params). */
export function verifyOAuthCallback(query: Record<string, string>, clientSecret: string): boolean {
  const { hmac, signature: _signature, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const digest = createHmac('sha256', clientSecret).update(message).digest('hex');
  return safeEqual(digest, hmac);
}

export async function exchangeOAuthCode(params: {
  shop: string;
  clientId: string;
  clientSecret: string;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; scope: string }> {
  const shop = assertShopDomain(params.shop);
  const res = await (params.fetchImpl ?? fetch)(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: params.clientId, client_secret: params.clientSecret, code: params.code }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; scope: string };
  return { accessToken: json.access_token, scope: json.scope };
}
