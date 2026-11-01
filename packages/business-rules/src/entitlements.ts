import { createHash, randomBytes } from 'node:crypto';

export type DownloadDecision = 'GRANTED' | 'DENIED_EXPIRED' | 'DENIED_LIMIT' | 'DENIED_REVOKED';

/** 256-bit random bearer token, URL-safe. Only its hash is stored. */
export function generateDownloadToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashDownloadToken(token) };
}

export function hashDownloadToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function computeEntitlementExpiry(now: Date, accessDays: number): Date {
  if (!Number.isInteger(accessDays) || accessDays < 1) throw new Error('accessDays must be a positive integer');
  return new Date(now.getTime() + accessDays * 24 * 60 * 60 * 1000);
}

export interface EntitlementState {
  status: 'ACTIVE' | 'REVOKED';
  expiresAt: Date;
  downloadCount: number;
  maxDownloads: number;
}

/** Order of checks matters: revocation beats expiry beats limit. */
export function evaluateDownloadAccess(ent: EntitlementState, now: Date): DownloadDecision {
  if (ent.status === 'REVOKED') return 'DENIED_REVOKED';
  if (now.getTime() >= ent.expiresAt.getTime()) return 'DENIED_EXPIRED';
  if (ent.downloadCount >= ent.maxDownloads) return 'DENIED_LIMIT';
  return 'GRANTED';
}
