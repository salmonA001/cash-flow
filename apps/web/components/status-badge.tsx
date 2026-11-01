import { humanize } from '@/lib/format';
import { Badge } from './ui/badge';

const TONES: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  APPROVED: 'success', ACTIVE: 'success', LIVE: 'success', PAID: 'success', SUCCEEDED: 'success', COMPLETED: 'success',
  CONNECTED: 'success', SHIPPED: 'success', DELIVERED: 'success', RECONCILED: 'success', PROCESSED: 'success', GRANTED: 'success',
  IN_REVIEW: 'warning', PENDING: 'warning', AWAITING_APPROVAL: 'warning', NEEDS_REVIEW: 'warning', PARTIALLY_REFUNDED: 'warning',
  UNCLASSIFIED: 'warning', EXPECTED: 'warning', RUNNING: 'info', SUBMITTING: 'info', SUBMITTED: 'info', IN_PRODUCTION: 'info', PROCESSING: 'info', OPEN: 'info',
  FAILED: 'danger', REJECTED: 'danger', REVOKED: 'danger', CANCELLED: 'danger', REFUNDED: 'danger', ERROR: 'danger', MISMATCH: 'danger', VOIDED: 'danger', DISCONNECTED: 'danger',
  POD: 'info', DIGITAL: 'info',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONES[status] ?? (status.startsWith('DENIED') ? 'danger' : 'neutral');
  return <Badge tone={tone}>{humanize(status)}</Badge>;
}
