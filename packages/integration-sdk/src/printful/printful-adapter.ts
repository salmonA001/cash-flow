import {
  FulfillmentProvider,
  FulfillmentRequest,
  ProductCatalogItem,
  ProviderOrder,
  ProviderOrderStatus,
  ProviderRequestError,
  ProviderTimeoutError,
  TrackingInfo,
} from '../fulfillment-provider';

export interface PrintfulConfig {
  apiToken: string;
  /** Required for account-level tokens; omit for store-level private tokens. */
  storeId?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface PrintfulEnvelope<T> {
  code: number;
  result: T;
  error?: { message: string };
}

interface PrintfulOrder {
  id: number;
  external_id: string | null;
  status: string;
  costs?: { currency: string; subtotal: string; shipping: string; tax: string; total: string };
  shipments?: { carrier: string; tracking_number: string; tracking_url: string; ship_date?: string }[];
}

const STATUS_MAP: Record<string, ProviderOrderStatus> = {
  draft: 'draft',
  pending: 'pending',
  inprocess: 'in_production',
  partial: 'partially_shipped',
  fulfilled: 'shipped',
  canceled: 'cancelled',
  failed: 'failed',
  onhold: 'on_hold',
};

export class PrintfulAdapter implements FulfillmentProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: PrintfulConfig) {
    if (!config.apiToken) throw new Error('Printful API token is required');
    this.baseUrl = config.baseUrl ?? 'https://api.printful.com';
    this.timeoutMs = config.timeoutMs ?? 20_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiToken}`,
      'Content-Type': 'application/json',
    };
    if (this.config.storeId) headers['X-PF-Store-Id'] = this.config.storeId;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new ProviderTimeoutError(`${method} ${path}`);
      }
      throw err;
    }
    const json = (await res.json()) as PrintfulEnvelope<T>;
    if (!res.ok) throw new ProviderRequestError(res.status, json.error?.message ?? `Printful ${res.status}`);
    return json.result;
  }

  private toProviderOrder(o: PrintfulOrder): ProviderOrder {
    const status = STATUS_MAP[o.status];
    if (!status) throw new Error(`Unknown Printful order status "${o.status}"`);
    return {
      id: String(o.id),
      externalId: o.external_id ?? '',
      status,
      rawStatus: o.status,
      costs: o.costs
        ? { currency: o.costs.currency, production: o.costs.subtotal, shipping: o.costs.shipping, tax: o.costs.tax, total: o.costs.total }
        : null,
      shipments: (o.shipments ?? []).map((s) => ({
        carrier: s.carrier,
        trackingNumber: s.tracking_number,
        trackingUrl: s.tracking_url || null,
        shippedAt: s.ship_date ?? null,
      })),
    };
  }

  async getCatalog(): Promise<ProductCatalogItem[]> {
    const products = await this.request<{ id: number; title: string; type: string; variant_count: number }[]>('GET', '/products');
    return products.map((p) => ({ id: p.id, title: p.title, type: p.type, variantCount: p.variant_count }));
  }

  async getOrder(id: string): Promise<ProviderOrder> {
    return this.toProviderOrder(await this.request<PrintfulOrder>('GET', `/orders/${encodeURIComponent(id)}`));
  }

  async findOrderByExternalId(externalId: string): Promise<ProviderOrder | null> {
    try {
      return await this.getOrder(`@${externalId}`);
    } catch (err) {
      if (err instanceof ProviderRequestError && err.status === 404) return null;
      throw err;
    }
  }

  /** Creates a DRAFT order (confirm=false). Charging happens only on confirmOrder. */
  async createOrder(input: FulfillmentRequest): Promise<ProviderOrder> {
    const body = {
      external_id: input.externalId,
      recipient: {
        name: input.recipient.name,
        address1: input.recipient.address1,
        address2: input.recipient.address2 ?? undefined,
        city: input.recipient.city,
        state_code: input.recipient.stateCode ?? undefined,
        country_code: input.recipient.countryCode,
        zip: input.recipient.zip ?? undefined,
        email: input.recipient.email ?? undefined,
        phone: input.recipient.phone ?? undefined,
      },
      items: input.items.map((i) => ({
        variant_id: i.providerVariantId,
        quantity: i.quantity,
        retail_price: i.retailPrice,
        files: [{ url: i.printFileUrl }],
      })),
    };
    return this.toProviderOrder(await this.request<PrintfulOrder>('POST', '/orders?confirm=false', body));
  }

  async confirmOrder(id: string): Promise<ProviderOrder> {
    return this.toProviderOrder(await this.request<PrintfulOrder>('POST', `/orders/${encodeURIComponent(id)}/confirm`));
  }

  async cancelOrder(id: string): Promise<ProviderOrder> {
    return this.toProviderOrder(await this.request<PrintfulOrder>('DELETE', `/orders/${encodeURIComponent(id)}`));
  }

  async getTracking(id: string): Promise<TrackingInfo[]> {
    return (await this.getOrder(id)).shipments;
  }
}
