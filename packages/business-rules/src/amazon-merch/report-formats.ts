/**
 * Amazon Merch on Demand report formats.
 *
 * Merch report exports are not a public, versioned API: column names can change.
 * Each supported export is declared here as a header → field mapping, so a new
 * export layout is added as a new format without touching the royalty domain model.
 * Verify headers against a real export from your Merch dashboard before importing.
 */
export interface MerchReportFormat {
  id: string;
  description: string;
  columns: {
    date: string;
    asin: string;
    marketplace: string;
    royalty: string;
    unitsSold: string;
    unitsReturned?: string;
    title?: string;
    productType?: string;
    /** When absent, currency is derived from the marketplace. */
    currency?: string;
  };
}

export const MERCH_REPORT_FORMATS: MerchReportFormat[] = [
  {
    id: 'merch-royalties-v1',
    description: 'Merch on Demand royalties export (daily rows per ASIN and marketplace, with currency column)',
    columns: {
      date: 'Date',
      asin: 'ASIN',
      marketplace: 'Marketplace',
      title: 'Title',
      productType: 'Product Type',
      unitsSold: 'Purchased',
      unitsReturned: 'Returned',
      royalty: 'Royalties',
      currency: 'Currency',
    },
  },
  {
    id: 'merch-sales-v1',
    description: 'Merch on Demand sales export without currency column (currency derived from marketplace)',
    columns: {
      date: 'Sale Date',
      asin: 'ASIN',
      marketplace: 'Marketplace',
      title: 'Title',
      productType: 'Product',
      unitsSold: 'Units',
      unitsReturned: 'Returns',
      royalty: 'Royalty',
    },
  },
];

export const MARKETPLACE_CURRENCY: Record<string, string> = {
  'amazon.com': 'USD',
  'amazon.co.uk': 'GBP',
  'amazon.de': 'EUR',
  'amazon.fr': 'EUR',
  'amazon.it': 'EUR',
  'amazon.es': 'EUR',
  'amazon.co.jp': 'JPY',
};
