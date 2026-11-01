export type ItemClassification = 'POD' | 'DIGITAL' | 'UNCLASSIFIED';

export interface VariantForClassification {
  productType: 'POD' | 'DIGITAL';
}

/**
 * Classifies a Shopify line item by its mapped internal variant.
 * Unmapped line items stay UNCLASSIFIED and must be reviewed — never guessed.
 */
export function classifyOrderItem(variant: VariantForClassification | null): ItemClassification {
  if (!variant) return 'UNCLASSIFIED';
  return variant.productType;
}

export interface ClassifiedOrderSummary {
  hasPod: boolean;
  hasDigital: boolean;
  unclassifiedCount: number;
}

export function summarizeClassification(items: ItemClassification[]): ClassifiedOrderSummary {
  return {
    hasPod: items.includes('POD'),
    hasDigital: items.includes('DIGITAL'),
    unclassifiedCount: items.filter((i) => i === 'UNCLASSIFIED').length,
  };
}
