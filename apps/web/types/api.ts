export type { FinanceSummary, MonthlyPoint, Paginated } from '@cfe/shared-types';

export interface Design {
  id: string;
  title: string;
  description: string | null;
  status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'ARCHIVED';
  category: string | null;
  tags: string[];
  updatedAt: string;
  approvedAt: string | null;
  collections: { collection: { id: string; name: string } }[];
  _count?: { products: number; listings: number; versions: number };
}

export interface DesignAsset {
  id: string;
  kind: 'ORIGINAL' | 'PRINT_FILE' | 'MOCKUP' | 'PREVIEW';
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  createdAt: string;
}

export interface DesignDetail extends Design {
  versions: { id: string; versionNumber: number; notes: string | null; createdAt: string; assets: DesignAsset[] }[];
  products: { id: string; title: string; type: string; status: string }[];
  listings: { id: string; channel: string; marketplace: string; externalId: string; status: string }[];
}

export interface Variant {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  price: string;
  currency: string;
  productionCost: string | null;
  shopifyVariantId: string | null;
  printfulVariantId: number | null;
  printFileAssetId: string | null;
}

export interface Product {
  id: string;
  title: string;
  description: string | null;
  type: 'POD' | 'DIGITAL';
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  category: string | null;
  designId: string | null;
  design: { id: string; title: string } | null;
  variants: Variant[];
  updatedAt: string;
  _count?: { listings: number };
}

export interface Listing {
  id: string;
  channel: 'AMAZON_MERCH' | 'SHOPIFY';
  marketplace: string;
  country: string | null;
  externalId: string;
  url: string | null;
  status: string;
  design: { id: string; title: string } | null;
  product: { id: string; title: string } | null;
  royalties: { currency: string; amount: string; units: number }[];
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  currency: string;
  total: string;
  paymentStatus: string;
  status: string;
  placedAt: string;
  customer: { id: string; email: string | null; name: string | null } | null;
  items: { itemType: string; quantity: number }[];
  fulfillments: { id: string; status: string }[];
}

export interface FulfillmentRow {
  id: string;
  status: string;
  externalId: string | null;
  currency: string | null;
  productionCost: string | null;
  shippingCost: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  lastError: string | null;
  createdAt: string;
  order: { id: string; orderNumber: string; paymentStatus: string; placedAt: string };
  events: { type: string; message: string | null; createdAt: string }[];
}

export interface AutomationRun {
  id: string;
  trigger: string;
  action: string;
  level: string;
  status: string;
  subjectType: string | null;
  subjectId: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  rule: { name: string } | null;
}
