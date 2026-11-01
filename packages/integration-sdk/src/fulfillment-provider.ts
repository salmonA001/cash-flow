/** Provider-neutral fulfillment contract. Printful is the first implementation. */

export interface ProductCatalogItem {
  id: number;
  title: string;
  type: string;
  variantCount: number;
}

export interface FulfillmentRecipient {
  name: string;
  address1: string;
  address2?: string | null;
  city: string;
  stateCode?: string | null;
  countryCode: string;
  zip?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface FulfillmentRequest {
  /** Deterministic idempotency key; sent to the provider as its external order ID. */
  externalId: string;
  recipient: FulfillmentRecipient;
  items: { providerVariantId: number; quantity: number; printFileUrl: string; retailPrice?: string }[];
}

export type ProviderOrderStatus =
  | 'draft'
  | 'pending'
  | 'in_production'
  | 'shipped'
  | 'partially_shipped'
  | 'cancelled'
  | 'failed'
  | 'on_hold';

export interface ProviderOrder {
  id: string;
  externalId: string;
  status: ProviderOrderStatus;
  rawStatus: string;
  costs: { currency: string; production: string; shipping: string; tax: string; total: string } | null;
  shipments: TrackingInfo[];
}

export interface TrackingInfo {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string | null;
  shippedAt: string | null;
}

export interface FulfillmentProvider {
  getCatalog(): Promise<ProductCatalogItem[]>;
  getOrder(id: string): Promise<ProviderOrder>;
  /** Returns null when no order exists for this external ID (used after timeouts). */
  findOrderByExternalId(externalId: string): Promise<ProviderOrder | null>;
  createOrder(input: FulfillmentRequest): Promise<ProviderOrder>;
  confirmOrder(id: string): Promise<ProviderOrder>;
  cancelOrder(id: string): Promise<ProviderOrder>;
  getTracking(id: string): Promise<TrackingInfo[]>;
}

/** The request may or may not have reached the provider — never assume it failed. */
export class ProviderTimeoutError extends Error {
  constructor(operation: string) {
    super(`Provider request timed out during ${operation}; outcome unknown`);
  }
}

export class ProviderRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}
