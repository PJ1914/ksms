import { randomUUID } from 'node:crypto';
import { todayInIndia } from '../../src/common/utils/dates';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/**
 * Sales and POS: checkout, split payment, credit with limits, discounts and price override, FEFO and stock rules,
 * concurrency (no oversell, no duplicate bill), held bills, cancellation and returns, and the proof that bills,
 * stock, money and customer accounts agree. Real PostgreSQL.
 */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const addDays = (days: number) => {
  const t = new Date(`${todayInIndia()}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
const BILL = /^B\/\d{4}-\d{2}\/\d{6}$/;

suite('Sales and POS (real database)', () => {
  jest.setTimeout(900_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let U: Record<'KG' | 'G' | 'L' | 'PCS' | 'BAG', string>;

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
  });
  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  // ---------- helpers ----------
  interface Shop {
    token: string;
    organizationId: string;
    userId: string;
    branchId: string;
  }
  type Api = ReturnType<typeof api>;
  const api = (token: string, branchId?: string) => {
    const a = <T extends { set(k: string, v: string): T }>(r: T) => {
      r.set('Authorization', `Bearer ${token}`);
      if (branchId) r.set('x-branch-id', branchId);
      return r;
    };
    const b = '/api/v1';
    return {
      get: (p: string) => a(ctx.http().get(b + p)),
      post: (p: string, body: object = {}, key: string | null = randomUUID()) => {
        const r = a(ctx.http().post(b + p));
        if (key) r.set('idempotency-key', key);
        return r.send(body);
      },
      put: (p: string, body: object) => a(ctx.http().put(b + p)).send(body),
      patch: (p: string, body: object) => a(ctx.http().patch(b + p)).send(body),
      delete: (p: string) => a(ctx.http().delete(b + p)),
    };
  };
  const newShop = async (): Promise<Shop> => {
    const phone = uniquePhone();
    const res = await ctx
      .http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Owner',
        phone,
        password: PW,
        shopName: `Shop ${phone}`,
        deviceUid: `device-${phone}`,
      })
      .expect(201);
    const x = res.body.data;
    return {
      token: x.accessToken,
      organizationId: x.organization.id,
      userId: x.user.id,
      branchId: x.branches[0].id,
    };
  };
  const hire = async (s: Shop, roleName: string): Promise<string> => {
    const roles = (await api(s.token).get('/roles').expect(200)).body.data as {
      id: string;
      name: string;
    }[];
    const phone = uniquePhone();
    const inv = await api(s.token)
      .post(
        '/invitations',
        { phone, roleId: roles.find((r) => r.name === roleName)!.id, branchIds: [s.branchId] },
        null,
      )
      .expect(201);
    const res = await ctx
      .http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: inv.body.data.code,
        fullName: `${roleName} X`,
        password: PW,
        deviceUid: `device-${phone}`,
      })
      .expect(201);
    return res.body.data.accessToken;
  };
  const errCode = (res: { body: { error: { code: string } } }) => res.body.error.code;

  let shop: Shop;
  let A: Api;
  let n = 0;
  const product = async (body: object, s: Shop = shop) =>
    (await api(s.token).post('/products', body, null).expect(201)).body.data as { id: string };
  /** Loose rice: 52/kg, and a 500 g pack price of 27. Opening stock at cost 40/kg. */
  const rice = async (stockKg = '100', s: Shop = shop) => {
    const p = await product(
      {
        name: `Rice ${++n}`,
        type: 'WEIGHT',
        baseUnitId: U.KG,
        conversions: [{ unitId: U.G }, { unitId: U.BAG, factorToBase: '25' }],
        prices: [
          { unitId: U.KG, price: '52' },
          { unitId: U.G, quantity: '500', price: '27' },
        ],
      },
      s,
    );
    if (stockKg !== '0') await opening(p.id, U.KG, stockKg, '40', {}, s);
    return p;
  };
  const piece = async (price: string, stock = '50', extra: object = {}) => {
    const p = await product({
      name: `Item ${++n}`,
      type: 'COUNT',
      baseUnitId: U.PCS,
      prices: [{ unitId: U.PCS, price }],
      ...extra,
    });
    if (stock !== '0') await opening(p.id, U.PCS, stock, '20');
    return p;
  };
  const opening = (
    productId: string,
    unitId: string,
    quantity: string,
    unitCost: string,
    extra: object = {},
    s: Shop = shop,
  ) =>
    api(s.token, s.branchId)
      .post('/inventory/opening-stock', { productId, unitId, quantity, unitCost, ...extra })
      .expect(201);
  const item = (productId: string, unitId: string, quantity: string, extra: object = {}) => ({
    productId,
    unitId,
    quantity,
    ...extra,
  });
  const cash = (amount: string) => ({ method: 'CASH', amount });
  const sell = (body: object, a: Api = A, key: string | null = randomUUID()) =>
    a.post('/sales', body, key);
  const sold = async (body: object, a: Api = A) => (await sell(body, a).expect(201)).body.data;
  const stockOf = async (productId: string) =>
    (await A.get(`/inventory/balances/${productId}`).expect(200)).body.data;
  const customer = async (extra: object = {}) =>
    (
      await api(shop.token)
        .post('/customers', { name: `Customer ${++n}`, phone: uniquePhone(), ...extra }, null)
        .expect(201)
    ).body.data as { id: string; balance: string };
  const balanceOf = async (customerId: string) =>
    (await api(shop.token).get(`/customers/${customerId}`).expect(200)).body.data.balance as string;
  const sale = async (id: string) => (await A.get(`/sales/${id}`).expect(200)).body.data;
  const booksAgree = async (s: Shop = shop) => {
    const a = api(s.token, s.branchId);
    expect((await a.get('/sales/reconciliation').expect(200)).body.data).toMatchObject({
      consistent: true,
    });
    expect((await a.get('/inventory/reconciliation').expect(200)).body.data).toMatchObject({
      consistent: true,
    });
  };

  beforeAll(async () => {
    shop = await newShop();
    A = api(shop.token, shop.branchId);
    const units = (await api(shop.token).get('/units').expect(200)).body.data as {
      id: string;
      code: string;
    }[];
    U = Object.fromEntries(units.map((u) => [u.code, u.id])) as typeof U;
  });

  // ---------- A. checkout ----------
  describe('checkout', () => {
    it('walk-in cash bill: catalogue prices, stock out at average cost, one cashbook line, a bill number', async () => {
      const r = await rice();
      const soap = await piece('35');
      const s = await sold({
        items: [item(r.id, U.KG, '2'), item(soap.id, U.PCS, '3')],
        payments: [cash('209')],
      });
      expect(s.saleNumber).toMatch(BILL);
      expect(s).toMatchObject({
        status: 'COMPLETED',
        subtotal: '209.00',
        total: '209.00',
        paidTotal: '209.00',
        creditAmount: '0.00',
        customer: null,
      });
      expect(
        s.items.map(
          (i: { name: string; quantity: string; unitPrice: string; lineTotal: string }) => [
            i.quantity,
            i.unitPrice,
            i.lineTotal,
          ],
        ),
      ).toEqual([
        ['2.000', '52.00', '104.00'],
        ['3.000', '35.00', '105.00'],
      ]);
      expect((await stockOf(r.id)).quantityOnHand).toBe('98.000');
      expect((await stockOf(soap.id)).quantityOnHand).toBe('47.000');

      const line = await ctx.prisma.saleItem.findFirstOrThrow({
        where: { saleId: s.id, productId: r.id },
      });
      expect(line.unitCostSnapshot.toFixed(4)).toBe('40.0000'); // cost of goods recorded for profit reports
      const cashbook = await ctx.prisma.cashbookEntry.findMany({
        where: { referenceType: 'SALE', referenceId: s.id },
      });
      expect(cashbook.map((c) => [c.kind, c.method, c.amount.toFixed(2)])).toEqual([
        ['SALE_RECEIPT', 'CASH', '209.00'],
      ]);
      expect(await ctx.prisma.cashRegister.count({ where: { branchId: shop.branchId } })).toBe(1);
      await booksAgree();
    });

    it('sells loose goods by weight: the 500 g pack price, and kilos at the kilo price', async () => {
      const r = await rice();
      const s = await sold({
        items: [item(r.id, U.G, '500'), item(r.id, U.KG, '1.5')],
        payments: [cash('105')],
      });
      expect(
        s.items.map((i: { lineTotal: string; unitCode: string }) => [i.unitCode, i.lineTotal]),
      ).toEqual([
        ['G', '27.00'],
        ['KG', '78.00'],
      ]);
      expect((await stockOf(r.id)).quantityOnHand).toBe('98.000');
    });

    it('rounds the bill to the nearest rupee and records the round-off', async () => {
      const biscuit = await piece('10.49');
      const s = await sold({ items: [item(biscuit.id, U.PCS, '1')], payments: [cash('10')] });
      expect(s).toMatchObject({ subtotal: '10.49', roundOff: '-0.49', total: '10.00' });
    });

    it('split payment: each method is its own payment and cashbook line', async () => {
      const soap = await piece('35');
      const s = await sold({
        items: [item(soap.id, U.PCS, '6')],
        payments: [cash('100'), { method: 'UPI', amount: '110', referenceNo: 'UTR-778' }],
      });
      expect(
        s.payments.map((p: { method: string; amount: string }) => [p.method, p.amount]),
      ).toEqual([
        ['CASH', '100.00'],
        ['UPI', '110.00'],
      ]);
      const lines = await ctx.prisma.cashbookEntry.findMany({
        where: { referenceId: s.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(lines.map((c) => [c.method, c.amount.toFixed(2)]).sort()).toEqual([
        ['CASH', '100.00'],
        ['UPI', '110.00'],
      ]);
      await booksAgree();
    });

    it('refuses an overpaid bill and a walk-in bill left unpaid; nothing is saved', async () => {
      const soap = await piece('35', '10');
      const before = await ctx.prisma.sale.count({
        where: { organizationId: shop.organizationId },
      });
      expect(
        errCode(
          await sell({ items: [item(soap.id, U.PCS, '1')], payments: [cash('36')] }).expect(422),
        ),
      ).toBe('PAYMENT_EXCEEDS_TOTAL');
      expect(
        errCode(
          await sell({ items: [item(soap.id, U.PCS, '1')], payments: [cash('10')] }).expect(422),
        ),
      ).toBe('CREDIT_NEEDS_CUSTOMER');
      expect(
        errCode(
          await sell({ items: [item(soap.id, U.PCS, '1')], payments: [cash('0')] }).expect(422),
        ),
      ).toBe('PAYMENT_AMOUNT_INVALID');
      expect((await stockOf(soap.id)).quantityOnHand).toBe('10.000');
      expect(await ctx.prisma.sale.count({ where: { organizationId: shop.organizationId } })).toBe(
        before,
      );
    });

    it('refuses bad lines: units, quantities, inactive products, unknown products', async () => {
      const r = await rice();
      const soap = await piece('35');
      const code = async (items: object[], status = 422) =>
        errCode(await sell({ items, payments: [] }).expect(status));
      expect(await code([item(r.id, U.BAG, '1')])).toBe('UNIT_NOT_SALE_ENABLED'); // bags are bought, not sold
      expect(await code([item(r.id, U.PCS, '1')])).toBe('UNIT_NOT_CONFIGURED');
      expect(await code([item(soap.id, U.PCS, '1.5')])).toBe('FRACTIONAL_NOT_ALLOWED');
      expect(await code([item(soap.id, U.PCS, '0')])).toBe('QUANTITY_INVALID');
      expect(await code([item(randomUUID(), U.PCS, '1')], 404)).toBe('NOT_FOUND');
      await sell({ items: [], payments: [] }).expect(400);
      await sell({ items: [item(soap.id, U.PCS, '1.2345')], payments: [] }).expect(400);
      await api(shop.token).patch(`/products/${soap.id}`, { status: 'INACTIVE' }).expect(200);
      expect(await code([item(soap.id, U.PCS, '1')])).toBe('PRODUCT_NOT_ACTIVE');
    });
  });

  // ---------- B. credit ----------
  describe('credit sales (khata)', () => {
    it('puts the unpaid part on the customer account and respects the credit limit', async () => {
      const soap = await piece('100', '50');
      const c = await customer({ creditLimit: '500' });
      const s1 = await sold({ customerId: c.id, items: [item(soap.id, U.PCS, '3')], payments: [] });
      expect(s1).toMatchObject({ total: '300.00', paidTotal: '0.00', creditAmount: '300.00' });
      expect(await balanceOf(c.id)).toBe('300.00');

      // a second 300 would make 600 > 500: refused, and nothing changes (stock, numbers, balance)
      const over = await sell({
        customerId: c.id,
        items: [item(soap.id, U.PCS, '3')],
        payments: [],
      }).expect(422);
      expect(errCode(over)).toBe('CREDIT_LIMIT_EXCEEDED');
      expect(over.body.error.details).toMatchObject({
        creditLimit: '500.00',
        balance: '300.00',
        available: '200.00',
      });
      expect(await balanceOf(c.id)).toBe('300.00');
      expect((await stockOf(soap.id)).quantityOnHand).toBe('47.000');

      // part payment keeps it within the limit
      const s2 = await sold({
        customerId: c.id,
        items: [item(soap.id, U.PCS, '3')],
        payments: [cash('150')],
      });
      expect(s2).toMatchObject({ paidTotal: '150.00', creditAmount: '150.00' });
      expect(await balanceOf(c.id)).toBe('450.00');

      const ledger = (await api(shop.token).get(`/customers/${c.id}/ledger`).expect(200)).body;
      expect(
        ledger.data.map((e: { type: string; amount: string; balanceAfter: string }) => [
          e.type,
          e.amount,
          e.balanceAfter,
        ]),
      ).toEqual([
        ['CREDIT_SALE', '150.00', '450.00'],
        ['CREDIT_SALE', '300.00', '300.00'],
      ]);
      expect(ledger.meta.customer).toMatchObject({ balance: '450.00' });
      await booksAgree();
    });

    it('going over the limit must be asked for AND allowed: not even the owner slips past it by accident', async () => {
      const soap = await piece('100', '50');
      const c = await customer({ creditLimit: '100' });
      const cashier = api(await hire(shop, 'Cashier'), shop.branchId);
      const manager = api(await hire(shop, 'Manager'), shop.branchId);
      const bill = (extra: object = {}) => ({
        customerId: c.id,
        items: [item(soap.id, U.PCS, '2')],
        payments: [],
        ...extra,
      });
      // without asking: refused for everyone, the owner included
      expect(errCode(await sell(bill()).expect(422))).toBe('CREDIT_LIMIT_EXCEEDED');
      expect(errCode(await sell(bill(), manager).expect(422))).toBe('CREDIT_LIMIT_EXCEEDED');
      // asking without the permission: refused
      const denied = await sell(bill({ overrideCreditLimit: true }), cashier).expect(403);
      expect(denied.body.error.details).toMatchObject({ required: ['credit.override_limit'] });
      // asking with the permission: allowed and audited
      const ok = (await sell(bill({ overrideCreditLimit: true }), manager).expect(201)).body.data;
      expect(await balanceOf(c.id)).toBe('200.00');
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: ok.id, action: 'sale.create' },
      });
      expect(audit.afterData).toMatchObject({ creditLimitOverride: true });
    });

    it('a switched-off customer gets no new credit but can still pay in full', async () => {
      const soap = await piece('100', '50');
      const c = await customer();
      await api(shop.token).post(`/customers/${c.id}/deactivate`, {}, null).expect(200);
      expect(
        errCode(
          await sell({ customerId: c.id, items: [item(soap.id, U.PCS, '1')], payments: [] }).expect(
            422,
          ),
        ),
      ).toBe('CUSTOMER_INACTIVE');
      await sell({
        customerId: c.id,
        items: [item(soap.id, U.PCS, '1')],
        payments: [cash('100')],
      }).expect(201);
    });
  });

  // ---------- C. discounts and price override ----------
  describe('discounts and prices', () => {
    it('shares a bill discount across lines exactly; line discounts apply first', async () => {
      const a = await piece('100');
      const b = await piece('200');
      const s = await sold({
        items: [item(a.id, U.PCS, '1', { discount: '5' }), item(b.id, U.PCS, '1')],
        billDiscount: '10',
        payments: [cash('285')],
      });
      // after line discount 95 + 200 = 295; bill discount 10 shared 95:200 -> 3.22 and 6.78
      expect(
        s.items.map((i: { discountAmount: string; lineTotal: string }) => [
          i.discountAmount,
          i.lineTotal,
        ]),
      ).toEqual([
        ['8.22', '91.78'],
        ['6.78', '193.22'],
      ]);
      expect(s).toMatchObject({ subtotal: '300.00', discountTotal: '15.00', total: '285.00' });
    });

    it('cashiers stay within the shop discount limit (5%); a manager may go above it', async () => {
      const p = await piece('100', '50');
      const cashier = api(await hire(shop, 'Cashier'), shop.branchId);
      const manager = api(await hire(shop, 'Manager'), shop.branchId);
      await sell(
        { items: [item(p.id, U.PCS, '1', { discount: '5' })], payments: [cash('95')] },
        cashier,
      ).expect(201);
      const over = await sell(
        { items: [item(p.id, U.PCS, '1', { discount: '6' })], payments: [cash('94')] },
        cashier,
      ).expect(403);
      expect(errCode(over)).toBe('DISCOUNT_LIMIT_EXCEEDED');
      expect(over.body.error.details).toMatchObject({
        limitPercent: '5.00',
        requestedPercent: '6.00',
      });
      await sell(
        { items: [item(p.id, U.PCS, '1', { discount: '6' })], payments: [cash('94')] },
        manager,
      ).expect(201);
      expect(
        errCode(
          await sell(
            { items: [item(p.id, U.PCS, '1', { discount: '101' })], payments: [] },
            manager,
          ).expect(422),
        ),
      ).toBe('DISCOUNT_EXCEEDS_LINE');
    });

    it('roles without the discount permission cannot discount; only price.override may change the price', async () => {
      const p = await piece('100', '50');
      const agent = api(await hire(shop, 'Collection Agent'), shop.branchId);
      await sell({ items: [item(p.id, U.PCS, '1')], payments: [cash('100')] }, agent).expect(403); // agents do not sell
      const cashier = api(await hire(shop, 'Cashier'), shop.branchId);
      const typed = await sell(
        { items: [item(p.id, U.PCS, '1', { unitPrice: '80' })], payments: [cash('80')] },
        cashier,
      ).expect(403);
      expect(typed.body.error.details).toMatchObject({ required: ['price.override'] });

      const s = await sold({
        items: [item(p.id, U.PCS, '2', { unitPrice: '80' })],
        payments: [cash('160')],
      }); // the owner may
      expect(s.items[0]).toMatchObject({ unitPrice: '80.00', lineTotal: '160.00' });
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: s.id, action: 'sale.create' },
      });
      expect(audit.afterData).toMatchObject({
        priceOverrides: [{ line: 1, catalogue: '200.00', typed: '160.00' }],
      });
    });
  });

  // ---------- D. stock rules ----------
  describe('stock', () => {
    it('never sells more than is in stock; a refused bill uses no bill number', async () => {
      const p = await piece('10', '3');
      const first = await sold({ items: [item(p.id, U.PCS, '1')], payments: [cash('10')] });
      const refused = await sell({
        items: [item(p.id, U.PCS, '3')],
        payments: [cash('30')],
      }).expect(409);
      expect(errCode(refused)).toBe('INSUFFICIENT_STOCK');
      expect((await stockOf(p.id)).quantityOnHand).toBe('2.000');
      const next = await sold({ items: [item(p.id, U.PCS, '2')], payments: [cash('20')] });
      expect(Number(next.saleNumber.split('/')[2])).toBe(
        Number(first.saleNumber.split('/')[2]) + 1,
      );
    });

    it('sells the earliest-expiring batch first and never sells expired stock', async () => {
      const milk = await product({
        name: `Milk ${++n}`,
        type: 'COUNT',
        baseUnitId: U.PCS,
        trackExpiry: true,
        prices: [{ unitId: U.PCS, price: '30' }],
      });
      await opening(milk.id, U.PCS, '4', '20', { batchNumber: 'LATE', expiryDate: addDays(20) });
      await A.post('/inventory/adjustments', {
        productId: milk.id,
        unitId: U.PCS,
        quantity: '3',
        reason: 'FOUND',
        unitCost: '20',
        batchNumber: 'SOON',
        expiryDate: addDays(2),
      }).expect(201);
      await sold({ items: [item(milk.id, U.PCS, '5')], payments: [cash('150')] });
      const batches = (await stockOf(milk.id)).batches as {
        batchNumber: string;
        quantity: string;
      }[];
      expect(batches.map((b) => [b.batchNumber, b.quantity])).toEqual([['LATE', '2.000']]); // SOON (3) went first
    });
  });

  // ---------- E. concurrency and retries ----------
  describe('concurrency (real row locks)', () => {
    it('20 counters selling the last 5 units at once: exactly 5 bills, stock 0, numbers unique and gap-free', async () => {
      const p = await piece('10', '5');
      const all = await Promise.all(
        Array.from({ length: 20 }, () =>
          sell({ items: [item(p.id, U.PCS, '1')], payments: [cash('10')] }),
        ),
      );
      const ok = all.filter((r) => r.status === 201);
      expect(ok).toHaveLength(5);
      expect(
        all.filter((r) => r.status === 409).every((r) => errCode(r) === 'INSUFFICIENT_STOCK'),
      ).toBe(true);
      expect((await stockOf(p.id)).quantityOnHand).toBe('0.000');
      const numbers = ok
        .map((r) => Number(r.body.data.saleNumber.split('/')[2]))
        .sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(5);
      expect(numbers[4]! - numbers[0]!).toBe(4); // consecutive: refused bills used no number
      await booksAgree();
    });

    it('five copies of one checkout (double taps) make ONE bill, one stock movement, one payment', async () => {
      const p = await piece('10', '20');
      const key = randomUUID();
      const body = { items: [item(p.id, U.PCS, '2')], payments: [cash('20')] };
      const all = await Promise.all(Array.from({ length: 5 }, () => sell(body, A, key)));
      expect(all.every((r) => r.status === 201)).toBe(true);
      expect(new Set(all.map((r) => r.body.data.id)).size).toBe(1);
      expect(all.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(4);
      expect((await stockOf(p.id)).quantityOnHand).toBe('18.000');
      expect(
        await ctx.prisma.payment.count({
          where: { salePayments: { some: { saleId: all[0]!.body.data.id } } },
        }),
      ).toBe(1);
      expect(errCode(await sell({ ...body, billDiscount: '1' }, A, key).expect(422))).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
      expect(errCode(await sell(body, A, null).expect(400))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('ten credit bills at once for one customer never break the credit limit', async () => {
      const p = await piece('150', '50');
      const c = await customer({ creditLimit: '1000' });
      const all = await Promise.all(
        Array.from({ length: 10 }, () =>
          sell({ customerId: c.id, items: [item(p.id, U.PCS, '1')], payments: [] }),
        ),
      );
      expect(all.filter((r) => r.status === 201)).toHaveLength(6); // 6 x 150 = 900; a 7th would be 1050
      expect(
        all.filter((r) => r.status === 422).every((r) => errCode(r) === 'CREDIT_LIMIT_EXCEEDED'),
      ).toBe(true);
      expect(await balanceOf(c.id)).toBe('900.00');
      expect((await stockOf(p.id)).quantityOnHand).toBe('44.000');
      await booksAgree();
    });
  });

  describe('concurrency on one customer account', () => {
    it('ten credit bills at once for DIFFERENT products: only the customer lock keeps the limit safe', async () => {
      // Different products take different stock locks, so nothing but the customer row lock makes these bills wait
      // for each other. Without it two bills could both see the old balance and both pass the limit.
      const products = await Promise.all(Array.from({ length: 10 }, () => piece('150', '5')));
      const c = await customer({ creditLimit: '1000' });
      const all = await Promise.all(
        products.map((p) =>
          sell({ customerId: c.id, items: [item(p.id, U.PCS, '1')], payments: [] }),
        ),
      );
      expect(all.filter((r) => r.status === 201)).toHaveLength(6);
      expect(
        all.filter((r) => r.status === 422).every((r) => errCode(r) === 'CREDIT_LIMIT_EXCEEDED'),
      ).toBe(true);
      expect(await balanceOf(c.id)).toBe('900.00');
      await booksAgree();
    });
  });

  describe('one customer buying in several branches at once', () => {
    it('credit bills in five branches at once: the customer lock alone keeps the limit safe', async () => {
      // Each branch has its own bill counter and stock rows, so across branches NOTHING but the customer row lock
      // makes these bills wait for each other.
      const p = await product({
        name: `Shared ${++n}`,
        type: 'COUNT',
        baseUnitId: U.PCS,
        prices: [{ unitId: U.PCS, price: '150' }],
      });
      const branches: Api[] = [];
      for (let i = 0; i < 5; i++) {
        const b = (
          await api(shop.token)
            .post('/branches', { code: `C${++n}`, name: `Counter ${n}` }, null)
            .expect(201)
        ).body.data;
        const B = api(shop.token, b.id);
        await B.post('/inventory/opening-stock', {
          productId: p.id,
          unitId: U.PCS,
          quantity: '5',
          unitCost: '20',
        }).expect(201);
        branches.push(B);
      }
      const c = await customer({ creditLimit: '1000' });
      const all = await Promise.all(
        [...branches, ...branches].map((B) =>
          sell({ customerId: c.id, items: [item(p.id, U.PCS, '1')], payments: [] }, B),
        ),
      );
      expect(all.filter((r) => r.status === 201)).toHaveLength(6); // 6 x 150 = 900; a 7th would be 1050
      expect(
        all.filter((r) => r.status === 422).every((r) => errCode(r) === 'CREDIT_LIMIT_EXCEEDED'),
      ).toBe(true);
      expect(await balanceOf(c.id)).toBe('900.00');
      expect((await A.get('/sales/reconciliation').expect(200)).body.data.consistent).toBe(true);
    });
  });

  describe('cart preview', () => {
    it('shows exactly what checkout will charge, and saves nothing', async () => {
      const a = await piece('33.33', '20');
      const r = await rice();
      const body = {
        items: [
          item(a.id, U.PCS, '3', { discount: '1' }),
          item(r.id, U.G, '500'),
          item(r.id, U.KG, '1.5'),
        ],
        billDiscount: '2.5',
      };
      const salesBefore = await ctx.prisma.sale.count({
        where: { organizationId: shop.organizationId },
      });
      const movesBefore = await ctx.prisma.stockMovement.count({
        where: { organizationId: shop.organizationId },
      });

      const p = (await A.post('/sales/preview', body, null).expect(200)).body.data;
      expect(
        p.lines.map((l: { unitCode: string; unitPrice: string; net: string }) => [
          l.unitCode,
          l.unitPrice,
          l.net,
        ]),
      ).toHaveLength(3);
      expect(await ctx.prisma.sale.count({ where: { organizationId: shop.organizationId } })).toBe(
        salesBefore,
      );
      expect(
        await ctx.prisma.stockMovement.count({ where: { organizationId: shop.organizationId } }),
      ).toBe(movesBefore);

      const s1 = await sold({ ...body, payments: [cash(p.total)] });
      expect(p).toMatchObject({
        subtotal: s1.subtotal,
        discountTotal: s1.discountTotal,
        roundOff: s1.roundOff,
        total: s1.total,
      });
      expect(p.lines.map((l: { net: string }) => l.net)).toEqual(
        s1.items.map((i: { lineTotal: string }) => i.lineTotal),
      );
      expect(p.lines.map((l: { unitPrice: string }) => l.unitPrice)).toEqual(
        s1.items.map((i: { unitPrice: string }) => i.unitPrice),
      );
    });

    it('with payments it splits paid and credit as checkout would, and refuses an overpayment', async () => {
      const soap = await piece('100', '20');
      const c = await customer({ creditLimit: '250' });
      const base = { customerId: c.id, items: [item(soap.id, U.PCS, '3')] };
      const part = (
        await A.post('/sales/preview', { ...base, payments: [cash('100')] }, null).expect(200)
      ).body.data;
      expect(part).toMatchObject({ total: '300.00', paid: '100.00', credit: '200.00' });
      expect(part.warnings.creditLimit).toBeNull(); // 200 is within 250
      const over = (
        await A.post('/sales/preview', { ...base, payments: [cash('10')] }, null).expect(200)
      ).body.data;
      expect(over.warnings.creditLimit).toMatchObject({
        creditLimit: '250.00',
        balance: '0.00',
        available: '250.00',
      });
      expect(
        errCode(
          await A.post('/sales/preview', { ...base, payments: [cash('301')] }, null).expect(422),
        ),
      ).toBe('PAYMENT_EXCEEDS_TOTAL');
      const none = (await A.post('/sales/preview', base, null).expect(200)).body.data;
      expect(none).toMatchObject({ paid: '0.00', credit: '300.00' });
    });

    it('warns about stock before the customer pays, without refusing', async () => {
      const p = await piece('10', '3');
      const res = (
        await A.post(
          '/sales/preview',
          { items: [item(p.id, U.PCS, '2'), item(p.id, U.PCS, '2')] },
          null,
        ).expect(200)
      ).body.data;
      expect(res.warnings.stock).toEqual([
        { productId: p.id, requestedBaseQuantity: '4.000', availableBaseQuantity: '3.000' },
      ]);
      expect(res.total).toBe('40.00');
    });

    it('applies the same permission rules as checkout', async () => {
      const p = await piece('100', '20');
      const cashier = api(await hire(shop, 'Cashier'), shop.branchId);
      const over = await cashier
        .post('/sales/preview', { items: [item(p.id, U.PCS, '1', { discount: '6' })] }, null)
        .expect(403);
      expect(errCode(over)).toBe('DISCOUNT_LIMIT_EXCEEDED');
      await cashier
        .post('/sales/preview', { items: [item(p.id, U.PCS, '1', { unitPrice: '80' })] }, null)
        .expect(403);
      await cashier
        .post('/sales/preview', { items: [item(p.id, U.PCS, '1', { discount: '5' })] }, null)
        .expect(200);
      const agent = api(await hire(shop, 'Collection Agent'), shop.branchId);
      await agent.post('/sales/preview', { items: [item(p.id, U.PCS, '1')] }, null).expect(403);
      await api(shop.token)
        .post('/sales/preview', { items: [item(p.id, U.PCS, '1')] }, null)
        .expect(400); // needs the branch
    });
  });

  // ---------- F. held bills ----------
  describe('held bills', () => {
    it('park, list, change and discard a cart without touching stock; checkout closes it', async () => {
      const p = await piece('10', '5');
      const cart = { items: [{ productId: p.id, unitId: U.PCS, quantity: '2' }] };
      const h = (await A.post('/held-bills', { label: 'Table 2', payload: cart }, null).expect(201))
        .body.data;
      expect(
        (await A.get('/held-bills').expect(200)).body.data.map((x: { id: string }) => x.id),
      ).toContain(h.id);
      await A.put(`/held-bills/${h.id}`, {
        label: 'Table 2 (more)',
        payload: { ...cart, note: 'add sugar' },
      }).expect(200);
      expect((await stockOf(p.id)).quantityOnHand).toBe('5.000');

      await sold({ items: [item(p.id, U.PCS, '2')], payments: [cash('20')], heldBillId: h.id });
      await A.get(`/held-bills/${h.id}`).expect(404);

      const h2 = (await A.post('/held-bills', { payload: cart }, null).expect(201)).body.data;
      await A.delete(`/held-bills/${h2.id}`).expect(204);
      await A.get(`/held-bills/${h2.id}`).expect(404);
      expect(
        errCode(
          await A.post('/held-bills', { payload: { big: 'x'.repeat(70_000) } }, null).expect(400),
        ),
      ).toBe('HELD_BILL_TOO_LARGE');
    });
  });

  // ---------- G. cancellation ----------
  describe('cancellation', () => {
    it('reverses everything: stock back to its batch at its cost, payments refunded, credit removed', async () => {
      const milk = await product({
        name: `Milk ${++n}`,
        type: 'COUNT',
        baseUnitId: U.PCS,
        trackExpiry: true,
        prices: [{ unitId: U.PCS, price: '30' }],
      });
      await opening(milk.id, U.PCS, '10', '20', { batchNumber: 'M1', expiryDate: addDays(10) });
      const c = await customer();
      const s = await sold({
        customerId: c.id,
        items: [item(milk.id, U.PCS, '4')],
        payments: [cash('50')],
      }); // 120: 50 paid, 70 credit
      expect(await balanceOf(c.id)).toBe('70.00');

      const res = await A.post(`/sales/${s.id}/cancel`, { reason: 'customer changed mind' }).expect(
        200,
      );
      expect(res.body.data).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'customer changed mind',
        refundedTotal: '50.00',
      });
      const stock = await stockOf(milk.id);
      expect(stock.quantityOnHand).toBe('10.000');
      expect(
        stock.batches.map((b: { batchNumber: string; quantity: string }) => [
          b.batchNumber,
          b.quantity,
        ]),
      ).toEqual([['M1', '10.000']]);
      expect(stock.averageCost).toBe('20.0000');
      expect(await balanceOf(c.id)).toBe('0.00');

      const payments = await ctx.prisma.payment.findMany({
        where: {
          OR: [{ salePayments: { some: { saleId: s.id } } }, { notes: { contains: s.saleNumber } }],
        },
      });
      expect(
        payments.map((p) => [p.direction, p.purpose, p.status, p.amount.toFixed(2)]).sort(),
      ).toEqual([
        ['IN', 'SALE', 'REVERSED', '50.00'],
        ['OUT', 'REFUND', 'COMPLETED', '50.00'],
      ]);
      expect(
        errCode(await A.post(`/sales/${s.id}/cancel`, { reason: 'again please' }).expect(409)),
      ).toBe('SALE_ALREADY_CANCELLED');
      expect(
        errCode(
          await A.post('/sale-returns', {
            saleId: s.id,
            reason: 'late',
            refundTo: 'CASH',
            items: [{ saleItemId: s.items[0].id, quantity: '1', disposition: 'SALEABLE' }],
          }).expect(409),
        ),
      ).toBe('SALE_CANCELLED');
      await booksAgree();
    });

    it('cashiers cannot cancel; managers can today; an earlier day needs the owner', async () => {
      const p = await piece('10', '20');
      const cashier = api(await hire(shop, 'Cashier'), shop.branchId);
      const manager = api(await hire(shop, 'Manager'), shop.branchId);
      const today = await sold({ items: [item(p.id, U.PCS, '1')], payments: [cash('10')] });
      await cashier.post(`/sales/${today.id}/cancel`, { reason: 'wrong item' }).expect(403);
      await manager.post(`/sales/${today.id}/cancel`, { reason: 'wrong item' }).expect(200);

      const old = await sold({ items: [item(p.id, U.PCS, '1')], payments: [cash('10')] });
      await ctx.prisma.sale.update({
        where: { id: old.id },
        data: { soldAt: new Date(Date.now() - 3 * 86_400_000) },
      });
      expect(
        errCode(
          await manager.post(`/sales/${old.id}/cancel`, { reason: 'found later' }).expect(403),
        ),
      ).toBe('SALE_CANCEL_WINDOW_CLOSED');
      await A.post(`/sales/${old.id}/cancel`, { reason: 'found later' }).expect(200);
      await booksAgree();
    });

    it('a bill with returns cannot be cancelled', async () => {
      const p = await piece('10', '20');
      const s = await sold({ items: [item(p.id, U.PCS, '2')], payments: [cash('20')] });
      await A.post('/sale-returns', {
        saleId: s.id,
        reason: 'one broken',
        refundTo: 'CASH',
        items: [{ saleItemId: s.items[0].id, quantity: '1', disposition: 'DAMAGED' }],
      }).expect(201);
      expect(
        errCode(await A.post(`/sales/${s.id}/cancel`, { reason: 'all of it' }).expect(409)),
      ).toBe('SALE_HAS_RETURNS');
    });
  });

  // ---------- H. returns ----------
  describe('returns', () => {
    it('refunds from the original bill exactly; partial returns add up to the bill total (with round-off)', async () => {
      const p = await piece('33.33', '20');
      // 3 x 33.33 = 99.99, rounded bill 100.00 (round-off +0.01)
      const s = await sold({ items: [item(p.id, U.PCS, '3')], payments: [cash('100')] });
      expect(s).toMatchObject({ subtotal: '99.99', roundOff: '0.01', total: '100.00' });
      const ret = (qty: string, disposition = 'SALEABLE') =>
        A.post('/sale-returns', {
          saleId: s.id,
          reason: 'not needed',
          refundTo: 'CASH',
          items: [{ saleItemId: s.items[0].id, quantity: qty, disposition }],
        });

      const one = (await ret('1').expect(201)).body.data;
      expect(one.returnNumber).toMatch(/^SR\/\d{4}-\d{2}\/\d{6}$/);
      expect(one).toMatchObject({ total: '33.33', roundOff: '0.00' });
      expect((await stockOf(p.id)).quantityOnHand).toBe('18.000'); // 20 - 3 + 1

      const rest = (await ret('2', 'DAMAGED').expect(201)).body.data;
      expect(rest).toMatchObject({ total: '66.67', roundOff: '0.01' }); // 66.66 + the bill's round-off
      expect((await stockOf(p.id)).quantityOnHand).toBe('18.000'); // damaged goods do not go back on sale
      expect(await sale(s.id)).toMatchObject({ returnedTotal: '100.00', refundedTotal: '100.00' });
      expect(errCode(await ret('1').expect(422))).toBe('RETURN_EXCEEDS_SOLD');
      await booksAgree();
    });

    it('a credit bill is refunded to the customer account, never as cash that was not paid', async () => {
      const p = await piece('100', '20');
      const c = await customer();
      const s = await sold({
        customerId: c.id,
        items: [item(p.id, U.PCS, '2')],
        payments: [cash('50')],
      }); // 200: 50 paid, 150 credit
      const ret = (refundTo: string, qty = '1') =>
        A.post('/sale-returns', {
          saleId: s.id,
          reason: 'not needed',
          refundTo,
          items: [{ saleItemId: s.items[0].id, quantity: qty, disposition: 'SALEABLE' }],
        });
      const cashTooMuch = await ret('CASH').expect(422);
      expect(errCode(cashTooMuch)).toBe('REFUND_EXCEEDS_PAID');
      expect(cashTooMuch.body.error.details).toMatchObject({
        refundable: '50.00',
        refund: '100.00',
      });

      await ret('CUSTOMER_ACCOUNT').expect(201);
      expect(await balanceOf(c.id)).toBe('50.00');
      expect((await stockOf(p.id)).quantityOnHand).toBe('19.000');
      await booksAgree();
    });

    it('a walk-in bill cannot be refunded to an account; goods go back into the batch they came from', async () => {
      const milk = await product({
        name: `Milk ${++n}`,
        type: 'COUNT',
        baseUnitId: U.PCS,
        trackExpiry: true,
        prices: [{ unitId: U.PCS, price: '30' }],
      });
      await opening(milk.id, U.PCS, '5', '20', { batchNumber: 'R1', expiryDate: addDays(15) });
      const s = await sold({ items: [item(milk.id, U.PCS, '2')], payments: [cash('60')] });
      const body = (refundTo: string) => ({
        saleId: s.id,
        reason: 'not needed',
        refundTo,
        items: [{ saleItemId: s.items[0].id, quantity: '1', disposition: 'SALEABLE' }],
      });
      expect(errCode(await A.post('/sale-returns', body('CUSTOMER_ACCOUNT')).expect(422))).toBe(
        'REFUND_NEEDS_CUSTOMER',
      );
      const r = (await A.post('/sale-returns', body('UPI')).expect(201)).body.data;
      const batch = (await stockOf(milk.id)).batches[0];
      expect(batch).toMatchObject({ batchNumber: 'R1', quantity: '4.000' });
      expect(r.items[0].batchId).toBe(batch.id);
      await booksAgree();
    });

    it('cashiers cannot process returns; a retried return is applied once', async () => {
      const p = await piece('10', '20');
      const s = await sold({ items: [item(p.id, U.PCS, '2')], payments: [cash('20')] });
      const cashier = api(await hire(shop, 'Cashier'), shop.branchId);
      const body = {
        saleId: s.id,
        reason: 'not needed',
        refundTo: 'CASH',
        items: [{ saleItemId: s.items[0].id, quantity: '1', disposition: 'SALEABLE' }],
      };
      await cashier.post('/sale-returns', body).expect(403);
      const key = randomUUID();
      await A.post('/sale-returns', body, key).expect(201);
      const again = await A.post('/sale-returns', body, key).expect(201);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect((await sale(s.id)).items[0].returnedBaseQuantity).toBe('1.000');
    });
  });

  // ---------- I. customers ----------
  describe('customers', () => {
    it('one live customer per mobile number; edits are versioned; search works', async () => {
      const phone = uniquePhone();
      const c = (
        await api(shop.token)
          .post('/customers', { name: 'Lakshmi', phone: `+91 ${phone}`, creditLimit: '2000' }, null)
          .expect(201)
      ).body.data;
      expect(c).toMatchObject({ phone, creditLimit: '2000.00', balance: '0.00', version: 1 });
      expect(
        errCode(
          await api(shop.token)
            .post('/customers', { name: 'Someone else', phone }, null)
            .expect(409),
        ),
      ).toBe('CUSTOMER_PHONE_IN_USE');
      const edited = (
        await api(shop.token)
          .patch(`/customers/${c.id}`, { creditLimit: null, version: 1 })
          .expect(200)
      ).body.data;
      expect(edited).toMatchObject({ creditLimit: null, version: 2 });
      expect(
        errCode(
          await api(shop.token)
            .patch(`/customers/${c.id}`, { name: 'Stale', version: 1 })
            .expect(409),
        ),
      ).toBe('VERSION_CONFLICT');
      expect(
        (
          await api(shop.token)
            .get(`/customers?q=${phone.slice(0, 6)}`)
            .expect(200)
        ).body.data.map((x: { id: string }) => x.id),
      ).toContain(c.id);
    });
  });

  // ---------- J. access, isolation, GST ----------
  describe('access and isolation', () => {
    it("another shop can never see, cancel or return this shop's bills, or use its customers and products", async () => {
      const p = await piece('10', '20');
      const c = await customer();
      const s = await sold({
        customerId: c.id,
        items: [item(p.id, U.PCS, '1')],
        payments: [cash('10')],
      });
      const other = await newShop();
      const O = api(other.token, other.branchId);
      await O.get(`/sales/${s.id}`).expect(404);
      await O.post(`/sales/${s.id}/cancel`, { reason: 'not yours to cancel' }).expect(404);
      await O.post('/sale-returns', {
        saleId: s.id,
        reason: 'not mine',
        refundTo: 'CASH',
        items: [{ saleItemId: s.items[0].id, quantity: '1', disposition: 'SALEABLE' }],
      }).expect(404);
      await api(other.token).get(`/customers/${c.id}`).expect(404);
      await O.post('/sales', {
        customerId: c.id,
        items: [item(p.id, U.PCS, '1')],
        payments: [],
      }).expect(404);
      expect((await O.get('/sales').expect(200)).body.meta.total).toBe(0);
      expect((await O.get('/sales/reconciliation').expect(200)).body.data.consistent).toBe(true);
      expect((await sale(s.id)).status).toBe('COMPLETED');
    });

    it('bills belong to a branch: another branch of the same shop does not see them', async () => {
      const p = await piece('10', '20');
      const s = await sold({ items: [item(p.id, U.PCS, '1')], payments: [cash('10')] });
      const second = (
        await api(shop.token)
          .post('/branches', { code: `S${++n}`, name: 'Second counter' }, null)
          .expect(201)
      ).body.data;
      const B = api(shop.token, second.id);
      await B.get(`/sales/${s.id}`).expect(404);
      await B.post(`/sales/${s.id}/cancel`, { reason: 'wrong branch' }).expect(404);
      expect(errCode(await api(shop.token).get('/sales').expect(400))).toBe('BRANCH_REQUIRED');
    });

    it('a GST-registered shop is told GST billing is not ready yet instead of getting wrong tax', async () => {
      const g = await newShop();
      await ctx.prisma.organization.update({
        where: { id: g.organizationId },
        data: { gstEnabled: true },
      });
      const units = (await api(g.token).get('/units').expect(200)).body.data as {
        id: string;
        code: string;
      }[];
      const pcs = units.find((u) => u.code === 'PCS')!.id;
      const p = await product(
        {
          name: 'GST item',
          type: 'COUNT',
          baseUnitId: pcs,
          prices: [{ unitId: pcs, price: '10' }],
        },
        g,
      );
      const res = await api(g.token, g.branchId)
        .post('/sales', { items: [item(p.id, pcs, '1')], payments: [cash('10')] })
        .expect(422);
      expect(errCode(res)).toBe('GST_BILLING_NOT_READY');
    });
  });

  // ---------- K. history ----------
  describe('immutability and audit', () => {
    it('bills, returns, payments and khata cannot be edited or deleted behind the application', async () => {
      const p = await piece('10', '20');
      const c = await customer();
      const s = await sold({
        customerId: c.id,
        items: [item(p.id, U.PCS, '2')],
        payments: [cash('5')],
      });
      const r = (
        await A.post('/sale-returns', {
          saleId: s.id,
          reason: 'broken',
          refundTo: 'CUSTOMER_ACCOUNT',
          items: [{ saleItemId: s.items[0].id, quantity: '1', disposition: 'DAMAGED' }],
        }).expect(201)
      ).body.data;
      const attempt = (sql: string) => ctx.prisma.$executeRawUnsafe(sql);
      await expect(attempt(`DELETE FROM sales WHERE id = '${s.id}'`)).rejects.toThrow();
      await expect(attempt(`DELETE FROM sale_items WHERE sale_id = '${s.id}'`)).rejects.toThrow();
      await expect(
        attempt(`DELETE FROM sale_payments WHERE sale_id = '${s.id}'`),
      ).rejects.toThrow();
      await expect(attempt(`DELETE FROM sale_returns WHERE id = '${r.id}'`)).rejects.toThrow();
      await expect(
        attempt(`DELETE FROM sale_return_items WHERE return_id = '${r.id}'`),
      ).rejects.toThrow();
      await expect(attempt(`DELETE FROM customers WHERE id = '${c.id}'`)).rejects.toThrow();
      await expect(
        attempt(`UPDATE customer_ledger_entries SET amount = 1 WHERE customer_id = '${c.id}'`),
      ).rejects.toThrow(/append-only/);
      await expect(
        attempt(`UPDATE sales SET returned_total = total + 1 WHERE id = '${s.id}'`),
      ).rejects.toThrow();
      await expect(
        attempt(`UPDATE sales SET refunded_total = paid_total + 1 WHERE id = '${s.id}'`),
      ).rejects.toThrow();
      await expect(
        attempt(
          `UPDATE sale_items SET returned_base_quantity = base_quantity + 1 WHERE sale_id = '${s.id}'`,
        ),
      ).rejects.toThrow();

      const actions = (
        await ctx.prisma.auditLog.findMany({
          where: { OR: [{ entityId: s.id }, { entityId: r.id }, { entityId: c.id }] },
        })
      ).map((a) => a.action);
      for (const expected of ['sale.create', 'sale_return.create', 'customer.create'])
        expect(actions).toContain(expected);
    });
  });
});
