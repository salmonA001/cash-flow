import { describe, expect, it } from 'vitest';
import { checkFulfillmentEligibility, EligibilityInput, validateShippingAddress } from './fulfillment-eligibility';
import { classifyOrderItem, summarizeClassification } from './order-classification';
import { computeEntitlementExpiry, evaluateDownloadAccess, generateDownloadToken, hashDownloadToken } from './entitlements';
import { canAutoRetry } from './automation';

const address = { name: 'Ada', address1: '1 Main St', city: 'Austin', countryCode: 'US', provinceCode: 'TX', zip: '78701' };
const eligibleInput = (): EligibilityInput => ({
  order: { status: 'OPEN', paymentStatus: 'PAID', shippingAddress: address },
  items: [{ itemType: 'POD', quantity: 1, printfulVariantId: 4012, printFileUrl: 'https://files/x.png' }],
  existingFulfillmentStatus: null,
});

describe('order classification', () => {
  it('classifies by mapped product type and never guesses unmapped items', () => {
    expect(classifyOrderItem({ productType: 'POD' })).toBe('POD');
    expect(classifyOrderItem({ productType: 'DIGITAL' })).toBe('DIGITAL');
    expect(classifyOrderItem(null)).toBe('UNCLASSIFIED');
    expect(summarizeClassification(['POD', 'DIGITAL', 'UNCLASSIFIED'])).toEqual({ hasPod: true, hasDigital: true, unclassifiedCount: 1 });
  });
});

describe('fulfillment eligibility', () => {
  it('accepts a paid, mapped, addressed order', () => {
    expect(checkFulfillmentEligibility(eligibleInput())).toEqual({ eligible: true });
  });

  it('rejects unpaid orders', () => {
    const input = eligibleInput();
    input.order.paymentStatus = 'PENDING';
    expect(checkFulfillmentEligibility(input).eligible).toBe(false);
  });

  it('rejects missing variant mapping and print files', () => {
    const input = eligibleInput();
    input.items[0].printfulVariantId = null;
    input.items[0].printFileUrl = null;
    const r = checkFulfillmentEligibility(input);
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reasons).toHaveLength(2);
  });

  it('blocks a duplicate when an active fulfillment exists, allows replacing a failed one', () => {
    const input = eligibleInput();
    input.existingFulfillmentStatus = 'SUBMITTED';
    expect(checkFulfillmentEligibility(input).eligible).toBe(false);
    input.existingFulfillmentStatus = 'NEEDS_REVIEW';
    expect(checkFulfillmentEligibility(input).eligible).toBe(false);
    input.existingFulfillmentStatus = 'FAILED';
    expect(checkFulfillmentEligibility(input).eligible).toBe(true);
  });

  it('validates international addresses', () => {
    expect(validateShippingAddress({ ...address, countryCode: 'HK', zip: null, provinceCode: null })).toEqual([]);
    expect(validateShippingAddress({ ...address, countryCode: 'DE', zip: '', provinceCode: null })).toContain('Postal code is required');
    expect(validateShippingAddress({ ...address, provinceCode: null })).toContain('State/province is required for US');
    expect(validateShippingAddress(null)).toEqual(['Shipping address is missing']);
  });
});

describe('download entitlements', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const base = { status: 'ACTIVE' as const, expiresAt: computeEntitlementExpiry(now, 30), downloadCount: 0, maxDownloads: 3 };

  it('hashes tokens deterministically and never returns the hash as the token', () => {
    const { token, tokenHash } = generateDownloadToken();
    expect(token).not.toBe(tokenHash);
    expect(hashDownloadToken(token)).toBe(tokenHash);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('enforces revocation, expiry and limits in that order', () => {
    expect(evaluateDownloadAccess(base, now)).toBe('GRANTED');
    expect(evaluateDownloadAccess({ ...base, downloadCount: 3 }, now)).toBe('DENIED_LIMIT');
    expect(evaluateDownloadAccess({ ...base, downloadCount: 3 }, new Date('2026-08-01'))).toBe('DENIED_EXPIRED');
    expect(evaluateDownloadAccess({ ...base, status: 'REVOKED' }, new Date('2026-08-01'))).toBe('DENIED_REVOKED');
  });

  it('rejects invalid access windows', () => {
    expect(() => computeEntitlementExpiry(now, 0)).toThrow();
  });
});

describe('automation retry policy', () => {
  it('never auto-retries live fulfillment or approval-level actions', () => {
    expect(canAutoRetry('printful.create_order', 'AUTOMATIC')).toBe(false);
    expect(canAutoRetry('royalties.import', 'AUTOMATIC')).toBe(true);
    expect(canAutoRetry('royalties.import', 'APPROVAL_REQUIRED')).toBe(false);
  });
});
