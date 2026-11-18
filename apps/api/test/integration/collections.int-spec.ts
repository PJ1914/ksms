import { randomUUID } from 'node:crypto';
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
const RECEIPT = /^RV\/\d{4}-\d{2}\/\d{6}$/;

suite('Khata and collections (real database)', () => {
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
      post: (p: string, body?: object, key?: string) => {
        const r = a(ctx.http().post(b + p));
        if (key) r.set('idempotency-key', key);
        return body ? r.send(body) : r;
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

  async function seedCustomerWithDebt(shop: Shop, name: string, debt: string) {
    const c = await api(shop.token, shop.branchId)
      .post('/customers', { name, phone: uniquePhone() })
      .expect(201);
    const customerId = c.body.data.id as string;

    // Seed an opening debt via a unit + product + credit sale so ledger & balance are genuine.
    const unitsRes = await api(shop.token, shop.branchId).get('/units').expect(200);
    const unit = (unitsRes.body.data as { id: string; code: string }[]).find(
      (u) => u.code === 'PCS',
    )!;
    const prod = await api(shop.token, shop.branchId)
      .post('/products', {
        name: `Item-${randomUUID().slice(0, 6)}`,
        type: 'COUNT',
        baseUnitId: unit.id,
        prices: [{ unitId: unit.id, price: debt }],
      })
      .expect(201);
    const productId = prod.body.data.id as string;

    await api(shop.token, shop.branchId)
      .post(
        '/inventory/opening-stock',
        {
          productId,
          unitId: unit.id,
          quantity: '10',
          unitCost: '10.00',
        },
        randomUUID(),
      )
      .expect(201);

    await api(shop.token, shop.branchId)
      .post(
        '/sales',
        {
          customerId,
          items: [{ productId, unitId: unit.id, quantity: '1', unitPrice: debt }],
          payments: [],
        },
        randomUUID(),
      )
      .expect(201);

    return customerId;
  }

  async function createStaffUser(
    shop: Shop,
    roleName: 'Collection Agent' | 'Cashier',
  ): Promise<{ userId: string; token: string }> {
    const rolesRes = await api(shop.token, shop.branchId).get('/roles').expect(200);
    const role = (rolesRes.body.data as { id: string; name: string }[]).find(
      (r) => r.name === roleName,
    )!;
    const phone = uniquePhone();
    const inv = await api(shop.token, shop.branchId)
      .post('/invitations', {
        phone,
        roleId: role.id,
        branchIds: [shop.branchId],
      })
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

  it('records partial and advance customer payments with numbered receipts, ledger, cashbook, and idempotency', async () => {
    const shop = await setupShop('Khata Shop 1');
    const a = api(shop.token, shop.branchId);
    const customerId = await seedCustomerWithDebt(shop, 'Suresh', '500.00');

    const key = randomUUID();
    const p1 = await a
      .post(
        `/customers/${customerId}/payments`,
        { amount: '200.00', method: 'CASH', referenceNo: 'CASH-1' },
        key,
      )
      .expect(201);

    expect(p1.body.data.receiptNumber).toMatch(RECEIPT);
    expect(p1.body.data.balanceAfter).toBe('300.00');

    // Idempotent retry returns the exact same receipt without double-posting.
    const p1Retry = await a
      .post(
        `/customers/${customerId}/payments`,
        { amount: '200.00', method: 'CASH', referenceNo: 'CASH-1' },
        key,
      )
      .expect(201);
    expect(p1Retry.body.data.paymentId).toBe(p1.body.data.paymentId);
    expect(p1Retry.body.data.receiptNumber).toBe(p1.body.data.receiptNumber);

    // Overpayment takes balance into advance (-100.00).
    const p2 = await a
      .post(
        `/customers/${customerId}/payments`,
        { amount: '400.00', method: 'UPI', referenceNo: 'UPI-99' },
        randomUUID(),
      )
      .expect(201);
    expect(p2.body.data.balanceAfter).toBe('-100.00');

    const cust = await a.get(`/customers/${customerId}`).expect(200);
    expect(cust.body.data.balance).toBe('-100.00');

    const ledger = await a.get(`/customers/${customerId}/ledger`).expect(200);
    expect(ledger.body.data).toHaveLength(3); // 1 credit sale + 2 payments

    const recon = await a.get('/collections/reconciliation').expect(200);
    expect(recon.body.data.consistent).toBe(true);
  });

  it('handles 5 concurrent collections with gap-free receipt numbers and exact final balance', async () => {
    const shop = await setupShop('Khata Concurrent');
    const a = api(shop.token, shop.branchId);
    const customerId = await seedCustomerWithDebt(shop, 'Ramesh', '1000.00');

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        a
          .post(
            `/customers/${customerId}/payments`,
            { amount: '100.00', method: 'CASH', notes: `Part ${i + 1}` },
            randomUUID(),
          )
          .expect(201),
      ),
    );

    const receipts = new Set(
      results.map((r: { body: { data: { receiptNumber: string } } }) => r.body.data.receiptNumber),
    );
    expect(receipts.size).toBe(5);

    const cust = await a.get(`/customers/${customerId}`).expect(200);
    expect(cust.body.data.balance).toBe('500.00');

    const recon = await a.get('/collections/reconciliation').expect(200);
    expect(recon.body.data.consistent).toBe(true);
  });

  it('manages collection agents, customer assignments, auto-attribution, summary, and reversals', async () => {
    const shop = await setupShop('Agents Shop');
    const a = api(shop.token, shop.branchId);
    const customerId = await seedCustomerWithDebt(shop, 'Kiran', '800.00');
    const collector = await createStaffUser(shop, 'Collection Agent');

    const agent1 = await a
      .post('/collection-agents', {
        name: 'Vikram Collector',
        phone: uniquePhone(),
        userId: collector.userId,
      })
      .expect(201);
    const agent1Id = agent1.body.data.id as string;

    const agent2 = await a
      .post('/collection-agents', { name: 'Backup Collector', phone: uniquePhone() })
      .expect(201);
    const agent2Id = agent2.body.data.id as string;

    // Assign to agent 1, then reassign to agent 2 (automatically ends agent 1's active assignment).
    const assign1 = await a
      .post(`/collection-agents/${agent1Id}/assignments`, {
        customerId,
        targetAmount: '800.00',
      })
      .expect(201);

    // Same agent duplicate active assignment is refused.
    await a.post(`/collection-agents/${agent1Id}/assignments`, { customerId }).expect(409);

    const assign2 = await a
      .post(`/collection-agents/${agent2Id}/assignments`, { customerId })
      .expect(201);

    const a1Detail = await a.get(`/collection-agents/${agent1Id}`).expect(200);
    expect(a1Detail.body.data.assignments).toHaveLength(0);

    // End agent 2's assignment, then re-assign back to agent 1.
    await a
      .post(`/collection-agents/${agent2Id}/assignments/${assign2.body.data.id}/end`)
      .expect(200);
    expect(assign1.body.data.status).toBe('ACTIVE');
    await a.post(`/collection-agents/${agent1Id}/assignments`, { customerId }).expect(201);

    // Logged-in Collection Agent records a collection without specifying agentId -> auto-attributed!
    const collectorApi = api(collector.token, shop.branchId);
    const c1 = await collectorApi
      .post(
        '/collections',
        { customerId, amount: '300.00', method: 'UPI', referenceNo: 'UPI-COL-1' },
        randomUUID(),
      )
      .expect(201);
    expect(c1.body.data.collectionRecord.agentId).toBe(agent1Id);

    // Second collection by same agent, then reverse it.
    const c2 = await collectorApi
      .post('/collections', { customerId, amount: '200.00', method: 'CASH' }, randomUUID())
      .expect(201);

    await a
      .post(
        `/collections/${c2.body.data.paymentId}/reverse`,
        { reason: 'Entered twice by mistake' },
        randomUUID(),
      )
      .expect(200);

    // Reversing again returns 409.
    await a
      .post(
        `/collections/${c2.body.data.paymentId}/reverse`,
        { reason: 'Duplicate reverse' },
        randomUUID(),
      )
      .expect(409);

    const summary = await a.get(`/collection-agents/${agent1Id}/summary`).expect(200);
    expect(summary.body.data.activeAssignments).toBe(1);
    expect(summary.body.data.assignedOutstanding).toBe('500.00');
    expect(summary.body.data.collectionCount).toBe(1);
    expect(summary.body.data.totalCollected).toBe('300.00');
    expect(summary.body.data.byMethod.UPI).toBe('300.00');
    expect(summary.body.data.byMethod.CASH).toBe('0.00');

    const recon = await a.get('/collections/reconciliation').expect(200);
    expect(recon.body.data.consistent).toBe(true);
  });

  it('enforces permissions, branch isolation, and cross-organization isolation', async () => {
    const shopA = await setupShop('Iso Shop A');
    const shopB = await setupShop('Iso Shop B');
    const aA = api(shopA.token, shopA.branchId);
    const aB = api(shopB.token, shopB.branchId);

    const customerA = await seedCustomerWithDebt(shopA, 'Customer A', '250.00');
    const agentA = await aA.post('/collection-agents', { name: 'Agent A' }).expect(201);

    const colA = await aA
      .post(
        `/customers/${customerA}/payments`,
        { amount: '100.00', method: 'CASH', agentId: agentA.body.data.id },
        randomUUID(),
      )
      .expect(201);

    // Cross-org isolation: Shop B cannot see or reverse Shop A's collection or agent.
    await aB.get(`/collections/${colA.body.data.paymentId}`).expect(404);
    await aB
      .post(
        `/collections/${colA.body.data.paymentId}/reverse`,
        { reason: 'Cross org attempt' },
        randomUUID(),
      )
      .expect(404);
    await aB.get(`/collection-agents/${agentA.body.data.id}`).expect(404);

    // Cross-branch isolation within Shop A.
    const branch2 = await aA.post('/branches', { name: 'Branch 2', code: 'BR2' }).expect(201);
    const aA2 = api(shopA.token, branch2.body.data.id);
    await aA2.get(`/collections/${colA.body.data.paymentId}`).expect(404);

    // Cashier cannot read/create/assign collections.
    const cashier = await createStaffUser(shopA, 'Cashier');
    const cashierApi = api(cashier.token, shopA.branchId);
    await cashierApi.get('/collections').expect(403);
    await cashierApi
      .post(`/customers/${customerA}/payments`, { amount: '50.00', method: 'CASH' }, randomUUID())
      .expect(403);
    await cashierApi.post('/collection-agents', { name: 'Nope' }).expect(403);
  });

  it('audit fixes: collectors cannot reverse or spoof agents, dates are validated, races are safe', async () => {
    const shop = await setupShop('Audit Shop');
    const a = api(shop.token, shop.branchId);
    const customerId = await seedCustomerWithDebt(shop, 'Meena', '1000.00');
    const collector = await createStaffUser(shop, 'Collection Agent');
    const collectorApi = api(collector.token, shop.branchId);

    const own = await a
      .post('/collection-agents', { name: 'Own Agent', userId: collector.userId })
      .expect(201);
    const other = await a.post('/collection-agents', { name: 'Other Agent' }).expect(201);

    // A collector can record under their own profile, but not under someone else's.
    await collectorApi
      .post(
        '/collections',
        { customerId, amount: '10.00', method: 'CASH', agentId: other.body.data.id },
        randomUUID(),
      )
      .expect(403);
    const mine = await collectorApi
      .post(
        '/collections',
        { customerId, amount: '10.00', method: 'CASH', agentId: own.body.data.id },
        randomUUID(),
      )
      .expect(201);
    expect(mine.body.data.collectionRecord.agentId).toBe(own.body.data.id);

    // A collector cannot undo a receipt (needs collection.assign); the owner can.
    await collectorApi
      .post(`/collections/${mine.body.data.paymentId}/reverse`, { reason: 'Hide it' }, randomUUID())
      .expect(403);

    // The collection time must be real, not in the future, not more than 7 days back.
    const day = 24 * 60 * 60 * 1000;
    const pay = (collectedAt: string) =>
      a.post(
        `/customers/${customerId}/payments`,
        { amount: '5.00', method: 'CASH', collectedAt },
        randomUUID(),
      );
    await pay(new Date(Date.now() + day).toISOString()).expect(422);
    await pay(new Date(Date.now() - 30 * day).toISOString()).expect(422);
    const ok = await pay(new Date(Date.now() - day).toISOString()).expect(201);
    expect(ok.body.data.receiptNumber).toMatch(RECEIPT);

    // An impossible start date is a clean 422, not a server error.
    await a
      .post(`/collection-agents/${own.body.data.id}/assignments`, {
        customerId,
        startDate: '2026-13-45',
      })
      .expect(422);

    // 3 simultaneous reversals of one receipt: exactly one wins, the others get 409 (never 500).
    const target = await a
      .post(`/customers/${customerId}/payments`, { amount: '50.00', method: 'CASH' }, randomUUID())
      .expect(201);
    const reversals = await Promise.all(
      Array.from({ length: 3 }, () =>
        a.post(
          `/collections/${target.body.data.paymentId}/reverse`,
          { reason: 'Wrong amount' },
          randomUUID(),
        ),
      ),
    );
    const statuses = reversals.map((r: { status: number }) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);

    // 3 agents assigned to one customer at the same moment: exactly ONE assignment stays active.
    const extra = await Promise.all(
      [1, 2, 3].map((i) => a.post('/collection-agents', { name: `Racer ${i}` }).expect(201)),
    );
    await Promise.all(
      extra.map((r: { body: { data: { id: string } } }) =>
        a.post(`/collection-agents/${r.body.data.id}/assignments`, { customerId }),
      ),
    );
    let active = 0;
    for (const r of [...extra, own, other] as { body: { data: { id: string } } }[]) {
      const d = await a.get(`/collection-agents/${r.body.data.id}`).expect(200);
      active += (d.body.data.assignments as unknown[]).length;
    }
    expect(active).toBe(1);

    const recon = await a.get('/collections/reconciliation').expect(200);
    expect(recon.body.data.consistent).toBe(true);
  });
});
