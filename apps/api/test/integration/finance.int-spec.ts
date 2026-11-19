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

suite('Finance: expenses, cashbook, daily closing (real database)', () => {
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
    userId: string;
    branchId: string;
  }
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
      patch: (p: string, body: object) => a(ctx.http().patch(b + p)).send(body),
    };
  };

  async function setupShop(name: string): Promise<Shop> {
    const phone = uniquePhone();
    const reg = await ctx
      .http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Owner',
        phone,
        password: PW,
        shopName: name,
        deviceUid: `device-${phone}`,
      })
      .expect(201);
    const x = reg.body.data;
    return {
      token: x.accessToken as string,
      organizationId: x.organization.id as string,
      userId: x.user.id as string,
      branchId: x.branches[0].id as string,
    };
  }

  async function createStaffUser(
    shop: Shop,
    roleName: 'Cashier' | 'Manager',
  ): Promise<{ userId: string; token: string }> {
    const rolesRes = await api(shop.token, shop.branchId).get('/roles').expect(200);
    const role = (rolesRes.body.data as { id: string; name: string }[]).find(
      (r) => r.name === roleName,
    )!;
    const phone = uniquePhone();
    const inv = await api(shop.token, shop.branchId)
      .post('/invitations', { phone, roleId: role.id, branchIds: [shop.branchId] }, null)
      .expect(201);
    const accept = await ctx
      .http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: inv.body.data.code,
        fullName: `${roleName} User`,
        password: PW,
        deviceUid: `device-${phone}`,
      })
      .expect(201);
    return {
      userId: accept.body.data.user.id as string,
      token: accept.body.data.accessToken as string,
    };
  }

  it('records expenses, idempotent retries, cancellations, and cashbook entries', async () => {
    const shop = await setupShop('Finance Shop 1');
    const a = api(shop.token, shop.branchId);

    const cat = await a.post('/expense-categories', { name: 'Courier' }, null).expect(201);
    const catId = cat.body.data.id as string;

    // Duplicate category name (case-insensitive) is refused.
    await a.post('/expense-categories', { name: 'courier' }, null).expect(409);

    const key = randomUUID();
    const exp1 = await a
      .post(
        '/expenses',
        { categoryId: catId, amount: '350.00', method: 'CASH', description: 'EB Bill' },
        key,
      )
      .expect(201);

    // Idempotent retry returns the same expense without double-posting to cashbook.
    const exp1Retry = await a
      .post(
        '/expenses',
        { categoryId: catId, amount: '350.00', method: 'CASH', description: 'EB Bill' },
        key,
      )
      .expect(201);
    expect(exp1Retry.body.data.id).toBe(exp1.body.data.id);

    // Record manual CASH_IN and cancel the expense.
    await a
      .post('/cashbook/entries', {
        kind: 'CASH_IN',
        amount: '1000.00',
        method: 'CASH',
        description: 'Drawer float',
      })
      .expect(201);

    await a
      .post(`/expenses/${exp1.body.data.id}/cancel`, { reason: 'Paid from personal account' })
      .expect(200);

    // Cancelling twice returns 409.
    await a
      .post(`/expenses/${exp1.body.data.id}/cancel`, { reason: 'Duplicate cancel' })
      .expect(409);

    const cb = await a.get('/cashbook').expect(200);
    expect(cb.body.meta.summary.totalIn).toBe('1350.00'); // 1000 float + 350 reversal
    expect(cb.body.meta.summary.totalOut).toBe('350.00');
    expect(cb.body.meta.summary.cashNet).toBe('1000.00');

    const recon = await a.get('/finance/reconciliation').expect(200);
    expect(recon.body.data.consistent).toBe(true);
  });

  it('computes opening carryover, daily closing math, concurrent close safety, and blocks closed days', async () => {
    const shop = await setupShop('Closing Shop');
    const a = api(shop.token, shop.branchId);
    const yesterday = addDays(-1);
    const today = todayInIndia();

    const cat = await a.post('/expense-categories', { name: 'Tea' }, null).expect(201);

    // Yesterday: +500 float, -50 tea -> expected 450, actual 440 (short 10).
    await a
      .post('/cashbook/entries', {
        kind: 'CASH_IN',
        amount: '500.00',
        method: 'CASH',
        description: 'Yesterday float',
        businessDate: yesterday,
      })
      .expect(201);
    await a
      .post('/expenses', {
        categoryId: cat.body.data.id,
        amount: '50.00',
        method: 'CASH',
        description: 'Staff tea',
        expenseDate: yesterday,
      })
      .expect(201);

    const yPreview = await a.get(`/closings/preview?businessDate=${yesterday}`).expect(200);
    expect(yPreview.body.data.openingCash).toBe('0.00');
    expect(yPreview.body.data.expectedCash).toBe('450.00');

    const yClose = await a
      .post('/closings', { businessDate: yesterday, actualCash: '440.00', notes: 'Short 10' })
      .expect(201);
    expect(yClose.body.data.difference).toBe('-10.00');
    expect(yClose.body.data.status).toBe('CLOSED');

    // Today: opening cash carries over from yesterday's actualCash (440.00).
    await a
      .post('/cashbook/entries', {
        kind: 'CASH_IN',
        amount: '200.00',
        method: 'CASH',
        description: 'Morning cash in',
        businessDate: today,
      })
      .expect(201);

    const tPreview = await a.get(`/closings/preview?businessDate=${today}`).expect(200);
    expect(tPreview.body.data.openingCash).toBe('440.00');
    expect(tPreview.body.data.netCashMovements).toBe('200.00');
    expect(tPreview.body.data.expectedCash).toBe('640.00');

    // 3 simultaneous close requests for today: 1 wins (201), 2 get 409 DAY_ALREADY_CLOSED.
    const closes = await Promise.all(
      Array.from({ length: 3 }, () =>
        a.post('/closings', { businessDate: today, actualCash: '645.00' }),
      ),
    );
    expect(closes.map((r: { status: number }) => r.status).sort()).toEqual([201, 409, 409]);

    // Closed day refuses further cashbook adjustments or expenses on that date.
    await a
      .post('/cashbook/entries', {
        kind: 'CASH_OUT',
        amount: '25.00',
        method: 'CASH',
        description: 'Too late',
        businessDate: today,
      })
      .expect(409);

    const recon = await a.get('/finance/reconciliation').expect(200);
    expect(recon.body.data.consistent).toBe(true);
  });

  it('enforces permissions, branch isolation, and cross-organization isolation', async () => {
    const shopA = await setupShop('Fin Iso A');
    const shopB = await setupShop('Fin Iso B');
    const aA = api(shopA.token, shopA.branchId);
    const aB = api(shopB.token, shopB.branchId);

    const catA = await aA
      .post('/expense-categories', { name: `Custom-${randomUUID().slice(0, 6)}` }, null)
      .expect(201);
    const expA = await aA
      .post('/expenses', { categoryId: catA.body.data.id, amount: '5000.00', method: 'UPI' })
      .expect(201);

    // Cross-org isolation.
    await aB.patch(`/expense-categories/${catA.body.data.id}`, { name: 'Hacked' }).expect(404);
    await aB.post(`/expenses/${expA.body.data.id}/cancel`, { reason: 'Cross org' }).expect(404);

    // Cross-branch isolation.
    const branch2 = await aA.post('/branches', { name: 'Branch 2', code: 'B2' }, null).expect(201);
    const aA2 = api(shopA.token, branch2.body.data.id);
    await aA2.post(`/expenses/${expA.body.data.id}/cancel`, { reason: 'Wrong branch' }).expect(404);

    // Cashier cannot access finance endpoints.
    const cashier = await createStaffUser(shopA, 'Cashier');
    const cashierApi = api(cashier.token, shopA.branchId);
    await cashierApi.get('/expenses').expect(403);
    await cashierApi.get('/cashbook').expect(403);
    await cashierApi.get('/closings/preview').expect(403);
    await cashierApi.post('/closings', { actualCash: '0.00' }).expect(403);
  });
});
