/**
 * Permission catalogue. Keys are `<resource>.<action>`. The API enforces them; the mobile app only
 * uses them to hide controls (never as security).
 */
export const PERMISSIONS = {
  // catalogue & stock
  'product.read': 'View products',
  'product.manage': 'Create, edit and deactivate products, prices and units',
  'category.manage': 'Manage product categories',
  'stock.read': 'View stock balances and movements',
  'stock.adjust': 'Adjust stock (damage, expiry, count corrections)',
  'stock.override_negative': 'Sell or adjust below zero stock (audited)',
  // procurement
  'purchase.read': 'View purchases',
  'purchase.create': 'Create and receive purchases',
  'purchase.cancel': 'Cancel purchases and process purchase returns',
  'supplier.read': 'View suppliers and supplier ledger',
  'supplier.manage': 'Create and edit suppliers',
  'supplier.payment': 'Record supplier payments',
  // sales
  'sale.create': 'Create sales (POS)',
  'sale.read': 'View sales and invoices',
  'sale.cancel': 'Cancel completed sales',
  'sale.return': 'Process sale returns',
  'discount.apply': 'Apply discounts within the role limit',
  'discount.override_limit': 'Apply discounts above the role limit',
  'price.override': 'Change the selling price at billing time',
  // customers & collections
  'customer.read': 'View customers',
  'customer.manage': 'Create and edit customers',
  'credit.override_limit': 'Sell on credit beyond the customer credit limit',
  'ledger.read': 'View customer ledgers',
  'collection.read': 'View collections',
  'collection.create': 'Record customer collections',
  'collection.assign': 'Manage collection agents and assignments',
  // finance
  'expense.read': 'View expenses',
  'expense.create': 'Record and cancel expenses',
  'cashbook.read': 'View the cashbook',
  'cashbook.manage': 'Record cash in/out entries',
  'closing.manage': 'Perform daily cash closing',
  // reports
  'report.sales': 'View sales reports',
  'report.purchases': 'View purchase reports',
  'report.inventory': 'View inventory reports',
  'report.financial': 'View financial reports and dashboard',
  'report.profit': 'View profit reports',
  // administration
  'organization.read': 'View shop settings',
  'organization.manage': 'Change shop, GST and invoice settings',
  'branch.read': 'View branches',
  'branch.manage': 'Create and edit branches',
  'employee.read': 'View employees',
  'employee.manage': 'Change employee roles, branches and status',
  'invitation.manage': 'Invite and revoke employee invitations',
  'role.read': 'View roles and permissions',
  'role.manage': 'Create and edit roles',
  'audit.read': 'View the audit log',
  'backup.manage': 'Manage backups and sync status',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

const without = (...excluded: PermissionKey[]): PermissionKey[] =>
  ALL_PERMISSION_KEYS.filter((k) => !excluded.includes(k));

/**
 * Default permissions for the system roles created with every organization.
 * Owner is treated as "all permissions" by the API regardless of this list.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<
  'Owner' | 'Manager' | 'Cashier' | 'Collection Agent',
  PermissionKey[]
> = {
  Owner: [...ALL_PERMISSION_KEYS],
  Manager: without(
    'organization.manage',
    'branch.manage',
    'employee.manage',
    'role.manage',
    'backup.manage',
    'audit.read',
  ),
  Cashier: [
    'product.read',
    'stock.read',
    'sale.create',
    'sale.read',
    'discount.apply',
    'customer.read',
    'customer.manage',
  ],
  'Collection Agent': ['customer.read', 'ledger.read', 'collection.read', 'collection.create'],
};

export const SYSTEM_ROLE_DESCRIPTIONS: Record<keyof typeof SYSTEM_ROLE_PERMISSIONS, string> = {
  Owner: 'Full access to everything',
  Manager: 'Operational and financial access; cannot change shop settings, roles or employees',
  Cashier: 'Billing (POS) and customer lookup',
  'Collection Agent': 'Assigned collections and payment recording',
};
