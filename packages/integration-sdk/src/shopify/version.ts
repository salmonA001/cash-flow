/**
 * Pinned Shopify Admin API version. Shopify supports each quarterly version for 12 months.
 * Upgrade procedure: see docs/INTEGRATIONS.md → "Upgrading the Shopify API version".
 */
export const SHOPIFY_API_VERSION = '2026-07';

export const SHOPIFY_WEBHOOK_TOPICS = [
  'ORDERS_CREATE',
  'ORDERS_UPDATED',
  'ORDERS_CANCELLED',
  'REFUNDS_CREATE',
  'PRODUCTS_UPDATE',
  'APP_UNINSTALLED',
] as const;

export const SHOPIFY_SCOPES = 'read_orders,read_products,read_customers,read_fulfillments';
