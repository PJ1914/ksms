export * from './permissions';
export const CURRENCY = 'INR' as const;
export const DEFAULT_TIMEZONE = 'Asia/Kolkata' as const;
export const API_PREFIX = 'api/v1' as const;
/** Prefix of the platform (admin panel) API, outside API_PREFIX. See ADMIN_PANEL.md and ADR-001. */
export const PLATFORM_PREFIX = 'admin/v1' as const;
export const PLATFORM_ROLES = ['ADMIN', 'SUPPORT'] as const;
export type PlatformRoleName = (typeof PLATFORM_ROLES)[number];

/**
 * A shop's subscription state, derived from dates at read time (ADMIN_PANEL.md §2.3):
 * TRIAL/ACTIVE full access; GRACE full access + banner; EXPIRED read-only; LOCKED blocked.
 */
export const SUBSCRIPTION_STATES = ['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED', 'LOCKED'] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];
/** Response header on every shop request carrying the current subscription state. */
export const SUBSCRIPTION_STATE_HEADER = 'x-subscription-state' as const;

/** Every branch is created with this cash register; all cash movements of the branch go through it. */
export const DEFAULT_CASH_REGISTER_NAME = 'Main Register' as const;

export const ROLE_NAMES = ['Owner', 'Manager', 'Cashier', 'Collection Agent'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PRODUCT_TYPES = ['WEIGHT', 'VOLUME', 'COUNT'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const RETURN_DISPOSITIONS = ['SALEABLE', 'DAMAGED', 'EXPIRED', 'QUARANTINED'] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

/** HTTP headers shared by the API and the mobile client. */
export const IDEMPOTENCY_HEADER = 'idempotency-key' as const;
export const BRANCH_HEADER = 'x-branch-id' as const;
export const CORRELATION_HEADER = 'x-correlation-id' as const;

/** What kind of shop this is. Kept on the organization so screens and defaults can be tuned per business. */
export const BUSINESS_TYPES = ['KIRANA', 'GENERAL_STORE', 'MEDICAL', 'OTHER'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const DEFAULT_BUSINESS_TYPE: BusinessType = 'KIRANA';
