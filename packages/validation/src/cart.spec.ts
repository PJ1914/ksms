import {
  type Cart,
  addToCart,
  amountLeft,
  cartIsEmpty,
  emptyCart,
  fingerprint,
  idempotencyFor,
  parseHeldCart,
  previewBody,
  removeLine,
  saleBody,
  setBillDiscount,
  setCustomer,
  updateLine,
  validateCart,
  validatePayments,
} from './cart';

let n = 0;
const key = () => `k${++n}`;
const rice = { productId: 'p1', name: 'Rice', unitId: 'kg', unitCode: 'KG', quantity: '1' };

describe('cart', () => {
  it('adds items, and the same item in the same unit joins its line', () => {
    let c = addToCart(emptyCart(), rice, key);
    c = addToCart(c, { ...rice, quantity: '1.5' }, key);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]!.quantity).toBe('2.5');
    c = addToCart(c, { ...rice, unitId: 'g', unitCode: 'G', quantity: '500' }, key);
    expect(c.lines).toHaveLength(2);
  });

  it('adds fractions exactly (no floating point drift)', () => {
    let c = emptyCart();
    for (let i = 0; i < 10; i++) c = addToCart(c, { ...rice, quantity: '0.1' }, key);
    expect(c.lines[0]!.quantity).toBe('1');
    c = addToCart(c, { ...rice, quantity: '0.2' }, key);
    expect(c.lines[0]!.quantity).toBe('1.2');
  });

  it('a line with a discount or special price stays separate', () => {
    let c = addToCart(emptyCart(), rice, key);
    c = addToCart(c, { ...rice, unitPrice: '40' }, key);
    c = addToCart(c, { ...rice, discount: '2' }, key);
    expect(c.lines).toHaveLength(3);
  });

  it('edits and removes lines, sets the customer, and reports emptiness', () => {
    let c = addToCart(emptyCart(), rice, key);
    const k = c.lines[0]!.key;
    c = updateLine(c, k, { quantity: '3', discount: '5' });
    expect(c.lines[0]).toMatchObject({ quantity: '3', discount: '5' });
    c = setCustomer(c, 'c1', 'Lakshmi');
    expect(c).toMatchObject({ customerId: 'c1', customerName: 'Lakshmi' });
    c = setCustomer(c, null, 'ignored');
    expect(c).toMatchObject({ customerId: null, customerName: null });
    c = setBillDiscount(c, '10');
    expect(c.billDiscount).toBe('10');
    expect(cartIsEmpty(removeLine(c, k))).toBe(true);
  });

  it.each([
    ['empty cart', emptyCart(), /at least one/i],
    ['bad quantity', { ...emptyCart(), lines: [{ ...baseLine(), quantity: 'abc' }] }, /quantity/i],
    ['zero quantity', { ...emptyCart(), lines: [{ ...baseLine(), quantity: '0' }] }, /quantity/i],
    [
      'too many decimals',
      { ...emptyCart(), lines: [{ ...baseLine(), quantity: '1.2345' }] },
      /quantity/i,
    ],
    [
      'bad line discount',
      { ...emptyCart(), lines: [{ ...baseLine(), discount: '-1' }] },
      /discount/i,
    ],
    ['bad typed price', { ...emptyCart(), lines: [{ ...baseLine(), unitPrice: '1e3' }] }, /price/i],
    [
      'bad bill discount',
      { ...emptyCart(), lines: [baseLine()], billDiscount: '5.555' },
      /bill discount/i,
    ],
  ])('validateCart refuses: %s', (_n, cart, message) => {
    expect(validateCart(cart as Cart)).toMatch(message);
  });

  it('validateCart accepts a normal cart', () => {
    expect(
      validateCart({ ...emptyCart(), lines: [{ ...baseLine(), discount: '2.50' }] }),
    ).toBeNull();
  });
});

function baseLine() {
  return {
    key: 'a',
    productId: 'p1',
    name: 'Rice',
    unitId: 'kg',
    unitCode: 'KG',
    quantity: '1',
    discount: '',
    unitPrice: '',
  };
}

describe('what is sent to the server', () => {
  const cart: Cart = {
    customerId: 'c1',
    customerName: 'Lakshmi',
    billDiscount: ' 10 ',
    heldBillId: 'h1',
    lines: [
      { ...baseLine(), quantity: ' 2 ', discount: '5' },
      { ...baseLine(), key: 'b', productId: 'p2', unitPrice: '80' },
    ],
  };

  it('the sale body carries amounts as decimal STRINGS and leaves out what was not typed', () => {
    const b = saleBody(cart, [
      { method: 'CASH', amount: ' 100 ' },
      { method: 'UPI', amount: '', referenceNo: 'x' },
    ]);
    expect(b).toEqual({
      customerId: 'c1',
      items: [
        { productId: 'p1', unitId: 'kg', quantity: '2', discount: '5' },
        { productId: 'p2', unitId: 'kg', quantity: '1', unitPrice: '80' },
      ],
      billDiscount: '10',
      payments: [{ method: 'CASH', amount: '100' }],
      heldBillId: 'h1',
    });
    expect(JSON.stringify(b)).not.toMatch(/:\d+(\.\d+)?[,}]/); // no JSON numbers for money or quantity
  });

  it('only asks for a credit-limit override when told to', () => {
    expect(saleBody(cart, [], false)).not.toHaveProperty('overrideCreditLimit');
    expect(saleBody(cart, [], true)).toMatchObject({ overrideCreditLimit: true });
  });

  it('a walk-in cart has no customer', () => {
    expect(saleBody({ ...cart, customerId: null, heldBillId: null }, [])).not.toHaveProperty(
      'customerId',
    );
  });

  it('the preview body has no held bill and payments only when given', () => {
    expect(previewBody(cart)).not.toHaveProperty('heldBillId');
    expect(previewBody(cart)).not.toHaveProperty('payments');
    expect(previewBody(cart, [{ method: 'CASH', amount: '50' }])).toMatchObject({
      payments: [{ method: 'CASH', amount: '50' }],
    });
  });
});

describe('payments', () => {
  it('works out what is left, exactly, and never below zero', () => {
    expect(
      amountLeft('268.00', [
        { method: 'CASH', amount: '100.10' },
        { method: 'UPI', amount: '67.90' },
      ]),
    ).toBe('100.00');
    expect(
      amountLeft('100.00', [
        { method: 'CASH', amount: '0.1' },
        { method: 'CASH', amount: '0.2' },
      ]),
    ).toBe('99.70');
    expect(amountLeft('50.00', [{ method: 'CASH', amount: '80' }])).toBe('0.00');
    expect(amountLeft('50.00', [{ method: 'CASH', amount: 'abc' }])).toBe('50.00');
  });

  it('refuses amounts that are not money', () => {
    expect(validatePayments([{ method: 'CASH', amount: '12.345' }])).toMatch(/rupees/);
    expect(
      validatePayments([
        { method: 'CASH', amount: '' },
        { method: 'UPI', amount: '10.5' },
      ]),
    ).toBeNull();
  });
});

describe('double-tap protection', () => {
  it('the same request text gives the same fingerprint whatever the key order', () => {
    expect(fingerprint({ a: 1, b: { d: 2, c: 3 } })).toBe(fingerprint({ b: { c: 3, d: 2 }, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });

  it('keeps the SAME idempotency key while the request is unchanged and makes a new one when it changes', () => {
    let made = 0;
    const next = () => `key-${++made}`;
    const first = idempotencyFor(null, { total: 1 }, next);
    const retry = idempotencyFor(first, { total: 1 }, next);
    expect(retry.key).toBe(first.key);
    expect(made).toBe(1);
    const changed = idempotencyFor(retry, { total: 2 }, next);
    expect(changed.key).not.toBe(first.key);
    expect(made).toBe(2);
  });
});

describe('held bills', () => {
  it('reads back a parked cart', () => {
    const c = parseHeldCart({
      customerId: 'c1',
      customerName: 'L',
      billDiscount: '5',
      lines: [baseLine()],
    });
    expect(c).toMatchObject({ customerId: 'c1', billDiscount: '5', heldBillId: null });
    expect(c!.lines).toHaveLength(1);
  });

  it.each([[null], ['text'], [{}], [{ lines: [{ key: 1 }] }], [{ lines: 'x' }]])(
    'refuses non-carts: %j',
    (payload) => {
      expect(parseHeldCart(payload)).toBeNull();
    },
  );
});
