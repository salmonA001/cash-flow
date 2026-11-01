export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export const QUEUES = {
  integrationEvents: 'integration-events',
  orders: 'orders',
  fulfillment: 'fulfillment',
  amazonImports: 'amazon-imports',
  digital: 'digital',
  maintenance: 'maintenance',
} as const;

export interface IntegrationEventJob {
  integrationEventId: string;
}

export interface FulfillmentSubmitJob {
  fulfillmentOrderId: string;
  automationRunId: string;
}

export interface AmazonImportJob {
  importId: string;
}

export type MaintenanceJobName =
  | 'shopify.reconcile'
  | 'printful.reconcile'
  | 'integrations.health'
  | 'storage.cleanup-temp'
  | 'payouts.reconcile';

export type ChannelKey = 'SHOPIFY_POD' | 'AMAZON_MERCH' | 'DIGITAL';

export interface FinanceSummary {
  baseCurrency: string;
  from: string;
  to: string;
  shopifySales: string;
  digitalSales: string;
  amazonRoyalties: string;
  refunds: string;
  totalExpenses: string;
  estimatedNetProfit: string;
  outstandingPayouts: string;
  channels: {
    channel: ChannelKey;
    grossSales: string;
    refunds: string;
    royalties: string;
    productionCosts: string;
    shippingCosts: string;
    paymentFees: string;
    platformFees: string;
    advertising: string;
    allocatedOperating: string;
    netRevenue: string;
    netContribution: string;
  }[];
  unallocatedSharedCosts: string;
}

export interface MonthlyPoint {
  month: string;
  shopifySales: string;
  digitalSales: string;
  amazonRoyalties: string;
  expenses: string;
}

export interface EntitlementGrantJob {
  orderItemId: string;
  automationRunId: string;
}

/** Post-classification order workflow: fulfillment tasks, entitlements, refund handling. */
export interface OrderWorkflowJob {
  orderId: string;
}
