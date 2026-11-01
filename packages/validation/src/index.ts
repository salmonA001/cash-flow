import { z } from 'zod';

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a positive amount with up to 2 decimals');
const currency = z.string().regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 code, e.g. USD');
const id = z.string().min(1).max(64);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ── Common ──
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export const dateRangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

// ── Auth ──
export const loginSchema = z.object({ email: z.email().toLowerCase(), password: z.string().min(1).max(200) });

// ── Designs ──
export const designStatus = z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'ARCHIVED']);
export const designCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  collectionIds: z.array(id).max(50).default([]),
});
export const designUpdateSchema = designCreateSchema.partial().extend({ status: designStatus.optional() });
export const designListQuery = paginationQuery.extend({ status: designStatus.optional(), collectionId: id.optional() });
export const assetUploadSchema = z.object({
  kind: z.enum(['ORIGINAL', 'PRINT_FILE', 'MOCKUP', 'PREVIEW']),
  newVersion: z.coerce.boolean().default(false),
  notes: z.string().max(1000).optional(),
});

export const collectionCreateSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).optional() });

// ── Products ──
export const variantSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  size: z.string().max(20).optional(),
  color: z.string().max(40).optional(),
  price: money,
  currency,
  productionCost: money.optional(),
  shopifyVariantId: z.string().max(100).optional(),
  printfulVariantId: z.number().int().positive().optional(),
  printFileAssetId: id.optional(),
});
/** POD products. Digital products are created through /digital-products. */
export const productCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  designId: id.optional(),
  shopifyProductId: z.string().max(100).optional(),
  variants: z.array(variantSchema).min(1).max(250),
});
export const productUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  category: z.string().max(100).optional(),
  designId: id.nullable().optional(),
  shopifyProductId: z.string().max(100).nullable().optional(),
});
export const variantUpdateSchema = variantSchema.partial().omit({ sku: true });
export const productListQuery = paginationQuery.extend({ type: z.enum(['POD', 'DIGITAL']).optional(), status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional() });

// ── Listings ──
export const listingCreateSchema = z.object({
  productId: id.optional(),
  designId: id.optional(),
  channel: z.enum(['AMAZON_MERCH', 'SHOPIFY']),
  marketplace: z.string().trim().toLowerCase().min(3).max(40),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  externalId: z.string().trim().min(1).max(100),
  url: z.url().optional(),
  status: z.enum(['DRAFT', 'PENDING', 'LIVE', 'REJECTED', 'REMOVED']).default('DRAFT'),
});
export const listingUpdateSchema = listingCreateSchema.partial().omit({ channel: true });
export const listingListQuery = paginationQuery.extend({ channel: z.enum(['AMAZON_MERCH', 'SHOPIFY']).optional(), status: z.string().optional() });

// ── Orders ──
export const orderListQuery = paginationQuery.extend({
  paymentStatus: z.enum(['PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'FAILED']).optional(),
  itemType: z.enum(['POD', 'DIGITAL', 'UNCLASSIFIED']).optional(),
});
/** PATCH /orders/:id — map unclassified line items to internal variants, then reclassify. */
export const orderUpdateSchema = z.object({
  itemMappings: z.array(z.object({ orderItemId: id, variantId: id })).min(1).max(100),
});

// ── Fulfillment ──
export const fulfillmentListQuery = paginationQuery.extend({ status: z.string().optional() });
export const fulfillmentSubmitSchema = z.object({ confirm: z.literal(true) });

// ── Digital ──
export const digitalProductCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  sku: z.string().trim().min(1).max(64),
  price: money,
  currency,
  shopifyVariantId: z.string().max(100).optional(),
  maxDownloads: z.number().int().min(1).max(100).default(5),
  accessDays: z.number().int().min(1).max(3650).default(30),
});
export const grantDownloadSchema = z.object({ orderItemId: id });
export const revokeDownloadSchema = z.object({ reason: z.string().trim().min(3).max(500) });

// ── Finance ──
export const expenseCategory = z.enum(['ADVERTISING', 'SOFTWARE', 'SAMPLES', 'CONTRACTOR', 'PLATFORM_FEES', 'OPERATING', 'OTHER']);
export const channelEnum = z.enum(['SHOPIFY_POD', 'AMAZON_MERCH', 'DIGITAL']);
export const expenseCreateSchema = z
  .object({
    category: expenseCategory,
    description: z.string().trim().min(1).max(500),
    vendor: z.string().max(200).optional(),
    amount: money,
    currency,
    incurredOn: isoDate,
    channel: channelEnum.optional(),
  })
  .refine((e) => e.category !== 'PLATFORM_FEES' || e.channel === 'SHOPIFY_POD', {
    message: 'Platform fees must be assigned to the SHOPIFY_POD channel',
    path: ['channel'],
  });
export const payoutCreateSchema = z.object({
  source: z.enum(['AMAZON_MERCH', 'SHOPIFY_PAYMENTS', 'OTHER']),
  externalId: z.string().trim().min(1).max(100),
  amount: money,
  currency,
  periodStart: isoDate,
  periodEnd: isoDate,
  paidAt: isoDate.optional(),
  notes: z.string().max(1000).optional(),
});
export const exchangeRateCreateSchema = z.object({ base: currency, quote: currency, rate: z.string().regex(/^\d+(\.\d{1,8})?$/), rateDate: isoDate });

// ── Automation ──
export const automationRuleCreateSchema = z.object({
  key: z.string().regex(/^[a-z0-9.\-_]+$/).max(80),
  name: z.string().trim().min(1).max(120),
  trigger: z.string().min(1).max(80),
  action: z.string().min(1).max(80),
  level: z.enum(['AUTOMATIC', 'APPROVAL_REQUIRED', 'HUMAN_JUDGMENT']),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
});
export const automationRuleUpdateSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), enabled: z.boolean().optional(), config: z.record(z.string(), z.unknown()).optional() });

// ── Integrations & settings ──
export const shopifyConnectSchema = z.object({ shop: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, 'Use your-store.myshopify.com') });
export const printfulConnectSchema = z.object({ apiToken: z.string().min(10).max(500), storeId: z.string().regex(/^\d+$/) });
export const organizationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  baseCurrency: currency.optional(),
  demoMode: z.boolean().optional(),
  fulfillmentRequiresApproval: z.boolean().optional(),
});
export const userCreateSchema = z.object({
  email: z.email().toLowerCase(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12, 'Use at least 12 characters').max(200),
  roleId: id,
});
export const userUpdateSchema = z.object({ roleId: id.optional(), isActive: z.boolean().optional() });

export { z };
