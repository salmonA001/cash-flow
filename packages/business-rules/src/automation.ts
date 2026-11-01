export type AutomationLevel = 'AUTOMATIC' | 'APPROVAL_REQUIRED' | 'HUMAN_JUDGMENT';

export interface AutomationDefinition {
  key: string;
  name: string;
  trigger: string;
  action: string;
  level: AutomationLevel;
  /** Core workflow steps cannot be disabled; optional side effects can. */
  toggleable: boolean;
}

/** The built-in automations. Seeded per organization; users may enable/disable them. */
export const AUTOMATION_CATALOG: AutomationDefinition[] = [
  { key: 'design.uploaded', name: 'Create design record on upload', trigger: 'design.asset_uploaded', action: 'design.create_version', level: 'AUTOMATIC', toggleable: false },
  { key: 'design.approved', name: 'Unlock listing workflow on approval', trigger: 'design.approved', action: 'listing.allow', level: 'AUTOMATIC', toggleable: false },
  { key: 'shopify.order.classify', name: 'Classify Shopify order items', trigger: 'shopify.order_received', action: 'order.classify', level: 'AUTOMATIC', toggleable: false },
  { key: 'pod.fulfillment.create', name: 'Create POD fulfillment task', trigger: 'order.pod_eligible', action: 'fulfillment.create_task', level: 'AUTOMATIC', toggleable: true },
  { key: 'pod.fulfillment.submit', name: 'Submit fulfillment to Printful', trigger: 'fulfillment.approved', action: 'printful.create_order', level: 'APPROVAL_REQUIRED', toggleable: false },
  { key: 'digital.entitlement.grant', name: 'Grant download on confirmed payment', trigger: 'digital.payment_confirmed', action: 'entitlement.grant', level: 'AUTOMATIC', toggleable: true },
  { key: 'printful.webhook.sync', name: 'Sync Printful status updates', trigger: 'printful.webhook_received', action: 'fulfillment.update', level: 'AUTOMATIC', toggleable: false },
  { key: 'amazon.report.import', name: 'Import Amazon Merch royalty report', trigger: 'amazon.report_uploaded', action: 'royalties.import', level: 'AUTOMATIC', toggleable: false },
  { key: 'finance.expense.recorded', name: 'Refresh finance summaries on expense', trigger: 'expense.recorded', action: 'finance.refresh', level: 'AUTOMATIC', toggleable: false },
  { key: 'refund.received', name: 'Apply refund and revoke digital access', trigger: 'shopify.refund_received', action: 'refund.apply', level: 'AUTOMATIC', toggleable: true },
  { key: 'integration.missing', name: 'Alert on missing integration', trigger: 'integration.health_check', action: 'notification.alert_admin', level: 'AUTOMATIC', toggleable: true },
  { key: 'reconciliation.mismatch', name: 'Open review task on reconciliation mismatch', trigger: 'reconciliation.mismatch', action: 'review_task.create', level: 'AUTOMATIC', toggleable: true },
];

export const AUTOMATION_TRIGGERS = [...new Set(AUTOMATION_CATALOG.map((a) => a.trigger))];

/** Actions available to user-defined rules. They only notify or open review tasks — never external writes. */
export const CUSTOM_RULE_ACTIONS = ['notification.alert_admin', 'review_task.create'] as const;

/** Financial / external actions that must never be retried automatically. */
export const NON_RETRYABLE_ACTIONS = new Set(['printful.create_order', 'refund.issue', 'payout.adjust']);

export function canAutoRetry(action: string, level: AutomationLevel): boolean {
  return level === 'AUTOMATIC' && !NON_RETRYABLE_ACTIONS.has(action);
}

export function requiresApproval(level: AutomationLevel): boolean {
  return level !== 'AUTOMATIC';
}
