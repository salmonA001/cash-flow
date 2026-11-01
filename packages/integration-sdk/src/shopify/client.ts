import { SHOPIFY_API_VERSION, SHOPIFY_WEBHOOK_TOPICS } from './version';
import { assertShopDomain } from './auth';
import { NormalizedShopifyOrder, ShopifyOrderNode, normalizeShopifyOrder } from './order-mapper';

export interface ShopifyClientConfig {
  shop: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to real sleeping. */
  sleep?: (ms: number) => Promise<void>;
  maxThrottleRetries?: number;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { requestedQueryCost: number; throttleStatus: { currentlyAvailable: number; restoreRate: number } } };
}

export class ShopifyThrottledError extends Error {}

const ORDER_QUERY = /* GraphQL */ `
  query Order($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      cancelledAt
      currencyCode
      displayFinancialStatus
      subtotalPriceSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      customer { id email displayName }
      shippingAddress { name address1 address2 city provinceCode countryCodeV2 zip phone }
      lineItems(first: 100) {
        nodes {
          id sku name quantity
          variant { id }
          originalUnitPriceSet { shopMoney { amount } }
          totalDiscountSet { shopMoney { amount } }
        }
      }
      transactions(first: 50) {
        id kind status gateway processedAt
        amountSet { shopMoney { amount } }
        fees { amount { amount } }
      }
      refunds(first: 50) {
        id createdAt note
        totalRefundedSet { shopMoney { amount } }
      }
    }
  }
`;

export class ShopifyClient {
  private readonly shop: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxThrottleRetries: number;

  constructor(private readonly config: ShopifyClientConfig) {
    this.shop = assertShopDomain(config.shop);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxThrottleRetries = config.maxThrottleRetries ?? 5;
  }

  /** Executes a GraphQL operation. THROTTLED responses are retried after the bucket refills. */
  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`https://${this.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': this.config.accessToken },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 401 || res.status === 403) throw new Error(`Shopify rejected credentials (${res.status})`);
      if (!res.ok && res.status !== 429) throw new Error(`Shopify GraphQL HTTP ${res.status}`);

      const json = (await res.json()) as GraphQLResponse<T>;
      const throttled = res.status === 429 || json.errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        if (attempt >= this.maxThrottleRetries) throw new ShopifyThrottledError('Shopify rate limit: retries exhausted');
        const cost = json.extensions?.cost;
        const waitMs = cost
          ? Math.ceil(((cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable) / cost.throttleStatus.restoreRate) * 1000)
          : 1000 * 2 ** attempt;
        await this.sleep(Math.max(waitMs, 250));
        continue;
      }
      if (json.errors?.length) throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
      return json.data as T;
    }
  }

  async getShop(): Promise<{ name: string; currencyCode: string; myshopifyDomain: string }> {
    const data = await this.graphql<{ shop: { name: string; currencyCode: string; myshopifyDomain: string } }>(
      'query { shop { name currencyCode myshopifyDomain } }',
    );
    return data.shop;
  }

  async getOrder(orderGid: string): Promise<NormalizedShopifyOrder | null> {
    const data = await this.graphql<{ order: ShopifyOrderNode | null }>(ORDER_QUERY, { id: orderGid });
    return data.order ? normalizeShopifyOrder(data.order) : null;
  }

  /** Lists order IDs updated since a timestamp (used by the reconciliation job). */
  async listOrderIdsUpdatedSince(since: Date, after?: string): Promise<{ ids: string[]; nextCursor: string | null }> {
    const data = await this.graphql<{
      orders: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    }>(
      `query Orders($query: String!, $after: String) {
        orders(first: 100, after: $after, query: $query, sortKey: UPDATED_AT) {
          nodes { id }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { query: `updated_at:>='${since.toISOString()}'`, after: after ?? null },
    );
    return {
      ids: data.orders.nodes.map((n) => n.id),
      nextCursor: data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null,
    };
  }

  async registerWebhooks(callbackUrl: string): Promise<{ topic: string; ok: boolean; error?: string }[]> {
    const results: { topic: string; ok: boolean; error?: string }[] = [];
    for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
      const data = await this.graphql<{
        webhookSubscriptionCreate: { userErrors: { message: string }[] };
      }>(
        `mutation Sub($topic: WebhookSubscriptionTopic!, $url: URL!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
            userErrors { message }
          }
        }`,
        { topic, url: callbackUrl },
      );
      const errs = data.webhookSubscriptionCreate.userErrors;
      // "already taken" means the subscription exists — that is the desired state.
      const ok = errs.length === 0 || errs.every((e) => /taken/i.test(e.message));
      results.push({ topic, ok, error: ok ? undefined : errs.map((e) => e.message).join('; ') });
    }
    return results;
  }
}
