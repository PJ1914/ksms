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
  isTaxable: boolean;
  hsnCode: string | null;
  gstRatePercent: string | null;
  taxMode: 'INCLUSIVE' | 'EXCLUSIVE' | null;
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
  gstin?: string | null;
  stateCode?: string | null;
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
  customer: {
    id: string;
    name: string;
    phone: string | null;
    gstin?: string | null;
    stateCode?: string | null;
  } | null;
  soldBy: { id: string; fullName: string };
  invoice: {
    id: string;
    invoiceNumber: string;
    type: 'NORMAL' | 'GST' | 'BILL_OF_SUPPLY';
    status: 'ISSUED' | 'CANCELLED';
    series: string;
    sequenceNumber: number;
    issuedAt: string;
  } | null;
  taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
  placeOfSupplyStateCode?: string | null;
  subtotal: string;
  discountTotal: string;
  taxableTotal: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  taxTotal: string;
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
    hsn?: string | null;
    unitCode: string;
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    taxRatePercent?: string;
    taxableValue?: string;
    taxAmount?: string;
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
    taxRatePercent?: string;
    taxableValue?: string;
    cgst?: string;
    sgst?: string;
    igst?: string;
    tax?: string;
    net: string;
  }[];
  subtotal: string;
  discountTotal: string;
  taxableTotal: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  taxTotal: string;
  roundOff: string;
  total: string;
  paid: string;
  credit: string;
  placeOfSupplyStateCode?: string | null;
  interState?: boolean;
  warnings: {
    stock: { productId: string; requestedBaseQuantity: string; availableBaseQuantity: string }[];
    creditLimit: { creditLimit: string; balance: string; available: string } | null;
  };
}

export interface OrganizationSettings {
  id: string;
  businessType?: string;
  name: string;
  legalName: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
  gstEnabled: boolean;
  defaultTaxMode: 'INCLUSIVE' | 'EXCLUSIVE';
  allowNegativeStock: boolean;
  maxCashierDiscountPercent: string;
}

export interface BranchDetail {
  id: string;
  code: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  stateCode: string | null;
  gstin: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface HeldBill {
  id: string;
  label: string | null;
  customerId: string | null;
  payload: unknown;
  createdAt: string;
}

export interface CollectionAgentRow {
  id: string;
  name: string;
  phone: string | null;
  userId: string | null;
  isActive: boolean;
  activeAssignments: number;
  completedCollections: number;
  totalCollected: string;
  createdAt: string;
}

export interface CollectionAgentDetail {
  id: string;
  name: string;
  phone: string | null;
  userId: string | null;
  isActive: boolean;
  createdAt: string;
  assignments: {
    id: string;
    customerId: string;
    customerName: string;
    customerPhone: string | null;
    customerBalance: string;
    targetAmount: string | null;
    startDate: string;
    status: 'ACTIVE' | 'ENDED';
  }[];
  recentRecords: {
    id: string;
    paymentId: string;
    receiptNumber: string;
    customerId: string;
    customerName: string;
    amount: string;
    method: string;
    status: 'COMPLETED' | 'REVERSED';
    referenceNo: string | null;
    collectedAt: string;
  }[];
}

export interface CollectionRow {
  id: string;
  receiptNumber: string | null;
  amount: string;
  method: string;
  status: 'COMPLETED' | 'REVERSED';
  referenceNo: string | null;
  notes: string | null;
  paidAt: string;
  reversedAt: string | null;
  customer: { id: string; name: string; phone: string | null } | null;
  recordedBy: { id: string; fullName: string };
  agent: { id: string; name: string } | null;
}

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ExpenseRow {
  id: string;
  categoryId: string;
  categoryName: string;
  amount: string;
  method: string;
  description: string | null;
  referenceNo: string | null;
  expenseDate: string;
  cancelledAt: string | null;
  createdAt: string;
}

export interface CashbookEntryRow {
  id: string;
  kind: string;
  method: string;
  amount: string;
  description: string | null;
  referenceType: string;
  referenceId: string;
  businessDate: string;
  occurredAt: string;
}

export interface DailyClosingPreview {
  businessDate: string;
  registerId: string;
  openingCash: string;
  cashIn: string;
  cashOut: string;
  netCashMovements: string;
  expectedCash: string;
  entryCount: number;
  byMethod: Record<string, string>;
  closing: {
    id: string;
    status: 'OPEN' | 'CLOSED';
    actualCash: string | null;
    difference: string | null;
    notes: string | null;
    closedAt: string | null;
  } | null;
}

export interface DailyClosingRow {
  id: string;
  businessDate: string;
  openingCash: string;
  expectedCash: string;
  actualCash: string | null;
  difference: string | null;
  status: 'OPEN' | 'CLOSED';
  notes: string | null;
  closedAt: string | null;
}

// ---------------------------------------------------------------- reports (Phase 13). All money is a decimal string.

export interface SalesFigures {
  bills: number;
  billValue: string;
  averageBill: string;
  discount: string;
  taxableValue: string;
  gst: string;
  creditGiven: string;
  returnsCount: number;
  returnsValue: string;
  netSales: string;
}

export interface SalesSummary {
  from: string;
  to: string;
  totals: SalesFigures;
  series: (SalesFigures & { date: string })[];
}

export interface PurchasesSummary {
  from: string;
  to: string;
  totals: { orders: number; billed: string; returned: string; net: string };
  series: { date: string; orders: number; billed: string; returned: string; net: string }[];
}

export interface ProfitReport {
  from: string;
  to: string;
  isEstimate: boolean;
  revenue: string;
  costOfGoodsSold: string;
  grossProfit: string;
  grossMarginPercent: string;
  expenses: { total: string; byCategory: { categoryId: string; name: string; total: string }[] };
  stockWrittenOff: string;
  netProfit: string;
  netMarginPercent: string;
}

export interface CashFlowReport {
  from: string;
  to: string;
  totals: { moneyIn: string; moneyOut: string; net: string };
  byMethod: { method: string; moneyIn: string; moneyOut: string; net: string }[];
  closings: { daysClosed: number; cashDifference: string };
}

export interface InventorySummary {
  asOf: string;
  stockValue: string;
  productsInStock: number;
  productsOutOfStock: number;
  lowStockProducts: number;
  expired: { batches: number; value: string };
  expiringSoon: { withinDays: number; batches: number; value: string };
  byCategory: { categoryId: string | null; category: string; value: string }[];
}

export interface MoverRow {
  productId: string;
  sku: string;
  name: string;
  baseUnit: string;
  soldQuantity: string;
  quantityOnHand: string;
  stockValue: string;
}

export interface DayBookRow {
  kind: string;
  at: string;
  reference: string | null;
  party: string | null;
  amount: string;
}

export interface DuesRow {
  id: string;
  name: string;
  phone: string | null;
  due?: string;
  payable?: string;
  lastPaymentAt?: string | null;
}

export interface DuesMeta {
  summary: {
    customers: { owing: number; totalDue: string; advances: string };
    suppliers: { owed: number; totalPayable: string; advances: string };
  };
}

export interface BreakdownRow {
  id?: string | null;
  name?: string;
  method?: string;
  sku?: string;
  baseUnit?: string;
  quantity?: string;
  bills?: number;
  billValue?: string;
  amount?: string;
  netSales?: string;
  grossProfit?: string;
  marginPercent?: string;
}

export interface CollectionsMeta {
  totals: { receipts: number; customers: number; collected: string };
  daily: { date: string; receipts: number; collected: string }[];
}

export interface PurchaseSupplierRow {
  supplierId: string;
  name: string;
  orders: number;
  billed: string;
  returned: string;
  net: string;
  owedNow: string;
}

export interface CollectionAgentRow {
  /** null = payments taken at the shop counter with no agent. */
  agentId: string | null;
  name: string;
  receipts: number;
  customers: number;
  collected: string;
}

export interface Dashboard {
  date: string;
  sales: {
    bills: number;
    billValue: string;
    netSales: string;
    returnsValue: string;
    creditGiven: string;
    monthToDate: { from: string; bills: number; netSales: string } | null;
  } | null;
  cashToday: { moneyIn: string; moneyOut: string; net: string };
  owed: {
    customersOwing: number;
    customerDue: string;
    suppliersOwed: number;
    supplierPayable: string;
  };
  stock: {
    stockValue: string;
    lowStockProducts: number;
    productsOutOfStock: number;
    expiringSoon: { batches: number };
    expired: { batches: number };
  } | null;
  profit: {
    today: { grossProfit: string; netProfit: string };
    monthToDate: { from: string; revenue: string; grossProfit: string; netProfit: string } | null;
    isEstimate: boolean;
  } | null;
}

// ---------------------------------------------------------------- staff and roles

export interface BranchInfo {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
}

export interface Employee {
  id: string;
  status: 'ACTIVE' | 'DEACTIVATED' | string;
  createdAt: string;
  user: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    isActive: boolean;
    lastLoginAt: string | null;
  };
  role: { id: string; name: string };
  isOwner: boolean;
  branches: { id: string; code: string; name: string; isDefault: boolean }[];
}

export interface RoleInfo {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  permissions: string[];
}

export interface PermissionInfo {
  key: string;
  module: string;
  description: string;
}

export interface InvitationRow {
  id: string;
  phone: string;
  email: string | null;
  branchIds: string[];
  expiresAt: string;
  createdAt: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  role: { id: string; name: string };
}

export interface CreatedInvitation {
  id: string;
  code: string;
  phone: string;
  expiresAt: string;
}

export interface SupplierStockNote {
  id: string;
  productId: string;
  productName: string;
  baseUnitCode: string;
  quantity: string;
  receivedAt: string;
}
