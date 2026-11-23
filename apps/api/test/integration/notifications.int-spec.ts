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
const B = '/api/v1';

interface Shop {
  token: string;
  organizationId: string;
  branchId: string;
  pcs: string;
}

/**
 * Phase 15: in-app notifications, low-stock & expiring-batch alert generation with deduplication,
 * read/read-all flows, RBAC, and strict cross-tenant isolation.
 */
suite('Notifications & branch alerts (real database)', () => {
  jest.setTimeout(300_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let shopA: Shop;
  let shopB: Shop;

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
    shopA = await newShop('Notif Shop A');
    shopB = await newShop('Notif Shop B');
  });

  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  const api = (token: string, branchId?: string) => {
    const auth = <T extends { set(k: string, v: string): T }>(r: T) => {
      r.set('Authorization', `Bearer ${token}`);
      if (branchId) r.set('x-branch-id', branchId);
      return r;
    };
    return {
      get: (p: string) => auth(ctx.http().get(B + p)),
      post: (p: string, body: object = {}, key?: string) => {
        const r = auth(ctx.http().post(B + p));
        if (key) r.set('idempotency-key', key);
        return r.send(body);
      },
    };
  };

  async function newShop(name: string): Promise<Shop> {
    const phone = uniquePhone();
    const res = await ctx
      .http()
      .post(`${B}/auth/register-owner`)
      .send({ fullName: 'Owner', phone, password: PW, shopName: name, deviceUid: `d-${phone}` })
      .expect(201);
    const x = res.body.data;
    const token = x.accessToken as string;
    const branchId = x.branches[0].id as string;
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

  it('generates deduplicated low-stock and expiring-batch alerts, supports read/read-all, and isolates tenants', async () => {
    const A = api(shopA.token, shopA.branchId);
    const BApi = api(shopB.token, shopB.branchId);

    // Create a tracked product with minStockLevel = 10 and opening stock = 5 expiring in 5 days
    const prod = (
      await A.post('/products', {
        name: 'Milk Packet',
        type: 'COUNT',
        baseUnitId: shopA.pcs,
        minStockLevel: '10',
        trackBatch: true,
        trackExpiry: true,
        prices: [{ unitId: shopA.pcs, quantity: '1', price: '30.00' }],
      }).expect(201)
    ).body.data as { id: string };

    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await A.post(
      '/inventory/opening-stock',
      {
        productId: prod.id,
        unitId: shopA.pcs,
        quantity: '5',
        unitCost: '22.00',
        batchNumber: 'B-MILK-1',
        expiryDate: soon,
      },
      randomUUID(),
    ).expect(201);

    // Missing branch header -> 400 BRANCH_REQUIRED
    await api(shopA.token).post('/notifications/check-alerts').expect(400);

    // Scan branch alerts -> creates 1 LOW_STOCK + 1 EXPIRING_SOON notification
    const check1 = await A.post('/notifications/check-alerts').expect(200);
    expect(check1.body.data.created).toBe(2);

    // Repeating check-alerts while unread creates 0 duplicates
    const check2 = await A.post('/notifications/check-alerts').expect(200);
    expect(check2.body.data.created).toBe(0);

    const unread = await A.get('/notifications/unread-count').expect(200);
    expect(unread.body.data.unreadCount).toBe(2);

    const list = await A.get('/notifications?unreadOnly=true').expect(200);
    const items = list.body.data as { id: string; type: string; readAt: string | null }[];
    expect(items).toHaveLength(2);
    expect(items.map((x) => x.type).sort()).toEqual(['EXPIRING_SOON', 'LOW_STOCK']);

    // Cross-tenant isolation: Shop B sees 0 notifications and gets 404 when trying to mark Shop A's read
    const bCount = await BApi.get('/notifications/unread-count').expect(200);
    expect(bCount.body.data.unreadCount).toBe(0);
    await BApi.post(`/notifications/${items[0]!.id}/read`).expect(404);

    // Mark one read, then mark all remaining read
    const readOne = await A.post(`/notifications/${items[0]!.id}/read`).expect(200);
    expect(readOne.body.data.readAt).not.toBeNull();
    expect((await A.get('/notifications/unread-count').expect(200)).body.data.unreadCount).toBe(1);

    const readAll = await A.post('/notifications/read-all').expect(200);
    expect(readAll.body.data.marked).toBe(1);
    expect((await A.get('/notifications/unread-count').expect(200)).body.data.unreadCount).toBe(0);

    // Unauthenticated -> 401
    await ctx.http().get(`${B}/notifications`).expect(401);
  });
});
