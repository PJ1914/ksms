import Decimal from 'decimal.js';
import { moneyString, quantityString } from './decimal';
import { normalizeIndianPhone } from './phone';

/**
 * Form rules and request builders for the phone screens (customers, suppliers, stock, purchases, payments, returns).
 * Each `validate...` returns a plain-language message for the first problem or null; each `build...` makes the exact
 * request body (amounts and quantities always decimal STRINGS). The server checks everything again.
 */

const trim = (v: string) => v.trim();
const isMoney = (v: string) => moneyString.safeParse(trim(v)).success;
const isQty = (v: string) =>
  quantityString.safeParse(trim(v)).success && new Decimal(trim(v)).gt(0);
/** Up to 4 decimals: what a supplier charges per unit. */
const isUnitCost = (v: string) => /^\d{1,10}(\.\d{1,4})?$/.test(trim(v));

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// ---------------------------------------------------------------- customers

export interface CustomerForm {
  name: string;
  phone: string;
  creditLimit: string;
}

export function validateCustomerForm(f: CustomerForm): string | null {
  if (trim(f.name).length < 2) return 'Enter the customer name (at least 2 letters).';
  if (trim(f.phone) && !normalizeIndianPhone(f.phone))
    return 'Enter a valid 10-digit mobile number, or leave it empty.';
  if (trim(f.creditLimit) && !isMoney(f.creditLimit))
    return 'Enter the credit limit in rupees, like 5000, or leave it empty.';
  return null;
}

export function buildCustomerPayload(f: CustomerForm) {
  return {
    name: trim(f.name),
    ...(trim(f.phone) ? { phone: normalizeIndianPhone(f.phone)! } : {}),
    ...(trim(f.creditLimit) ? { creditLimit: trim(f.creditLimit) } : {}),
  };
}

// ---------------------------------------------------------------- suppliers

export interface SupplierForm {
  name: string;
  phone: string;
  contactPerson: string;
  openingBalance: string;
}

export function validateSupplierForm(f: SupplierForm): string | null {
  if (trim(f.name).length < 2) return 'Enter the supplier name (at least 2 letters).';
  if (trim(f.phone) && !normalizeIndianPhone(f.phone))
    return 'Enter a valid 10-digit mobile number, or leave it empty.';
  if (trim(f.openingBalance) && !isMoney(f.openingBalance))
    return 'Enter what you already owe in rupees, like 2500, or leave it empty.';
  return null;
}

export function buildSupplierPayload(f: SupplierForm) {
  return {
    name: trim(f.name),
    ...(trim(f.phone) ? { phone: normalizeIndianPhone(f.phone)! } : {}),
    ...(trim(f.contactPerson) ? { contactPerson: trim(f.contactPerson) } : {}),
    ...(trim(f.openingBalance) && new Decimal(trim(f.openingBalance)).gt(0)
      ? { openingBalance: trim(f.openingBalance) }
      : {}),
  };
}

// ---------------------------------------------------------------- stock

export const ADD_REASONS = [
  { key: 'FOUND', label: 'Found stock' },
  { key: 'COUNT_CORRECTION', label: 'Count correction' },
  { key: 'OTHER', label: 'Other' },
] as const;
export const REMOVE_REASONS = [
  { key: 'DAMAGE', label: 'Damaged' },
  { key: 'EXPIRY', label: 'Expired' },
  { key: 'LOSS', label: 'Lost or stolen' },
  { key: 'COUNT_CORRECTION', label: 'Count correction' },
  { key: 'OTHER', label: 'Other' },
] as const;

export interface StockForm {
  mode: 'OPENING' | 'ADD' | 'REMOVE';
  productId: string;
  unitId: string;
  quantity: string;
  /** What each unit cost: needed for opening stock; optional when adding found stock. */
  unitCost: string;
  reason: string;
  notes: string;
  /** Tracked products: which batch is removed, or the batch/expiry being added. */
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  tracked: boolean;
}

export function validateStockForm(f: StockForm): string | null {
  if (!isQty(f.quantity)) return 'Enter how many (more than zero, up to 3 decimals).';
  if (f.mode === 'OPENING' && !isMoney(f.unitCost))
    return 'Enter what each unit cost you, in rupees.';
  if (f.mode === 'ADD' && trim(f.unitCost) && !isMoney(f.unitCost))
    return 'Enter the cost in rupees, like 40 or 40.50, or leave it empty.';
  if (f.mode !== 'OPENING' && !f.reason) return 'Choose a reason.';
  if (f.tracked && f.mode === 'REMOVE' && !f.batchId)
    return 'Choose which batch the stock is removed from.';
  if (f.tracked && f.mode !== 'REMOVE') {
    if (trim(f.expiryDate) && !isRealDate(trim(f.expiryDate)))
      return 'Enter the expiry date as YYYY-MM-DD, like 2026-12-31.';
    if (!trim(f.expiryDate) && !trim(f.batchNumber))
      return 'Enter the batch number or the expiry date.';
  }
  return null;
}

/** `{ path, body }` for the opening-stock or adjustment endpoint. */
export function buildStockRequest(f: StockForm): { path: string; body: Record<string, unknown> } {
  const common = {
    productId: f.productId,
    unitId: f.unitId,
    ...(f.tracked && f.mode !== 'REMOVE' && trim(f.batchNumber)
      ? { batchNumber: trim(f.batchNumber) }
      : {}),
    ...(f.tracked && f.mode !== 'REMOVE' && trim(f.expiryDate)
      ? { expiryDate: trim(f.expiryDate) }
      : {}),
  };
  if (f.mode === 'OPENING') {
    return {
      path: '/inventory/opening-stock',
      body: { ...common, quantity: trim(f.quantity), unitCost: trim(f.unitCost) },
    };
  }
  const q = trim(f.quantity);
  return {
    path: '/inventory/adjustments',
    body: {
      ...common,
      quantity: f.mode === 'REMOVE' ? `-${q}` : q,
      reason: f.reason,
      ...(trim(f.notes) ? { notes: trim(f.notes) } : {}),
      ...(f.mode === 'REMOVE' && f.batchId ? { batchId: f.batchId } : {}),
      ...(f.mode === 'ADD' && trim(f.unitCost) ? { unitCost: trim(f.unitCost) } : {}),
    },
  };
}

// ---------------------------------------------------------------- purchases

export interface PurchaseLineForm {
  key: string;
  productId: string;
  name: string;
  unitId: string;
  unitCode: string;
  quantity: string;
  /** Price of ONE purchase unit (per bag, per carton...). */
  unitCost: string;
  discount: string;
  batchNumber: string;
  expiryDate: string;
}

export interface PurchaseForm {
  supplierId: string | null;
  supplierInvoiceNo: string;
  additionalCosts: string;
  lines: PurchaseLineForm[];
  receiveNow: boolean;
}

export function validatePurchaseForm(f: PurchaseForm): string | null {
  if (!f.supplierId) return 'Choose the supplier.';
  if (f.lines.length === 0) return 'Add at least one item.';
  for (const l of f.lines) {
    if (!isQty(l.quantity)) return `Enter how many ${l.name} (more than zero, up to 3 decimals).`;
    if (!isUnitCost(l.unitCost))
      return `Enter the price of one ${l.unitCode} of ${l.name} in rupees (up to 4 decimals).`;
    if (trim(l.discount) && !isMoney(l.discount))
      return `Enter the discount for ${l.name} in rupees, like 5 or 5.50.`;
    if (trim(l.expiryDate) && !isRealDate(trim(l.expiryDate)))
      return `Enter the expiry date of ${l.name} as YYYY-MM-DD.`;
  }
  if (trim(f.additionalCosts) && !isMoney(f.additionalCosts))
    return 'Enter freight and other costs in rupees, like 150, or leave it empty.';
  return null;
}

export function buildPurchasePayload(f: PurchaseForm) {
  return {
    supplierId: f.supplierId!,
    ...(trim(f.supplierInvoiceNo) ? { supplierInvoiceNo: trim(f.supplierInvoiceNo) } : {}),
    items: f.lines.map((l) => ({
      productId: l.productId,
      unitId: l.unitId,
      quantity: trim(l.quantity),
      unitCost: trim(l.unitCost),
      ...(trim(l.discount) ? { discount: trim(l.discount) } : {}),
      ...(trim(l.batchNumber) ? { batchNumber: trim(l.batchNumber) } : {}),
      ...(trim(l.expiryDate) ? { expiryDate: trim(l.expiryDate) } : {}),
    })),
    ...(trim(f.additionalCosts) && new Decimal(trim(f.additionalCosts)).gt(0)
      ? { additionalCosts: trim(f.additionalCosts) }
      : {}),
    ...(f.receiveNow ? { receiveNow: true } : {}),
  };
}

// ---------------------------------------------------------------- supplier payments and returns

export interface PayForm {
  amount: string;
  method: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
  referenceNo: string;
}

export function validatePayForm(f: PayForm): string | null {
  if (!isMoney(f.amount) || new Decimal(trim(f.amount)).lte(0))
    return 'Enter the amount in rupees, like 500 or 500.50.';
  return null;
}

export function buildPayPayload(f: PayForm) {
  return {
    amount: trim(f.amount),
    method: f.method,
    ...(trim(f.referenceNo) ? { referenceNo: trim(f.referenceNo) } : {}),
  };
}

export interface ReturnLineForm {
  /** purchaseItemId or saleItemId. */
  itemId: string;
  quantity: string;
  disposition?: 'SALEABLE' | 'DAMAGED' | 'EXPIRED' | 'QUARANTINED';
  batchId?: string;
}

/** Lines with a quantity typed; the rest of the list is ignored. */
export const returnLinesChosen = (lines: ReturnLineForm[]): ReturnLineForm[] =>
  lines.filter((l) => trim(l.quantity) !== '' && isQty(l.quantity));

export function validateReturn(lines: ReturnLineForm[], reason: string): string | null {
  const typed = lines.filter((l) => trim(l.quantity) !== '');
  if (typed.length === 0) return 'Enter how many to return for at least one item.';
  if (typed.some((l) => !isQty(l.quantity)))
    return 'Enter return quantities as numbers (up to 3 decimals).';
  if (trim(reason).length < 3) return 'Say why (at least 3 letters).';
  return null;
}

export function buildSaleReturnPayload(
  saleId: string,
  lines: ReturnLineForm[],
  reason: string,
  refundTo: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER' | 'CUSTOMER_ACCOUNT',
) {
  return {
    saleId,
    reason: trim(reason),
    refundTo,
    items: returnLinesChosen(lines).map((l) => ({
      saleItemId: l.itemId,
      quantity: trim(l.quantity),
      disposition: l.disposition ?? 'SALEABLE',
    })),
  };
}

export function buildPurchaseReturnPayload(
  purchaseId: string,
  lines: ReturnLineForm[],
  reason: string,
) {
  return {
    purchaseId,
    reason: trim(reason),
    items: returnLinesChosen(lines).map((l) => ({
      purchaseItemId: l.itemId,
      quantity: trim(l.quantity),
      ...(l.batchId ? { batchId: l.batchId } : {}),
    })),
  };
}
