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

const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';

const addDays = (days: number) => {
  const t = new Date(`${todayInIndia()}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

/**
 * Phase 12 audit probes. Each test states a rule the cash book and the daily closing must obey and checks it on a
 * real database; they were written to fail first against the code as delivered.
 */
suite('Finance audit probes (real database)', () => {
  jest.setTimeout(900_000);
  let db: TestSchema;
  let ctx: IntegrationApp;

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
  });
  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  interface Shop {
    token: string;
    organizationId: string;
    branchId: string;
  }
  const api = (shop: Shop) => {
    const a = <T extends { set(k: string, v: string): T }>(r: T) => {
      r.set('Authorization', `Bearer ${shop.token}`);
      r.set('x-branch-id', shop.branchId);
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
    };
  };

  async function setupShop(name: string): Promise<Shop> {
    const phone = uniquePhone();
    const reg = await ctx
      .http()
      .post('/api/v1/auth/register-owner')
      .send({ fullName: 'Owner', phone, password: PW, shopName: name, deviceUid: `d-${phone}` })
      .expect(201);
    const x = reg.body.data;
    return {
      token: x.accessToken as string,
      organizationId: x.organization.id as string,
      branchId: x.branches[0].id as string,
    };
  }

  /** A product with stock, so the shop can make a real cash sale. */
  async function productWithStock(shop: Shop) {
    const a = api(shop);
    const units = await a.get('/units').expect(200);
    const unit = (units.body.data as { id: string; code: string }[]).find((u) => u.code === 'PCS')!;
    const prod = await a
      .post(
        '/products',
        {
          name: `Item-${randomUUID().slice(0, 6)}`,
          type: 'COUNT',
          baseUnitId: unit.id,
          prices: [{ unitId: unit.id, price: '100.00' }],
        },
        null,
      )
      .expect(201);
    await a
      .post('/inventory/opening-stock', {
        productId: prod.body.data.id,
        unitId: unit.id,
        quantity: '50',
        unitCost: '10.00',
      })
      .expect(201);
    return { productId: prod.body.data.id as string, unitId: unit.id };
  }

  const cashSale = (shop: Shop, p: { productId: string; unitId: string }) =>
    api(shop).post('/sales', {
      items: [{ productId: p.productId, unitId: p.unitId, quantity: '1', unitPrice: '100.00' }],
      payments: [{ method: 'CASH', amount: '100.00' }],
    });

  it('closing the day does not stop the shop trading: late sales and collections carry on into the next business day', async () => {
    const shop = await setupShop('Late Sales Shop');
    const a = api(shop);
    const p = await productWithStock(shop);

    await a.post('/closings', { actualCash: '0.00' }).expect(201); // evening close of today

    // The shop is still open at 9 pm: a cash sale must still be possible.
    const late = await cashSale(shop, p);
    expect(late.status).toBe(201);

    // It is booked to the NEXT business day, so today's closed figures never change.
    const book = await a.get(`/cashbook?from=${todayInIndia()}&to=${addDays(1)}`).expect(200);
    const sale = (book.body.data as { kind: string; businessDate: string }[]).find(
      (e) => e.kind === 'SALE_RECEIPT',
    );
    expect(sale?.businessDate).toBe(addDays(1));

    // A person who names today on purpose is still refused: that would rewrite a closed day.
    await a
      .post('/cashbook/entries', {
        kind: 'CASH_OUT',
        amount: '5.00',
        description: 'Backdated into a closed day',
        businessDate: todayInIndia(),
      })
      .expect(409);

    const recon = await a.get('/finance/reconciliation').expect(200);
    expect(recon.body.data.consistent).toBe(true);
  });

  it('a day that was never closed still counts: the next closing carries its cash forward', async () => {
    const shop = await setupShop('Missed Day Shop');
    const a = api(shop);

    await a
      .post('/cashbook/entries', {
        kind: 'CASH_IN',
        amount: '1000.00',
        description: 'Float',
        businessDate: addDays(-3),
      })
      .expect(201);
    await a.post('/closings', { businessDate: addDays(-3), actualCash: '1000.00' }).expect(201);

    // Two days later nobody closed; 500 came in on the missed day.
    await a
      .post('/cashbook/entries', {
        kind: 'CASH_IN',
        amount: '500.00',
        description: 'Missed day takings',
        businessDate: addDays(-2),
      })
      .expect(201);

    const preview = await a.get(`/closings/preview?businessDate=${addDays(-1)}`).expect(200);
    expect(preview.body.data.openingCash).toBe('1500.00'); // 1000 counted + 500 of the missed day
    expect(preview.body.data.expectedCash).toBe('1500.00');

    const close = await a
      .post('/closings', { businessDate: addDays(-1), actualCash: '1500.00' })
      .expect(201);
    expect(close.body.data.difference).toBe('0.00'); // not a false +500 surplus

    expect((await a.get('/finance/reconciliation').expect(200)).body.data.consistent).toBe(true);
  });

  it('days must be closed in order: an older day cannot be closed after a newer one', async () => {
    const shop = await setupShop('Order Shop');
    const a = api(shop);
    await a.post('/closings', { businessDate: addDays(-1), actualCash: '0.00' }).expect(201);
    await a.post('/closings', { businessDate: addDays(-2), actualCash: '0.00' }).expect(409);
  });

  it('impossible dates in a filter are a clear 400, never a server error', async () => {
    const shop = await setupShop('Bad Date Shop');
    const a = api(shop);
    for (const path of [
      '/expenses?from=2026-13-45',
      '/expenses?to=2026-02-31',
      '/cashbook?from=2026-13-45',
      '/cashbook?to=2026-02-31',
      '/closings?from=2026-13-45',
      '/closings?to=2026-02-31',
    ]) {
      const res = await a.get(path);
      expect([path, res.status]).toEqual([path, 400]);
    }
  });

  it('an expense from a closed day can still be cancelled: the reversal is booked today and the closed day is untouched', async () => {
    const shop = await setupShop('Cancel Old Expense Shop');
    const a = api(shop);
    const cat = await a.post('/expense-categories', { name: 'Repairs' }, null).expect(201);
    await a
      .post('/cashbook/entries', {
        kind: 'CASH_IN',
        amount: '500.00',
        description: 'Float',
        businessDate: addDays(-2),
      })
      .expect(201);
    const exp = await a
      .post('/expenses', {
        categoryId: cat.body.data.id,
        amount: '120.00',
        method: 'CASH',
        expenseDate: addDays(-2),
      })
      .expect(201);
    const closed = await a
      .post('/closings', { businessDate: addDays(-2), actualCash: '380.00' })
      .expect(201);
    expect(closed.body.data.expectedCash).toBe('380.00');

    await a.post(`/expenses/${exp.body.data.id}/cancel`, { reason: 'Entered twice' }).expect(200);

    const book = await a.get('/cashbook').expect(200);
    const reversal = (book.body.data as { kind: string; businessDate: string }[]).find(
      (e) => e.kind === 'REVERSAL',
    );
    expect(reversal?.businessDate).toBe(todayInIndia());

    const history = await a.get('/closings').expect(200);
    expect(history.body.data[0].expectedCash).toBe('380.00'); // unchanged
    expect((await a.get('/finance/reconciliation').expect(200)).body.data.consistent).toBe(true);
  });

  it('the database itself protects a closed day: the closing cannot be edited or deleted, and no cash line can be added to it', async () => {
    const shop = await setupShop('DB Guard Shop');
    const a = api(shop);
    const day = addDays(-1);
    await a
      .post('/cashbook/entries', {
        kind: 'CASH_IN',
        amount: '100.00',
        description: 'Float',
        businessDate: day,
      })
      .expect(201);
    const closed = await a
      .post('/closings', { businessDate: day, actualCash: '100.00' })
      .expect(201);
    const id = closed.body.data.id as string;

    const attempt = (sql: string) => ctx.prisma.$executeRawUnsafe(sql);
    await expect(
      attempt(`UPDATE daily_closings SET actual_cash = 999 WHERE id = '${id}'`),
    ).rejects.toThrow();
    await expect(attempt(`DELETE FROM daily_closings WHERE id = '${id}'`)).rejects.toThrow();
    await expect(
      attempt(
        `INSERT INTO cashbook_entries (id, organization_id, branch_id, register_id, kind, method, amount,
           reference_type, reference_id, description, business_date, occurred_at, created_by_id)
         SELECT gen_random_uuid(), organization_id, branch_id, register_id, 'CASH_IN', 'CASH', 50,
           'MANUAL_ADJUSTMENT', gen_random_uuid(), 'sneaky', business_date, now(), created_by_id
         FROM cashbook_entries WHERE business_date = '${day}' LIMIT 1`,
      ),
    ).rejects.toThrow();

    const rows = await ctx.prisma.$queryRawUnsafe<{ actual_cash: string }[]>(
      `SELECT actual_cash::text FROM daily_closings WHERE id = '${id}'`,
    );
    expect(rows[0]!.actual_cash).toBe('100.00');
  });

  it('a close racing with cash entries never loses one: expected cash always equals the cash book', async () => {
    const shop = await setupShop('Race Shop');
    const a = api(shop);
    const today = todayInIndia();
    await a
      .post('/cashbook/entries', {
        kind: 'CASH_IN',
        amount: '10.00',
        description: 'Seed',
        businessDate: today,
      })
      .expect(201);

    const adds = Array.from({ length: 8 }, (_, i) =>
      a.post('/cashbook/entries', {
        kind: 'CASH_IN',
        amount: '1.00',
        description: `Racer ${i}`,
        businessDate: today,
      }),
    );
    const [closeRes] = await Promise.all([a.post('/closings', { actualCash: '0.00' }), ...adds]);
    expect(closeRes.status).toBe(201);

    const cash = await ctx.prisma.$queryRawUnsafe<{ net: string }[]>(
      `SELECT COALESCE(SUM(amount), 0)::text AS net FROM cashbook_entries
       WHERE organization_id = '${shop.organizationId}' AND business_date = '${today}' AND method = 'CASH'`,
    );
    expect(closeRes.body.data.expectedCash).toBe(Number(cash[0]!.net).toFixed(2));
    expect((await a.get('/finance/reconciliation').expect(200)).body.data.consistent).toBe(true);
  });
});
