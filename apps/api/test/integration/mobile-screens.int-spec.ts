import { randomUUID } from 'node:crypto';
import {
  type Cart,
  type PaymentEntry,
  addToCart,
  amountLeft,
  buildCustomerPayload,
  buildPayPayload,
  buildPurchasePayload,
  buildPurchaseReturnPayload,
  buildSaleReturnPayload,
  buildStockRequest,
  buildSupplierPayload,
  emptyCart,
  idempotencyFor,
  parseHeldCart,
  previewBody,
  saleBody,
  setCustomer,
  updateLine,
  validateCart,
} from '@ksms/validation';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/**
 * The phone screens' contract with the server. Every request below is built by the SAME code the app uses
 * (@ksms/validation), in the order the screens make them, against a real database. If a screen's request and the
 * server ever drift apart, this fails.
 */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const B = '/api/v1';

suite('Phone screens contract (real database)', () => {
  jest.setTimeout(600_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let token: string;
  let branchId: string;
  let U: Record<'KG' | 'PCS' | 'BAG' | 'G', string>;
  let n = 0;

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
    const phone = uniquePhone();
    const res = await ctx
      .http()
      .post(`${B}/auth/register-owner`)
      .send({
        fullName: 'Owner',
        phone,
        password: PW,
        shopName: 'Screens',
        deviceUid: `dev-${phone}`,
      })
      .expect(201);
    token = res.body.data.accessToken;
    branchId = res.body.data.branches[0].id;
    const units = (await get('/units').expect(200)).body.data as { id: string; code: string }[];
    U = Object.fromEntries(units.map((u) => [u.code, u.id])) as typeof U;
  });
  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  const auth = <T extends { set(k: string, v: string): T }>(r: T) =>
    r.set('Authorization', `Bearer ${token}`).set('x-branch-id', branchId);
  const get = (p: string) => auth(ctx.http().get(B + p));
  const post = (p: string, body: object = {}, key: string | null = randomUUID()) => {
    const r = auth(ctx.http().post(B + p));
    if (key) r.set('idempotency-key', key);
    return r.send(body);
  };
  const newKey = () => randomUUID();
  const errCode = (res: { body: { error: { code: string } } }) => res.body.error.code;

  const product = async (body: object) =>
    (await post('/products', body, null).expect(201)).body.data as { id: string };
  const rice = () =>
    product({
      name: `Rice ${++n}`,
      type: 'WEIGHT',
      baseUnitId: U.KG,
      conversions: [{ unitId: U.G }, { unitId: U.BAG, factorToBase: '25' }],
      prices: [{ unitId: U.KG, price: '52' }],
    });

  it('stock screens: opening stock, add, remove, with the double-tap key behaviour', async () => {
    const r = await rice();
    const base = {
      productId: r.id,
      unitId: U.KG,
      tracked: false,
      batchId: '',
      batchNumber: '',
      expiryDate: '',
      notes: '',
    };

    const opening = buildStockRequest({
      ...base,
      mode: 'OPENING',
      quantity: '100',
      unitCost: '40',
      reason: '',
    });
    await post(opening.path, opening.body).expect(201);

    const add = buildStockRequest({
      ...base,
      mode: 'ADD',
      quantity: '5',
      unitCost: '',
      reason: 'FOUND',
      notes: 'behind the shelf',
    });
    await post(add.path, add.body).expect(201);

    const remove = buildStockRequest({
      ...base,
      mode: 'REMOVE',
      quantity: '2.5',
      unitCost: '',
      reason: 'DAMAGE',
    });
    const key = newKey();
    await post(remove.path, remove.body, key).expect(201);
    const again = await post(remove.path, remove.body, key).expect(201); // a retry with the same key
    expect(again.headers['idempotent-replayed']).toBe('true');

    const stock = (await get(`/inventory/balances/${r.id}`).expect(200)).body.data;
    expect(stock.quantityOnHand).toBe('102.500'); // 100 + 5 - 2.5, applied once
    expect(Array.isArray(stock.recentMovements)).toBe(true);
    expect(stock.recentMovements).toHaveLength(3);
    expect((await get('/inventory/expiring?withinDays=30').expect(200)).body.data).toEqual([]);
  });

  it('the till: build the cart, preview, check out, and a retry cannot sell twice', async () => {
    const r = await rice();
    await post('/inventory/opening-stock', {
      productId: r.id,
      unitId: U.KG,
      quantity: '50',
      unitCost: '40',
    }).expect(201);
    const cust = (
      await post(
        '/customers',
        buildCustomerPayload({
          name: 'Lakshmi',
          phone: `+91 ${uniquePhone()}`,
          creditLimit: '1000',
        }),
        null,
      ).expect(201)
    ).body.data;

    let cart: Cart = emptyCart();
    cart = addToCart(
      cart,
      { productId: r.id, name: 'Rice', unitId: U.KG, unitCode: 'KG', quantity: '2' },
      newKey,
    );
    cart = addToCart(
      cart,
      { productId: r.id, name: 'Rice', unitId: U.KG, unitCode: 'KG', quantity: '0.5' },
      newKey,
    ); // joins the line
    expect(cart.lines).toHaveLength(1);
    expect(validateCart(cart)).toBeNull();
    cart = setCustomer(cart, cust.id, cust.name);

    // the screen shows the server's figures as the cart is built
    const preview = (await post('/sales/preview', previewBody(cart), null).expect(200)).body.data;
    expect(preview).toMatchObject({ subtotal: '130.00', total: '130.00', credit: '130.00' });
    expect(preview.lines[0]).toMatchObject({
      quantity: '2.500',
      unitPrice: '52.00',
      net: '130.00',
    });

    // pay part now, the rest on khata
    const payments: PaymentEntry[] = [{ method: 'UPI', amount: '30', referenceNo: 'UTR-1' }];
    expect(amountLeft(preview.total, payments)).toBe('100.00');
    const withPay = (await post('/sales/preview', previewBody(cart, payments), null).expect(200))
      .body.data;
    expect(withPay).toMatchObject({ paid: '30.00', credit: '100.00' });

    // checkout: the key is kept while the request is unchanged (a retry after a lost answer)
    const body = saleBody(cart, payments);
    const first = idempotencyFor(null, { path: '/sales', body }, newKey);
    const sale = (await post('/sales', body, first.key).expect(201)).body.data;
    const retry = idempotencyFor(first, { path: '/sales', body }, newKey);
    expect(retry.key).toBe(first.key);
    const replay = await post('/sales', body, retry.key).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.data.id).toBe(sale.id);
    expect((await get(`/customers/${cust.id}`).expect(200)).body.data.balance).toBe('100.00');

    // a changed cart gets a NEW key, so the server never sees one key with two bodies
    const changed = updateLine(cart, cart.lines[0]!.key, { quantity: '1' });
    expect(
      idempotencyFor(retry, { path: '/sales', body: saleBody(changed, payments) }, newKey).key,
    ).not.toBe(first.key);

    // the bill list and detail the Billing tab and the bill screen read
    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const list = (await get(`/sales?from=${today}&to=${today}&pageSize=20`).expect(200)).body;
    expect(list.data.map((s: { id: string }) => s.id)).toContain(sale.id);
    const detail = (await get(`/sales/${sale.id}`).expect(200)).body.data;
    expect(detail).toMatchObject({
      total: '130.00',
      paidTotal: '30.00',
      creditAmount: '100.00',
      status: 'COMPLETED',
    });

    // the screen's payload for going over the credit limit is refused unless asked for
    const big = updateLine(cart, cart.lines[0]!.key, { quantity: '25' }); // 1300 on credit > 1000 limit
    const overBody = saleBody(big, []);
    expect(errCode(await post('/sales', overBody).expect(422))).toBe('CREDIT_LIMIT_EXCEEDED');
    const warn = (await post('/sales/preview', previewBody(big), null).expect(200)).body.data;
    expect(warn.warnings.creditLimit).toMatchObject({ creditLimit: '1000.00' });
    await post('/sales', saleBody(big, [], true)).expect(201);
  });

  it('held bills: park a cart and read it back as the same cart; checkout closes it', async () => {
    const r = await rice();
    await post('/inventory/opening-stock', {
      productId: r.id,
      unitId: U.KG,
      quantity: '20',
      unitCost: '40',
    }).expect(201);
    let cart = addToCart(
      emptyCart(),
      { productId: r.id, name: 'Rice', unitId: U.KG, unitCode: 'KG', quantity: '3', discount: '5' },
      newKey,
    );
    cart = { ...cart, billDiscount: '2' };
    const { heldBillId: _ignored, ...payload } = cart;
    void _ignored;
    const held = (await post('/held-bills', { label: 'Table 4', payload }, null).expect(201)).body
      .data;

    const list = (await get('/held-bills').expect(200)).body.data as {
      id: string;
      payload: unknown;
    }[];
    const back = parseHeldCart(list.find((h) => h.id === held.id)!.payload);
    expect(back).not.toBeNull();
    expect(back!.lines[0]).toMatchObject({ productId: r.id, quantity: '3', discount: '5' });
    expect(back!.billDiscount).toBe('2');

    const resumed: Cart = { ...back!, heldBillId: held.id };
    const sale = (
      await post('/sales', saleBody(resumed, [{ method: 'CASH', amount: '149' }])).expect(201)
    ).body.data;
    expect(sale.total).toBe('149.00'); // 156 - 5 - 2 = 149
    await get(`/held-bills/${held.id}`).expect(404); // closed by the checkout
  });

  it('bill screens: cancel, and return goods with the builder the return screen uses', async () => {
    const r = await rice();
    await post('/inventory/opening-stock', {
      productId: r.id,
      unitId: U.KG,
      quantity: '30',
      unitCost: '40',
    }).expect(201);
    const sellOnce = async () => {
      const cart = addToCart(
        emptyCart(),
        { productId: r.id, name: 'Rice', unitId: U.KG, unitCode: 'KG', quantity: '4' },
        newKey,
      );
      return (await post('/sales', saleBody(cart, [{ method: 'CASH', amount: '208' }])).expect(201))
        .body.data;
    };
    const a = await sellOnce();
    await post(`/sales/${a.id}/cancel`, { reason: 'customer changed mind' }).expect(200);
    expect((await get(`/inventory/balances/${r.id}`).expect(200)).body.data.quantityOnHand).toBe(
      '30.000',
    );

    const b = await sellOnce();
    const ret = buildSaleReturnPayload(
      b.id,
      [
        { itemId: b.items[0].id, quantity: '1', disposition: 'SALEABLE' },
        { itemId: b.items[0].id, quantity: '', disposition: 'DAMAGED' },
      ],
      'wrong item',
      'CASH',
    );
    expect(ret.items).toHaveLength(1);
    const made = (await post('/sale-returns', ret).expect(201)).body.data;
    expect(made.total).toBe('52.00');
    expect((await get(`/inventory/balances/${r.id}`).expect(200)).body.data.quantityOnHand).toBe(
      '27.000',
    ); // 30, sell 4 and cancel (30), sell 4 again (26), 1 returned (27)
  });

  it('khata and supplier screens: the add forms, search filters and the statement', async () => {
    const c = (
      await post(
        '/customers',
        buildCustomerPayload({ name: 'Ramesh', phone: uniquePhone(), creditLimit: '' }),
        null,
      ).expect(201)
    ).body.data;
    expect(
      (
        await get(`/customers?q=Rames&owes=false&sort=name&order=asc&page=1&pageSize=30`).expect(
          200,
        )
      ).body.data.map((x: { id: string }) => x.id),
    ).toContain(c.id);
    expect((await get(`/customers/${c.id}/ledger?pageSize=30`).expect(200)).body.data).toEqual([]);

    const s = (
      await post(
        '/suppliers',
        buildSupplierPayload({
          name: `Supplier ${++n}`,
          phone: uniquePhone(),
          contactPerson: 'Ganesh',
          openingBalance: '2500',
        }),
        null,
      ).expect(201)
    ).body.data;
    expect(s.balance).toBe('2500.00');
    const detail = (await get(`/suppliers/${s.id}`).expect(200)).body.data;
    expect(detail).toMatchObject({ purchaseCount: 0, unpaidPurchaseCount: 0 });
    expect(
      (await get(`/suppliers?owed=true&sort=balance&order=desc`).expect(200)).body.data.map(
        (x: { id: string }) => x.id,
      ),
    ).toContain(s.id);

    const paid = (
      await post(
        `/suppliers/${s.id}/payments`,
        buildPayPayload({ amount: '500', method: 'UPI', referenceNo: 'UTR9' }),
      ).expect(201)
    ).body.data;
    expect(paid).toMatchObject({ advance: '500.00', supplierBalance: '2000.00' });
    expect(paid.receiptNumber).toMatch(/^PV\//);
  });

  it('purchase screens: build, receive, pay, return, cancel', async () => {
    const r = await rice();
    const sup = (
      await post(
        '/suppliers',
        buildSupplierPayload({
          name: `Supplier ${++n}`,
          phone: '',
          contactPerson: '',
          openingBalance: '',
        }),
        null,
      ).expect(201)
    ).body.data;
    const line = {
      key: 'a',
      productId: r.id,
      name: 'Rice',
      unitId: U.BAG,
      unitCode: 'BAG',
      quantity: '4',
      unitCost: '1400',
      discount: '',
      batchNumber: '',
      expiryDate: '',
    };

    // received now
    const body = buildPurchasePayload({
      supplierId: sup.id,
      supplierInvoiceNo: 'INV-7',
      additionalCosts: '200',
      lines: [line],
      receiveNow: true,
    });
    const p = (await post('/purchases', body).expect(201)).body.data;
    expect(p).toMatchObject({ status: 'RECEIVED', total: '5800.00', outstanding: '5800.00' });
    expect((await get(`/inventory/balances/${r.id}`).expect(200)).body.data.quantityOnHand).toBe(
      '100.000',
    );
    expect(
      (await get('/purchases?unpaid=true&pageSize=20').expect(200)).body.data.map(
        (x: { id: string }) => x.id,
      ),
    ).toContain(p.id);

    // pay part, then send some goods back with the return screen's builder
    await post(
      `/suppliers/${sup.id}/payments`,
      buildPayPayload({ amount: '1000', method: 'CASH', referenceNo: '' }),
    ).expect(201);
    const ret = buildPurchaseReturnPayload(
      p.id,
      [
        { itemId: p.items[0].id, quantity: '1' },
        { itemId: p.items[0].id, quantity: '' },
      ],
      'damaged',
    );
    const made = (await post('/purchase-returns', ret).expect(201)).body.data;
    expect(made.total).toBe('1450.00'); // a quarter of 5800
    expect((await get(`/purchases/${p.id}`).expect(200)).body.data).toMatchObject({
      returnedTotal: '1450.00',
      paidTotal: '1000.00',
      outstanding: '3350.00',
    });

    // saved as a draft, then received from the purchase screen, or cancelled
    const draftBody = buildPurchasePayload({
      supplierId: sup.id,
      supplierInvoiceNo: '',
      additionalCosts: '',
      lines: [{ ...line, quantity: '2' }],
      receiveNow: false,
    });
    const draft = (await post('/purchases', draftBody).expect(201)).body.data;
    expect(draft.status).toBe('DRAFT');
    expect((await post(`/purchases/${draft.id}/receive`, {}).expect(201)).body.data.status).toBe(
      'RECEIVED',
    );
    const second = (await post('/purchases', draftBody).expect(201)).body.data;
    expect(
      (await post(`/purchases/${second.id}/cancel`, { reason: 'ordered by mistake' }).expect(200))
        .body.data.status,
    ).toBe('CANCELLED');
  });

  it('every list the screens open answers with the paging fields they read', async () => {
    for (const path of [
      '/products',
      '/customers',
      '/suppliers',
      '/purchases',
      '/sales',
      '/sale-returns',
      '/purchase-returns',
      '/held-bills',
      '/inventory/balances',
      '/supplier-payments',
    ]) {
      const res = await get(`${path}?page=1&pageSize=5`).expect(200);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5 });
      expect(typeof res.body.meta.total).toBe('number');
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });
});
