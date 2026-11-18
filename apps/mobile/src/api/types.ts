/** What the screens read from the API (only the fields they use). Amounts and quantities are decimal STRINGS. */

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  localName: string | null;
  status: string;
  baseUnit: { id: string; code: string };
  category: { id: string; name: string } | null;
  primaryBarcode: string | null;
  basePrice: string | null;
  trackBatch: boolean;
  trackExpiry: boolean;
}

export interface ProductDetail extends ProductRow {
  type: 'WEIGHT' | 'VOLUME' | 'COUNT';
  mrp: string | null;
  minStockLevel: string;
  version: number;
  conversions: {
    unitId: string;
    unitCode: string;
    unitName: string;
    isBase: boolean;
    factorToBase: string;
    isPurchaseUnit: boolean;
    isSaleUnit: boolean;
  }[];
  prices: {
    id: string;
    unitId: string;
    unitCode: string | null;
    quantity: string;
    price: string;
    isActive: boolean;
  }[];
  barcodes: { id: string; barcode: string }[];
}

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  baseUnitCode: string;
  quantityOnHand: string;
  availableQuantity: string;
  minStockLevel: string;
  isLowStock: boolean;
  trackBatch: boolean;
  trackExpiry: boolean;
  averageCost?: string;
  stockValue?: string;
}

export interface Batch {
  id: string;
  batchNumber: string;
  expiryDate: string | null;
  quantity: string;
  expiryStatus: 'NO_EXPIRY' | 'OK' | 'EXPIRING_SOON' | 'EXPIRED';
}

export interface StockDetail extends StockRow {
  batches: Batch[];
  recentMovements: {
    id: string;
    type: string;
    quantity: string;
    balanceAfter: string;
    occurredAt: string;
    reason: string | null;
  }[];
}

export interface ExpiringRow {
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  isExpired: boolean;
  quantity: string;
  product: { id: string; name: string; sku: string; baseUnitCode: string };
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: string | null;
  balance: string;
  isActive: boolean;
  version: number;
}

export interface LedgerEntry {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  description: string | null;
  occurredAt: string;
}

export interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  contactPerson: string | null;
  balance: string;
  isActive: boolean;
}

export interface SupplierDetail extends SupplierRow {
  purchaseCount: number;
  unpaidPurchaseCount: number;
  unpaidPurchasesTotal: string;
}

export interface PurchaseRow {
  id: string;
  purchaseNumber: string;
  supplierInvoiceNo: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  purchaseDate: string;
  supplier: { id: string; name: string };
  total: string;
  outstanding: string;
}

export interface PurchaseDetail extends PurchaseRow {
  subtotal: string;
  discountTotal: string;
  additionalCosts: string;
  taxTotal: string;
  roundOff: string;
  billedTotal: string;
  returnedTotal: string;
  paidTotal: string;
  items: {
    id: string;
    productId: string;
    productName: string;
    unitId: string;
    unitCode: string | null;
    quantity: string;
    baseQuantity: string;
    receivedBaseQuantity: string;
    remainingBaseQuantity: string;
    returnedBaseQuantity: string;
    unitCost: string;
    lineTotal: string;
    batchNumber: string | null;
    expiryDate: string | null;
  }[];
}

export interface SaleRow {
  id: string;
  saleNumber: string;
  status: 'COMPLETED' | 'CANCELLED';
  soldAt: string;
  customer: { id: string; name: string } | null;
  lines: number;
  total: string;
  paidTotal: string;
  creditAmount: string;
  returnedTotal: string;
}

export interface SaleDetail {
  id: string;
  saleNumber: string;
  status: 'COMPLETED' | 'CANCELLED';
  soldAt: string;
  customer: { id: string; name: string; phone: string | null } | null;
  soldBy: { id: string; fullName: string };
  subtotal: string;
  discountTotal: string;
  roundOff: string;
  total: string;
  paidTotal: string;
  creditAmount: string;
  returnedTotal: string;
  refundedTotal: string;
  cancelReason: string | null;
  items: {
    id: string;
    name: string;
    unitCode: string;
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    lineTotal: string;
    baseQuantity: string;
    returnedBaseQuantity: string;
  }[];
  payments: { paymentId: string; method: string; amount: string; status: string }[];
}

export interface SalePreview {
  lines: {
    productId: string;
    name: string;
    unitCode: string;
    quantity: string;
    unitPrice: string;
    gross: string;
    discount: string;
    net: string;
  }[];
  subtotal: string;
  discountTotal: string;
  roundOff: string;
  total: string;
  paid: string;
  credit: string;
  warnings: {
    stock: { productId: string; requestedBaseQuantity: string; availableBaseQuantity: string }[];
    creditLimit: { creditLimit: string; balance: string; available: string } | null;
  };
}

export interface HeldBill {
  id: string;
  label: string | null;
  customerId: string | null;
  payload: unknown;
  createdAt: string;
}
