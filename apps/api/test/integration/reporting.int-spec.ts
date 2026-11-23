import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { todayInIndia } from '../../src/common/utils/dates';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const B = '/api/v1';
const GSTIN_TS = '36AABCU9603R1ZM';

/**
 * Phase 13: every report must reconcile to its source rows. Each figure is checked two ways: against a total worked
 * out by hand from the bills created in the test, and against an independent SQL query over the raw tables.
 */
suite('Reports reconcile to the books (real database)', () => {
  jest.setTimeout(900_000);
  let db: TestSchema;
  let ctx: IntegrationApp;

  let T: Awaited<ReturnType<typeof tradingShop>>;
  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
    T = await tradingShop();
  });
  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  interface Shop {
    token: string;
    organizationId: string;
    branchId: string;
    pcs: string;
  }
  const api = (token: string, branchId?: string) => {
    const a = <T extends { set(k: string, v: string): T }>(r: T) => {
      r.set('Authorization', `Bearer ${token}`);
      if (branchId) r.set('x-branch-id', branchId);
      return r;
    };
    return {
      get: (p: string) => a(ctx.http().get(B + p)),
      post: (p: string, body: object = {}, key: string | null = randomUUID()) => {
        const r = a(ctx.http().post(B + p));
        if (key) r.set('idempotency-key', key);
        return r.send(body);
      },
      patch: (p: string, body: object) => a(ctx.http().patch(B + p)).send(body),
    };
  };
  const sql = async <T>(text: string): Promise<T[]> => ctx.prisma.$queryRawUnsafe<T[]>(text);
  const dec = (v: string | null | undefined) => new Decimal(v ?? 0);
  const today = todayInIndia();

  async function newShop(name: string, gst = true): Promise<Shop> {
    const phone = uniquePhone();
    const res = await ctx
      .http()
      .post(`${B}/auth/register-owner`)
      .send({ fullName: 'Owner', phone, password: PW, shopName: name, deviceUid: `d-${phone}` })
      .expect(201);
    const x = res.body.data;
    const token = x.accessToken as string;
    const branchId = x.branches[0].id as string;
    if (gst) {
      await ctx.prisma.organization.update({
        where: { id: x.organization.id },
        data: { gstEnabled: true },
      });
      await api(token)
        .patch(`/branches/${branchId}`, { gstin: GSTIN_TS, stateCode: '36' })
        .expect(200);
    }
    const units = (await api(token).get('/units').expect(200)).body.data as {
      id: string;
      code: string;
    }[];
    return {
      token,
      organizationId: x.organization.id as string,
      branchId,
      pcs: units.find((u) => u.code === 'PCS')!.id,
    };
  }

  async function hire(shop: Shop, roleName: string, extraKeys?: string[]): Promise<string> {
    const A = api(shop.token, shop.branchId);
    let roleId: string;
    if (extraKeys) {
      roleId = (
        await A.post('/roles', { name: roleName, permissionKeys: extraKeys }, null).expect(201)
      ).body.data.id;
    } else {
      const roles = (await A.get('/roles').expect(200)).body.data as { id: string; name: string }[];
      roleId = roles.find((r) => r.name === roleName)!.id;
    }
    const phone = uniquePhone();
    const inv = await A.post(
      '/invitations',
      { phone, roleId, branchIds: [shop.branchId] },
      null,
    ).expect(201);
    const accepted = await ctx
      .http()
      .post(`${B}/auth/accept-invitation`)
      .send({ code: inv.body.data.code, fullName: roleName, password: PW, deviceUid: `d-${phone}` })
      .expect(201);
    return accepted.body.data.accessToken as string;
  }

  /** A shop with real trading: GST and non-GST goods, credit, split payments, returns, a cancellation, a purchase. */
  async function tradingShop() {
    const shop = await newShop('Reports Shop');
    const A = api(shop.token, shop.branchId);
    const product = async (name: string, taxable: boolean, price: string, cost: string) => {
      const p = (
        await api(shop.token)
          .post(
            '/products',
            {
              name,
              type: 'COUNT',
              baseUnitId: shop.pcs,
              ...(taxable ? { isTaxable: true, gstRatePercent: '18', hsnCode: '3401' } : {}),
              prices: [{ unitId: shop.pcs, price }],
            },
            null,
          )
          .expect(201)
      ).body.data as { id: string };
      await A.post('/inventory/opening-stock', {
        productId: p.id,
        unitId: shop.pcs,
        quantity: '100',
        unitCost: cost,
      }).expect(201);
      return p.id;
    };
    const G = await product('Soap', true, '118', '50'); // taxable: 100 before GST + 18 GST
    const E = await product('Salt', false, '50', '20'); // no GST
    const line = (id: string, q: string) => ({ productId: id, unitId: shop.pcs, quantity: q });
    const sell = async (body: object) => (await A.post('/sales', body).expect(201)).body.data;

    const customer = (
      await A.post('/customers', { name: 'Laxmi', phone: uniquePhone() }, null).expect(201)
    ).body.data.id as string;

    const sale1 = await sell({
      items: [line(G, '2'), line(E, '1')],
      payments: [{ method: 'CASH', amount: '286.00' }],
    }); // 2x118 + 50 = 286
    await sell({ customerId: customer, items: [line(G, '1')], payments: [] }); // 118 on credit
    const sale3 = await sell({
      items: [line(G, '1'), line(E, '2')],
      payments: [
        { method: 'CASH', amount: '100.00' },
        { method: 'UPI', amount: '118.00' },
      ],
    }); // 118 + 100 = 218
    const sale4 = await sell({
      items: [line(G, '1')],
      payments: [{ method: 'CASH', amount: '118.00' }],
    });
    await A.post(`/sales/${sale4.id}/cancel`, { reason: 'Customer changed mind' }).expect(200);

    // Return one soap (goes back on the shelf) and one salt (damaged: a real loss).
    await A.post('/sale-returns', {
      saleId: sale1.id,
      reason: 'Wrong soap',
      refundTo: 'CASH',
      items: [
        {
          saleItemId: sale1.items.find((i: { productId: string }) => i.productId === G).id,
          quantity: '1',
          disposition: 'SALEABLE',
        },
      ],
    }).expect(201);
    await A.post('/sale-returns', {
      saleId: sale3.id,
      reason: 'Spoiled',
      refundTo: 'CASH',
      items: [
        {
          saleItemId: sale3.items.find((i: { productId: string }) => i.productId === E).id,
          quantity: '1',
          disposition: 'DAMAGED',
        },
      ],
    }).expect(201);

    // Expenses and a stock write-off.
    const cat = (await A.post('/expense-categories', { name: 'Shop upkeep' }, null).expect(201))
      .body.data.id;
    await A.post('/cashbook/entries', {
      kind: 'CASH_IN',
      amount: '1000.00',
      description: 'Float',
    }).expect(201);
    await A.post('/expenses', { categoryId: cat, amount: '30.00', method: 'CASH' }).expect(201);
    await A.post('/expenses', { categoryId: cat, amount: '99.00', method: 'CASH' }).then(
      async (r) => {
        await A.post(`/expenses/${r.body.data.id}/cancel`, { reason: 'Typo' }).expect(200);
      },
    );
    await A.post('/inventory/adjustments', {
      productId: E,
      unitId: shop.pcs,
      quantity: '-1',
      reason: 'DAMAGE',
      notes: 'wet',
    }).expect(201);

    // A purchase (received), part paid, and a khata collection (one kept, one reversed).
    const supplier = (await A.post('/suppliers', { name: 'Ramesh Traders' }, null).expect(201)).body
      .data.id;
    await A.post('/purchases', {
      supplierId: supplier,
      items: [{ productId: E, unitId: shop.pcs, quantity: '10', unitCost: '20' }],
      receiveNow: true,
    }).expect(201);
    await A.post(`/suppliers/${supplier}/payments`, { amount: '50.00', method: 'CASH' }).expect(
      201,
    );
    const agent = (
      await A.post('/collection-agents', { name: 'Ravi', phone: uniquePhone() }, null).expect(201)
    ).body.data.id;
    await A.post('/collections', {
      customerId: customer,
      agentId: agent,
      amount: '40.00',
      method: 'CASH',
    }).expect(201);
    const c2 = await A.post('/collections', {
      customerId: customer,
      agentId: agent,
      amount: '10.00',
      method: 'CASH',
    }).expect(201);
    await A.post(`/collections/${c2.body.data.paymentId}/reverse`, {
      reason: 'Entered twice',
    }).expect(200);

    return { shop, A, G, E, customer, supplier };
  }

  it('sales reports add up: the summary, the breakdowns and the raw tables agree, to the paisa', async () => {
    const { shop, A } = T;
    const org = shop.organizationId;

    const res = await A.get(`/reports/sales/summary?from=${today}&to=${today}`).expect(200);
    const t = res.body.data.totals;

    // By hand: three bills stand (the fourth was cancelled): 286 + 118 + 218 = 622.
    expect(t.bills).toBe(3);
    expect(t.billValue).toBe('622.00');
    expect(t.creditGiven).toBe('118.00');
    // Before GST: soap 100 each x 4 = 400, salt 50 x 3 = 150 -> 550. Two returns: soap 100 + salt 50 -> 400.
    expect(t.taxableValue).toBe('550.00');
    expect(t.gst).toBe('72.00'); // 4 soaps x 18
    expect(t.returnsCount).toBe(2);
    expect(t.returnedBeforeGst).toBe('150.00');
    expect(t.netSales).toBe('400.00');

    // The same, straight from the tables.
    const raw = await sql<{ n: number; total: string; taxable: string }>(
      `SELECT count(*)::int AS n, sum(total)::text AS total, sum(taxable_total)::text AS taxable
       FROM sales WHERE organization_id = '${org}' AND status = 'COMPLETED'`,
    );
    expect(raw[0]!.n).toBe(t.bills);
    expect(dec(raw[0]!.total).toFixed(2)).toBe(t.billValue);
    const items = await sql<{ net: string }>(
      `SELECT sum(si.taxable_value)::text AS net FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.organization_id = '${org}' AND s.status = 'COMPLETED'`,
    );
    expect(dec(items[0]!.net).toFixed(2)).toBe(t.taxableValue);
    const rets = await sql<{ net: string }>(
      `SELECT COALESCE(sum(ri.line_total - ri.tax_amount), 0)::text AS net FROM sale_return_items ri
       JOIN sale_returns r ON r.id = ri.return_id WHERE r.organization_id = '${org}'`,
    );
    expect(dec(rets[0]!.net).toFixed(2)).toBe(t.returnedBeforeGst);

    // The series adds up to the totals, for every way of grouping.
    for (const groupBy of ['day', 'week', 'month']) {
      const g = (
        await A.get(`/reports/sales/summary?from=${today}&to=${today}&groupBy=${groupBy}`).expect(
          200,
        )
      ).body.data;
      const sum = (k: string) =>
        g.series
          .reduce((acc: Decimal, s: Record<string, string>) => acc.plus(s[k]!), new Decimal(0))
          .toFixed(2);
      expect(sum('billValue')).toBe(g.totals.billValue);
      expect(sum('netSales')).toBe(g.totals.netSales);
    }

    // Product and category breakdowns net to the same revenue, and the items add up to their own totals.
    for (const by of ['product', 'category']) {
      const b = (
        await A.get(`/reports/sales/breakdown?by=${by}&from=${today}&to=${today}`).expect(200)
      ).body;
      expect(b.meta.totals.netSales).toBe(t.netSales);
      const added = b.data.reduce(
        (acc: Decimal, r: { netSales: string }) => acc.plus(r.netSales),
        new Decimal(0),
      );
      expect(added.toFixed(2)).toBe(b.meta.totals.netSales);
      const cost = b.data.reduce(
        (acc: Decimal, r: { costOfGoods: string }) => acc.plus(r.costOfGoods),
        new Decimal(0),
      );
      expect(cost.toFixed(2)).toBe(b.meta.totals.costOfGoods);
    }

    // Payment modes plus credit equal what was billed.
    const pm = (
      await A.get(`/reports/sales/breakdown?by=payment_method&from=${today}&to=${today}`).expect(
        200,
      )
    ).body;
    const byMethod = Object.fromEntries(
      pm.data.map((r: { method: string; amount: string }) => [r.method, r.amount]),
    );
    expect(byMethod).toEqual({ CASH: '386.00', UPI: '118.00', CREDIT: '118.00' }); // 286 + 100 cash
    expect(pm.meta.totals.billValue).toBe(t.billValue);

    // Customers and cashiers each add up to the bill value.
    for (const by of ['customer', 'cashier']) {
      const b = (
        await A.get(`/reports/sales/breakdown?by=${by}&from=${today}&to=${today}`).expect(200)
      ).body;
      const added = b.data.reduce(
        (acc: Decimal, r: { billValue: string }) => acc.plus(r.billValue),
        new Decimal(0),
      );
      expect(added.toFixed(2)).toBe(t.billValue);
    }
  });

  it('profit is worked out from the cost saved on each bill, and keeps revenue, profit and cash apart', async () => {
    const { shop, A } = T;
    const p = (await A.get(`/reports/finance/profit?from=${today}&to=${today}`).expect(200)).body
      .data;

    // Cost by hand: soaps 4 x 50 = 200 less 1 soap back on the shelf = 150; salt 3 x 20 = 60 (the damaged one stays lost).
    expect(p.revenue).toBe('400.00');
    expect(p.costOfGoodsSold).toBe('210.00');
    expect(p.grossProfit).toBe('190.00');
    expect(p.grossMarginPercent).toBe('47.50');
    expect(p.expenses.total).toBe('30.00'); // the cancelled 99 is not counted
    expect(p.expenses.byCategory).toEqual([
      expect.objectContaining({ name: 'Shop upkeep', total: '30.00' }),
    ]);
    expect(p.stockWrittenOff).toBe('20.00'); // one salt at cost 20
    expect(p.netProfit).toBe('140.00'); // 190 - 30 - 20
    expect(p.isEstimate).toBe(true);

    // The cost is the sum of the cost saved on the bill lines.
    const cogs = await sql<{ c: string }>(
      `SELECT sum(round(si.unit_cost_snapshot * si.base_quantity, 2))::text AS c
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.organization_id = '${shop.organizationId}' AND s.status = 'COMPLETED'`,
    );
    expect(dec(cogs[0]!.c).toFixed(2)).toBe('260.00'); // before the soap that came back (50)

    // Cash flow is a different number: it is money that moved, not profit.
    const cf = (await A.get(`/reports/finance/cash-flow?from=${today}&to=${today}`).expect(200))
      .body.data;
    const book = await sql<{ net: string }>(
      `SELECT sum(amount)::text AS net FROM cashbook_entries WHERE organization_id = '${shop.organizationId}'`,
    );
    expect(cf.totals.net).toBe(dec(book[0]!.net).toFixed(2));
    const methodsNet = cf.byMethod.reduce(
      (a: Decimal, m: { net: string }) => a.plus(m.net),
      new Decimal(0),
    );
    const kindsNet = cf.byKind.reduce(
      (a: Decimal, m: { net: string }) => a.plus(m.net),
      new Decimal(0),
    );
    const daysNet = cf.daily.reduce(
      (a: Decimal, m: { net: string }) => a.plus(m.net),
      new Decimal(0),
    );
    expect(methodsNet.toFixed(2)).toBe(cf.totals.net);
    expect(kindsNet.toFixed(2)).toBe(cf.totals.net);
    expect(daysNet.toFixed(2)).toBe(cf.totals.net);
    expect(cf.totals.net).not.toBe(p.netProfit);
  });

  it('purchases, stock, dues, collections and the day book reconcile to their sources', async () => {
    const { shop, A, customer, supplier } = T;

    const pur = (await A.get(`/reports/purchases/summary?from=${today}&to=${today}`).expect(200))
      .body.data;
    expect(pur.totals).toMatchObject({
      orders: 1,
      billed: '200.00',
      returned: '0.00',
      net: '200.00',
    });
    const bySupplier = (
      await A.get(`/reports/purchases/breakdown?from=${today}&to=${today}`).expect(200)
    ).body;
    expect(bySupplier.data[0]).toMatchObject({
      name: 'Ramesh Traders',
      net: '200.00',
      owedNow: '150.00',
    });

    // Stock value equals the stock screen's own valuation.
    const inv = (await A.get('/reports/inventory/summary').expect(200)).body.data;
    const valuation = (await A.get('/inventory/valuation').expect(200)).body.data;
    expect(inv.stockValue).toBe(valuation.totalValue);
    const worth = await sql<{ v: string }>(
      `SELECT round(sum(GREATEST(quantity_on_hand, 0) * average_cost), 2)::text AS v FROM inventory_balances
       WHERE organization_id = '${shop.organizationId}'`,
    );
    expect(inv.stockValue).toBe(dec(worth[0]!.v).toFixed(2));

    // Fast and slow movers: soap and salt both sold.
    const fast = (await A.get('/reports/inventory/movers?kind=fast&days=7').expect(200)).body.data;
    expect(fast.items.map((i: { name: string }) => i.name).sort()).toEqual(['Salt', 'Soap']);
    const slow = (await A.get('/reports/inventory/movers?kind=slow&days=7').expect(200)).body.data;
    expect(slow.items.length).toBe(2);

    // Dues add up to the customer and supplier balances.
    const cust = (await A.get('/reports/finance/outstanding?party=customers').expect(200)).body;
    const supp = (await A.get('/reports/finance/outstanding?party=suppliers').expect(200)).body;
    expect(cust.data).toEqual([expect.objectContaining({ id: customer, due: '78.00' })]); // 118 credit - 40 collected
    expect(cust.meta.summary.customers.totalDue).toBe('78.00');
    expect(supp.data).toEqual([expect.objectContaining({ id: supplier, payable: '150.00' })]); // 200 - 50 paid
    const balances = await sql<{ c: string; s: string }>(
      `SELECT (SELECT sum(balance) FROM customers WHERE organization_id = '${shop.organizationId}' AND balance > 0)::text AS c,
              (SELECT sum(balance) FROM suppliers WHERE organization_id = '${shop.organizationId}' AND balance > 0)::text AS s`,
    );
    expect(dec(balances[0]!.c).toFixed(2)).toBe(cust.meta.summary.customers.totalDue);
    expect(dec(balances[0]!.s).toFixed(2)).toBe(supp.meta.summary.suppliers.totalPayable);

    // Collections leave out the reversed receipt.
    const col = (await A.get(`/reports/finance/collections?from=${today}&to=${today}`).expect(200))
      .body;
    expect(col.meta.totals).toMatchObject({ receipts: 1, collected: '40.00' });
    expect(col.data).toEqual([expect.objectContaining({ name: 'Ravi', collected: '40.00' })]);
    expect(col.meta.daily).toEqual([{ date: today, receipts: 1, collected: '40.00' }]);

    // The day book lists what happened: the cancelled bill, the reversed collection and the cancelled expense are out.
    const day = (await A.get(`/reports/finance/day-book?date=${today}`).expect(200)).body;
    const kinds = Object.fromEntries(
      Object.entries(day.meta.totals as Record<string, { count: number; amount: string }>).map(
        ([k, v]) => [k, v.count],
      ),
    );
    expect(kinds).toEqual({
      SALE: 3,
      SALE_RETURN: 2,
      PURCHASE: 1,
      COLLECTION: 1,
      SUPPLIER_PAYMENT: 1,
      EXPENSE: 1,
    });
    expect(day.meta.totals.SALE.amount).toBe('622.00');
    expect(day.meta.total).toBe(9);
    expect(day.data).toHaveLength(9);
    const times = day.data.map((r: { at: string }) => r.at);
    expect([...times].sort()).toEqual(times);
  });

  it('the home screen shows the same numbers as the reports, and hides what a role may not see', async () => {
    const { shop, A } = T;
    const home = (await A.get('/reports/dashboard').expect(200)).body.data;
    const sales = (await A.get(`/reports/sales/summary?from=${today}&to=${today}`).expect(200)).body
      .data.totals;
    const profit = (await A.get(`/reports/finance/profit?from=${today}&to=${today}`).expect(200))
      .body.data;
    const stock = (await A.get('/reports/inventory/summary').expect(200)).body.data;

    expect(home.sales).toMatchObject({
      bills: sales.bills,
      billValue: sales.billValue,
      netSales: sales.netSales,
    });
    expect(home.profit.today).toEqual({
      grossProfit: profit.grossProfit,
      netProfit: profit.netProfit,
    });
    expect(home.profit.isEstimate).toBe(true);
    expect(home.stock.stockValue).toBe(stock.stockValue);
    expect(home.owed).toMatchObject({ customerDue: '78.00', supplierPayable: '150.00' });

    // A role with only the financial report sees cash and dues, but no sales, stock or profit.
    const limited = api(await hire(shop, 'Money Viewer', ['report.financial']), shop.branchId);
    const part = (await limited.get('/reports/dashboard').expect(200)).body.data;
    expect(part.sales).toBeNull();
    expect(part.stock).toBeNull();
    expect(part.profit).toBeNull();
    expect(part.owed.customerDue).toBe('78.00');
    await limited.get('/reports/sales/summary').expect(403);
    await limited.get('/reports/finance/profit').expect(403);
    await limited.get('/reports/inventory/summary').expect(403);

    // Someone who may see sales but not profit gets no cost or profit in the product breakdown.
    const salesOnly = api(await hire(shop, 'Sales Viewer', ['report.sales']), shop.branchId);
    const rows = (
      await salesOnly
        .get(`/reports/sales/breakdown?by=product&from=${today}&to=${today}`)
        .expect(200)
    ).body;
    expect(rows.data[0]).not.toHaveProperty('grossProfit');
    expect(rows.data[0]).not.toHaveProperty('costOfGoods');
    expect(rows.meta.totals).not.toHaveProperty('grossProfit');
  });

  it('every report is closed to cashiers and to other shops, and bad requests are clear 400s', async () => {
    const { shop, A } = T;
    const other = await newShop('Other Reports Shop');
    const O = api(other.token, other.branchId);
    const cashier = api(await hire(shop, 'Cashier'), shop.branchId);

    const paths = [
      '/reports/dashboard',
      '/reports/sales/summary',
      '/reports/sales/breakdown?by=product',
      '/reports/purchases/summary',
      '/reports/purchases/breakdown',
      '/reports/inventory/summary',
      '/reports/inventory/movers?kind=fast',
      '/reports/finance/profit',
      '/reports/finance/cash-flow',
      '/reports/finance/outstanding?party=customers',
      '/reports/finance/collections',
      '/reports/finance/day-book',
    ];
    for (const p of paths) {
      expect([p, (await cashier.get(p)).status]).toEqual([p, 403]);
      expect([p, (await ctx.http().get(B + p)).status]).toEqual([p, 401]);
    }

    // Another shop sees none of this shop's money.
    const theirs = (await O.get(`/reports/sales/summary?from=${today}&to=${today}`).expect(200))
      .body.data;
    expect(theirs.totals).toMatchObject({ bills: 0, billValue: '0.00', netSales: '0.00' });
    const theirProfit = (
      await O.get(`/reports/finance/profit?from=${today}&to=${today}`).expect(200)
    ).body.data;
    expect(theirProfit).toMatchObject({ revenue: '0.00', netProfit: '0.00' });
    expect(
      (await O.get('/reports/finance/outstanding?party=customers').expect(200)).body.data,
    ).toEqual([]);
    expect(
      (await O.get('/reports/finance/outstanding?party=suppliers').expect(200)).body.data,
    ).toEqual([]);
    expect(
      (await O.get('/reports/finance/collections').expect(200)).body.meta.totals.collected,
    ).toBe('0.00');
    expect(
      (await O.get(`/reports/finance/day-book?date=${today}`).expect(200)).body.meta.total,
    ).toBe(0);
    expect((await O.get('/reports/inventory/summary').expect(200)).body.data.stockValue).toBe(
      '0.00',
    );

    const emptyPage = async (path: string) =>
      (await O.get(path).expect(200)).body.data as unknown[];
    expect(
      await emptyPage(`/reports/sales/breakdown?by=product&from=${today}&to=${today}`),
    ).toEqual([]);
    expect(
      await emptyPage(`/reports/sales/breakdown?by=customer&from=${today}&to=${today}`),
    ).toEqual([]);
    expect(await emptyPage(`/reports/purchases/breakdown?from=${today}&to=${today}`)).toEqual([]);
    expect(
      (await O.get(`/reports/purchases/summary?from=${today}&to=${today}`).expect(200)).body.data
        .totals,
    ).toMatchObject({ orders: 0, net: '0.00' });
    expect(
      (await O.get(`/reports/finance/cash-flow?from=${today}&to=${today}`).expect(200)).body.data
        .totals.net,
    ).toBe('0.00');
    expect(
      (await O.get('/reports/inventory/movers?kind=fast&days=30').expect(200)).body.data.items,
    ).toEqual([]);
    const theirHome = (await O.get('/reports/dashboard').expect(200)).body.data;
    expect(theirHome.sales).toMatchObject({ bills: 0, billValue: '0.00' });
    expect(theirHome.owed).toMatchObject({ customerDue: '0.00', supplierPayable: '0.00' });
    expect(theirHome.cashToday.net).toBe('0.00');

    // A second branch of the same shop is separate from the first.
    const branch2 = (await A.post('/branches', { name: 'Branch 2', code: 'B2' }, null).expect(201))
      .body.data.id;
    const second = api(shop.token, branch2);
    expect(
      (await second.get(`/reports/sales/summary?from=${today}&to=${today}`).expect(200)).body.data
        .totals.bills,
    ).toBe(0);
    expect(
      (await second.get(`/reports/finance/cash-flow?from=${today}&to=${today}`).expect(200)).body
        .data.totals.net,
    ).toBe('0.00');

    // A branch is required; nobody can ask about a branch they are not in.
    await api(shop.token).get('/reports/sales/summary').expect(400);
    await api(shop.token, randomUUID()).get('/reports/sales/summary').expect(403);

    // Bad requests answer 400, never a server error.
    const bad = [
      '/reports/sales/summary?from=2026-13-45',
      '/reports/sales/summary?to=2026-02-31',
      '/reports/sales/summary?from=2026-11-05&to=2026-11-01',
      '/reports/sales/summary?from=2024-01-01&to=2026-11-01',
      '/reports/sales/summary?groupBy=year',
      '/reports/sales/breakdown?by=colour',
      '/reports/sales/breakdown',
      '/reports/finance/profit?from=abc',
      '/reports/finance/day-book?date=2026-02-31',
      '/reports/finance/outstanding?party=nobody',
      '/reports/inventory/movers?kind=medium',
      '/reports/inventory/movers?kind=fast&days=0',
    ];
    for (const p of bad) {
      const r = await A.get(p);
      expect([p, r.status]).toEqual([p, 400]);
    }
  });

  it('a cancelled bill vanishes from every figure, and returns count on the day they are made', async () => {
    const shop = await newShop('Cancel Report Shop', false);
    const A = api(shop.token, shop.branchId);
    const p = (
      await api(shop.token)
        .post(
          '/products',
          {
            name: 'Tea',
            type: 'COUNT',
            baseUnitId: shop.pcs,
            prices: [{ unitId: shop.pcs, price: '40' }],
          },
          null,
        )
        .expect(201)
    ).body.data.id as string;
    await A.post('/inventory/opening-stock', {
      productId: p,
      unitId: shop.pcs,
      quantity: '10',
      unitCost: '25',
    }).expect(201);
    const sale = (
      await A.post('/sales', {
        items: [{ productId: p, unitId: shop.pcs, quantity: '2' }],
        payments: [{ method: 'CASH', amount: '80.00' }],
      }).expect(201)
    ).body.data;
    const before = (await A.get(`/reports/finance/profit?from=${today}&to=${today}`).expect(200))
      .body.data;
    expect(before).toMatchObject({
      revenue: '80.00',
      costOfGoodsSold: '50.00',
      grossProfit: '30.00',
    });

    await A.post(`/sales/${sale.id}/cancel`, { reason: 'Customer changed mind' }).expect(200);
    const after = (await A.get(`/reports/finance/profit?from=${today}&to=${today}`).expect(200))
      .body.data;
    expect(after).toMatchObject({
      revenue: '0.00',
      costOfGoodsSold: '0.00',
      grossProfit: '0.00',
      netProfit: '0.00',
    });
    const s = (await A.get(`/reports/sales/summary?from=${today}&to=${today}`).expect(200)).body
      .data.totals;
    expect(s).toMatchObject({
      bills: 0,
      billValue: '0.00',
      netSales: '0.00',
      returnsValue: '0.00',
    });
    const day = (await A.get(`/reports/finance/day-book?date=${today}`).expect(200)).body;
    expect(day.meta.totals.SALE).toBeUndefined();
  });

  it('audit probes: counter collections, reversed payments, purchase returns, discontinued stock and net-zero products', async () => {
    const shop = await newShop('Audit Probe Shop', false);
    const A = api(shop.token, shop.branchId);
    const product = async (name: string, price: string, cost: string, stock = '50') => {
      const id = (
        await api(shop.token)
          .post(
            '/products',
            { name, type: 'COUNT', baseUnitId: shop.pcs, prices: [{ unitId: shop.pcs, price }] },
            null,
          )
          .expect(201)
      ).body.data.id as string;
      await A.post('/inventory/opening-stock', {
        productId: id,
        unitId: shop.pcs,
        quantity: stock,
        unitCost: cost,
      }).expect(201);
      return id;
    };
    const line = (id: string, q: string) => ({ productId: id, unitId: shop.pcs, quantity: q });
    const rice = await product('Rice', '100', '60');
    const dal = await product('Dal', '80', '50');
    const old = await product('Old line', '10', '5', '10');
    await ctx.prisma.product.update({ where: { id: old }, data: { status: 'DISCONTINUED' } });

    // Two customers on credit.
    const mk = async (name: string) =>
      (await A.post('/customers', { name, phone: uniquePhone() }, null).expect(201)).body.data
        .id as string;
    const counter = await mk('Counter Payer');
    const reversed = await mk('Reversed Payer');
    for (const c of [counter, reversed]) {
      await A.post('/sales', { customerId: c, items: [line(rice, '1')], payments: [] }).expect(201); // 100 on credit
    }
    // F1: a khata payment taken at the counter (no agent); F2: a payment that is reversed.
    await A.post('/collections', { customerId: counter, amount: '30.00', method: 'CASH' }).expect(
      201,
    );
    const agent = (
      await A.post('/collection-agents', { name: 'Ravi', phone: uniquePhone() }, null).expect(201)
    ).body.data.id;
    const rev = await A.post('/collections', {
      customerId: reversed,
      agentId: agent,
      amount: '20.00',
      method: 'CASH',
    }).expect(201);
    await A.post(`/collections/${rev.body.data.paymentId}/reverse`, {
      reason: 'Entered twice',
    }).expect(200);

    const col = (await A.get(`/reports/finance/collections?from=${today}&to=${today}`).expect(200))
      .body;
    expect(col.meta.totals).toMatchObject({ receipts: 1, collected: '30.00' });
    expect(col.data).toEqual([
      expect.objectContaining({ agentId: null, name: 'Shop counter', collected: '30.00' }),
    ]);
    expect(col.meta.daily).toEqual([{ date: today, receipts: 1, collected: '30.00' }]);
    const cf = (await A.get(`/reports/finance/cash-flow?from=${today}&to=${today}`).expect(200))
      .body.data;
    const kind = (k: string) => cf.byKind.find((x: { kind: string }) => x.kind === k);
    // 30 at the counter and 20 by the agent came in as khata payments; the reversal of the 20 is its own line.
    expect(kind('CUSTOMER_COLLECTION').moneyIn).toBe('50.00');
    expect(kind('REVERSAL').moneyOut).toBe('20.00');
    expect(dec(cf.totals.net).toFixed(2)).toBe('30.00');
    const day = (await A.get(`/reports/finance/day-book?date=${today}`).expect(200)).body;
    expect(day.meta.totals.COLLECTION).toEqual({ count: 1, amount: '30.00' });

    // F2: "last paid" counts only payments that still stand.
    const dues = (await A.get('/reports/finance/outstanding?party=customers').expect(200)).body
      .data as {
      id: string;
      lastPaymentAt: string | null;
    }[];
    expect(dues.find((d) => d.id === reversed)!.lastPaymentAt).toBeNull();
    expect(dues.find((d) => d.id === counter)!.lastPaymentAt).not.toBeNull();

    // F3: sending goods back to a supplier is in the day book.
    const sup = (await A.post('/suppliers', { name: 'Gupta Wholesale' }, null).expect(201)).body
      .data.id;
    const buy = (
      await A.post('/purchases', {
        supplierId: sup,
        items: [{ productId: dal, unitId: shop.pcs, quantity: '10', unitCost: '50' }],
        receiveNow: true,
      }).expect(201)
    ).body.data;
    await A.post('/purchase-returns', {
      purchaseId: buy.id,
      reason: 'damaged',
      items: [{ purchaseItemId: buy.items[0].id, quantity: '2' }],
    }).expect(201);
    const day2 = (await A.get(`/reports/finance/day-book?date=${today}`).expect(200)).body;
    expect(day2.meta.totals.PURCHASE_RETURN).toEqual({ count: 1, amount: '100.00' });

    // F5: stock on a discontinued product still counts as stock, like the stock screen's valuation.
    const inv = (await A.get('/reports/inventory/summary').expect(200)).body.data;
    const valuation = (await A.get('/inventory/valuation').expect(200)).body.data;
    expect(inv.productsInStock).toBe(valuation.productsInStock);
    expect(inv.stockValue).toBe(valuation.totalValue);

    // F8: a product sold and fully returned in the period is not listed with zeros.
    const sold = (
      await A.post('/sales', {
        items: [line(dal, '1')],
        payments: [{ method: 'CASH', amount: '80.00' }],
      }).expect(201)
    ).body.data;
    await A.post('/sale-returns', {
      saleId: sold.id,
      reason: 'changed mind',
      refundTo: 'CASH',
      items: [{ saleItemId: sold.items[0].id, quantity: '1', disposition: 'SALEABLE' }],
    }).expect(201);
    const prod = (
      await A.get(`/reports/sales/breakdown?by=product&from=${today}&to=${today}`).expect(200)
    ).body;
    expect(prod.data.map((r: { name: string }) => r.name)).toEqual(['Rice']);
    expect(prod.meta.total).toBe(1);
  });
});
