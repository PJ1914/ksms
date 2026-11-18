import {
  type PurchaseForm,
  type StockForm,
  buildCustomerPayload,
  buildPayPayload,
  buildPurchasePayload,
  buildPurchaseReturnPayload,
  buildSaleReturnPayload,
  buildStockRequest,
  buildSupplierPayload,
  isRealDate,
  validateCustomerForm,
  validatePayForm,
  validatePurchaseForm,
  validateReturn,
  validateStockForm,
  validateSupplierForm,
} from './forms';

describe('customers and suppliers', () => {
  it('accepts a normal customer and sends the mobile number as 10 digits', () => {
    const f = { name: ' Lakshmi ', phone: '+91 98765 43210', creditLimit: '2000' };
    expect(validateCustomerForm(f)).toBeNull();
    expect(buildCustomerPayload(f)).toEqual({
      name: 'Lakshmi',
      phone: '9876543210',
      creditLimit: '2000',
    });
    expect(buildCustomerPayload({ name: 'Walk Regular', phone: '', creditLimit: '' })).toEqual({
      name: 'Walk Regular',
    });
  });

  it.each([
    [{ name: 'A', phone: '', creditLimit: '' }, /name/i],
    [{ name: 'Lakshmi', phone: '12345', creditLimit: '' }, /mobile/i],
    [{ name: 'Lakshmi', phone: '', creditLimit: '5k' }, /credit limit/i],
    [{ name: 'Lakshmi', phone: '', creditLimit: '10.555' }, /credit limit/i],
    [{ name: 'Lakshmi', phone: '', creditLimit: '', gstin: 'BAD' }, /GSTIN/i],
    [{ name: 'Lakshmi', phone: '', creditLimit: '', stateCode: '3' }, /state code/i],
  ])('refuses a bad customer form %j', (f, message) => {
    expect(validateCustomerForm(f)).toMatch(message);
  });

  it('derives customer stateCode from GSTIN when stateCode is omitted', () => {
    const f = {
      name: 'Lakshmi Traders',
      phone: '',
      creditLimit: '',
      gstin: '36aabcu9603r1zm',
    };
    expect(validateCustomerForm(f)).toBeNull();
    expect(buildCustomerPayload(f)).toEqual({
      name: 'Lakshmi Traders',
      gstin: '36AABCU9603R1ZM',
      stateCode: '36',
    });
  });

  it('suppliers: name, number and what is already owed', () => {
    const f = {
      name: 'Sri Ganesh Traders',
      phone: '98765 43210',
      contactPerson: ' Ganesh ',
      openingBalance: '2500.50',
    };
    expect(validateSupplierForm(f)).toBeNull();
    expect(buildSupplierPayload(f)).toEqual({
      name: 'Sri Ganesh Traders',
      phone: '9876543210',
      contactPerson: 'Ganesh',
      openingBalance: '2500.50',
    });
    expect(buildSupplierPayload({ ...f, openingBalance: '0' })).not.toHaveProperty(
      'openingBalance',
    );
    expect(validateSupplierForm({ ...f, name: 'x' })).toMatch(/name/i);
    expect(validateSupplierForm({ ...f, openingBalance: 'abc' })).toMatch(/owe/i);
  });
});

describe('stock forms', () => {
  const base: StockForm = {
    mode: 'REMOVE',
    productId: 'p1',
    unitId: 'kg',
    quantity: '2',
    unitCost: '',
    reason: 'DAMAGE',
    notes: '',
    batchId: '',
    batchNumber: '',
    expiryDate: '',
    tracked: false,
  };

  it('removing stock sends a NEGATIVE quantity string and the reason', () => {
    expect(validateStockForm(base)).toBeNull();
    expect(buildStockRequest(base)).toEqual({
      path: '/inventory/adjustments',
      body: { productId: 'p1', unitId: 'kg', quantity: '-2', reason: 'DAMAGE' },
    });
  });

  it('adding found stock may carry a cost; opening stock needs one', () => {
    const add = {
      ...base,
      mode: 'ADD' as const,
      reason: 'FOUND',
      quantity: '5',
      unitCost: '40.50',
    };
    expect(buildStockRequest(add).body).toMatchObject({
      quantity: '5',
      reason: 'FOUND',
      unitCost: '40.50',
    });
    const opening = {
      ...base,
      mode: 'OPENING' as const,
      reason: '',
      quantity: '100',
      unitCost: '50',
    };
    expect(validateStockForm(opening)).toBeNull();
    expect(buildStockRequest(opening)).toEqual({
      path: '/inventory/opening-stock',
      body: { productId: 'p1', unitId: 'kg', quantity: '100', unitCost: '50' },
    });
    expect(validateStockForm({ ...opening, unitCost: '' })).toMatch(/cost/i);
  });

  it('refuses a bad quantity or a missing reason', () => {
    expect(validateStockForm({ ...base, quantity: '0' })).toMatch(/how many/i);
    expect(validateStockForm({ ...base, quantity: '1.2345' })).toMatch(/how many/i);
    expect(validateStockForm({ ...base, reason: '' })).toMatch(/reason/i);
  });

  it('batch-tracked products: removal names the batch, adding names a batch or an expiry', () => {
    expect(validateStockForm({ ...base, tracked: true })).toMatch(/batch/i);
    expect(buildStockRequest({ ...base, tracked: true, batchId: 'b1' }).body).toMatchObject({
      batchId: 'b1',
      quantity: '-2',
    });
    const add = { ...base, mode: 'ADD' as const, reason: 'FOUND', tracked: true };
    expect(validateStockForm(add)).toMatch(/batch number or the expiry/i);
    expect(validateStockForm({ ...add, expiryDate: '2026-02-31' })).toMatch(/YYYY-MM-DD/);
    expect(
      buildStockRequest({ ...add, batchNumber: 'B7', expiryDate: '2026-12-31' }).body,
    ).toMatchObject({ batchNumber: 'B7', expiryDate: '2026-12-31' });
  });
});

describe('dates', () => {
  it.each([
    ['2026-12-31', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['31-12-2026', false],
  ])('%s -> %s', (v, ok) => {
    expect(isRealDate(v)).toBe(ok);
  });
});

describe('purchases', () => {
  const line = {
    key: 'a',
    productId: 'p1',
    name: 'Rice',
    unitId: 'bag',
    unitCode: 'BAG',
    quantity: '5',
    unitCost: '1400',
    discount: '',
    batchNumber: '',
    expiryDate: '',
  };
  const form: PurchaseForm = {
    supplierId: 's1',
    supplierInvoiceNo: ' INV-9 ',
    additionalCosts: '150',
    lines: [line],
    receiveNow: true,
  };

  it('builds the purchase with decimal strings and only what was typed', () => {
    expect(validatePurchaseForm(form)).toBeNull();
    expect(buildPurchasePayload(form)).toEqual({
      supplierId: 's1',
      supplierInvoiceNo: 'INV-9',
      items: [{ productId: 'p1', unitId: 'bag', quantity: '5', unitCost: '1400' }],
      additionalCosts: '150',
      receiveNow: true,
    });
    expect(
      buildPurchasePayload({
        ...form,
        receiveNow: false,
        additionalCosts: '0',
        supplierInvoiceNo: '',
      }),
    ).toEqual({
      supplierId: 's1',
      items: [{ productId: 'p1', unitId: 'bag', quantity: '5', unitCost: '1400' }],
    });
  });

  it('keeps batch, expiry and discount on a line', () => {
    const f = {
      ...form,
      lines: [
        {
          ...line,
          discount: '50',
          batchNumber: 'B1',
          expiryDate: '2026-12-31',
          unitCost: '1400.1234',
        },
      ],
    };
    expect(validatePurchaseForm(f)).toBeNull();
    expect(buildPurchasePayload(f).items[0]).toMatchObject({
      discount: '50',
      batchNumber: 'B1',
      expiryDate: '2026-12-31',
      unitCost: '1400.1234',
    });
  });

  it.each([
    [{ ...form, supplierId: null }, /supplier/i],
    [{ ...form, lines: [] }, /at least one/i],
    [{ ...form, lines: [{ ...line, quantity: '0' }] }, /how many/i],
    [{ ...form, lines: [{ ...line, unitCost: '12.34567' }] }, /price/i],
    [{ ...form, lines: [{ ...line, discount: '-1' }] }, /discount/i],
    [{ ...form, lines: [{ ...line, expiryDate: '2026-02-30' }] }, /expiry/i],
    [{ ...form, additionalCosts: 'abc' }, /freight/i],
  ])('refuses a bad purchase %#', (f, message) => {
    expect(validatePurchaseForm(f as PurchaseForm)).toMatch(message);
  });
});

describe('supplier payments and returns', () => {
  it('a payment needs an amount above zero', () => {
    expect(validatePayForm({ amount: '500.50', method: 'UPI', referenceNo: '' })).toBeNull();
    expect(validatePayForm({ amount: '0', method: 'CASH', referenceNo: '' })).toMatch(/amount/i);
    expect(validatePayForm({ amount: '12.345', method: 'CASH', referenceNo: '' })).toMatch(
      /amount/i,
    );
    expect(buildPayPayload({ amount: ' 500 ', method: 'UPI', referenceNo: ' UTR1 ' })).toEqual({
      amount: '500',
      method: 'UPI',
      referenceNo: 'UTR1',
    });
  });

  it('returns need a quantity and a reason, and send only the lines typed', () => {
    const lines = [
      { itemId: 'a', quantity: '1' },
      { itemId: 'b', quantity: '' },
      { itemId: 'c', quantity: '2', batchId: 'bt', disposition: 'DAMAGED' as const },
    ];
    expect(validateReturn(lines, 'spoiled')).toBeNull();
    expect(validateReturn([{ itemId: 'a', quantity: '' }], 'spoiled')).toMatch(/at least one/i);
    expect(validateReturn([{ itemId: 'a', quantity: 'x' }], 'spoiled')).toMatch(/numbers/i);
    expect(validateReturn(lines, 'x')).toMatch(/why/i);

    expect(buildSaleReturnPayload('sale1', lines, ' broken ', 'CUSTOMER_ACCOUNT')).toEqual({
      saleId: 'sale1',
      reason: 'broken',
      refundTo: 'CUSTOMER_ACCOUNT',
      items: [
        { saleItemId: 'a', quantity: '1', disposition: 'SALEABLE' },
        { saleItemId: 'c', quantity: '2', disposition: 'DAMAGED' },
      ],
    });
    expect(buildPurchaseReturnPayload('p1', lines, 'spoiled')).toEqual({
      purchaseId: 'p1',
      reason: 'spoiled',
      items: [
        { purchaseItemId: 'a', quantity: '1' },
        { purchaseItemId: 'c', quantity: '2', batchId: 'bt' },
      ],
    });
  });
});
