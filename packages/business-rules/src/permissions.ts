export const PERMISSIONS = {
  'designs:read': 'View designs, collections and assets',
  'designs:write': 'Create and edit designs, collections and assets',
  'designs:approve': 'Approve designs (IP / copyright judgment)',
  'products:read': 'View products, variants and listings',
  'products:write': 'Create and edit products, variants and listings',
  'orders:read': 'View orders and customers',
  'orders:write': 'Edit orders',
  'fulfillment:read': 'View fulfillment queue',
  'fulfillment:approve': 'Approve and submit live fulfillment orders',
  'digital:read': 'View digital products and entitlements',
  'digital:write': 'Manage digital products, grant and revoke downloads',
  'amazon:read': 'View Amazon Merch royalties and imports',
  'amazon:write': 'Import Amazon Merch reports',
  'finance:read': 'View financial reports',
  'finance:write': 'Record expenses and payouts',
  'analytics:read': 'View performance analytics',
  'automation:read': 'View automation rules and runs',
  'automation:write': 'Edit automation rules, approve and retry runs',
  'integrations:write': 'Connect and configure integrations',
  'settings:write': 'Edit organization settings',
  'users:write': 'Manage users and roles',
  'audit:read': 'View audit logs',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as PermissionKey[];
const READ = ALL.filter((p) => p.endsWith(':read'));

export const DEFAULT_ROLES: Record<string, { description: string; permissions: PermissionKey[] }> = {
  Owner: { description: 'Full access', permissions: ALL },
  Operator: {
    description: 'Day-to-day catalog, orders and fulfillment',
    permissions: [...READ, 'designs:write', 'products:write', 'orders:write', 'digital:write', 'amazon:write'],
  },
  Finance: { description: 'Financial reporting and expenses', permissions: [...READ, 'finance:write', 'amazon:write'] },
  Viewer: { description: 'Read-only access', permissions: READ },
};
