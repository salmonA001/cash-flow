export interface ShippingAddress {
  name?: string | null;
  address1?: string | null;
  city?: string | null;
  countryCode?: string | null;
  provinceCode?: string | null;
  zip?: string | null;
}

export interface EligibilityInput {
  order: {
    status: 'OPEN' | 'CANCELLED' | 'CLOSED';
    paymentStatus: string;
    shippingAddress: ShippingAddress | null;
  };
  items: {
    itemType: string;
    quantity: number;
    printfulVariantId: number | null;
    printFileUrl: string | null;
  }[];
  existingFulfillmentStatus: string | null;
}

export type EligibilityResult = { eligible: true } | { eligible: false; reasons: string[] };

/** Countries where Printful does not require a postal code. */
const NO_POSTCODE_COUNTRIES = new Set(['AE', 'AG', 'BS', 'BZ', 'HK', 'JM', 'MO', 'QA', 'PA']);
/** Countries where a state/province code is required. */
const STATE_REQUIRED_COUNTRIES = new Set(['US', 'CA', 'AU', 'JP']);
/** A previous fulfillment in these states may be replaced; any other state blocks a new submission. */
const REPLACEABLE_STATUSES = new Set(['FAILED', 'CANCELLED']);

export function validateShippingAddress(address: ShippingAddress | null): string[] {
  if (!address) return ['Shipping address is missing'];
  const errors: string[] = [];
  if (!address.name?.trim()) errors.push('Recipient name is required');
  if (!address.address1?.trim()) errors.push('Address line 1 is required');
  if (!address.city?.trim()) errors.push('City is required');
  const country = address.countryCode?.trim().toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country)) {
    errors.push('A valid 2-letter country code is required');
    return errors;
  }
  if (!NO_POSTCODE_COUNTRIES.has(country) && !address.zip?.trim()) errors.push('Postal code is required');
  if (STATE_REQUIRED_COUNTRIES.has(country) && !address.provinceCode?.trim()) {
    errors.push(`State/province is required for ${country}`);
  }
  return errors;
}

/**
 * A POD order may be sent to the fulfillment provider only when every check passes.
 * This runs before approval and again immediately before submission.
 */
export function checkFulfillmentEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: string[] = [];
  if (input.order.status !== 'OPEN') reasons.push(`Order is ${input.order.status}`);
  if (input.order.paymentStatus !== 'PAID') {
    reasons.push(`Payment status is ${input.order.paymentStatus}; only fully PAID orders are fulfilled`);
  }
  reasons.push(...validateShippingAddress(input.order.shippingAddress));

  if (input.items.some((i) => i.itemType === 'UNCLASSIFIED')) {
    reasons.push('Order has unmapped line items; map them to internal variants first');
  }
  const pod = input.items.filter((i) => i.itemType === 'POD');
  if (pod.length === 0) reasons.push('Order has no POD items');
  for (const [idx, item] of pod.entries()) {
    if (item.quantity < 1) reasons.push(`POD item #${idx + 1} has invalid quantity`);
    if (item.printfulVariantId === null) reasons.push(`POD item #${idx + 1} has no Printful variant mapping`);
    if (!item.printFileUrl) reasons.push(`POD item #${idx + 1} has no print file`);
  }
  if (input.existingFulfillmentStatus && !REPLACEABLE_STATUSES.has(input.existingFulfillmentStatus)) {
    reasons.push(`A fulfillment already exists with status ${input.existingFulfillmentStatus}`);
  }
  return reasons.length === 0 ? { eligible: true } : { eligible: false, reasons };
}
