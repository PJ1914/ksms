export * from './permissions';
export const CURRENCY = 'INR' as const;
export const DEFAULT_TIMEZONE = 'Asia/Kolkata' as const;
export const API_PREFIX = 'api/v1' as const;

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
