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
  kg: string;
}

/**
 * Phase 14: delta sync change feeds (products, categories, units, customers) with soft deletes,
 * stable composite `(updated_at, id)` cursor paging, cross-tenant isolation, RBAC, and idempotent held bills.
 */
suite('Sync feeds and idempotent held bills (real database)', () => {
  jest.setTimeout(300_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let shopA: Shop;
  let shopB: Shop;

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
    shopA = await newShop('Sync Shop A');
    shopB = await newShop('Sync Shop B');
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
      patch: (p: string, body: object) => auth(ctx.http().patch(B + p)).send(body),
      put: (p: string, body: object) => auth(ctx.http().put(B + p)).send(body),
      delete: (p: string) => auth(ctx.http().delete(B + p)),
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
      kg: units.find((u) => u.code === 'KG')!.id,
    };
  }

  async function hireRole(shop: Shop, roleName: string): Promise<string> {
    const A = api(shop.token, shop.branchId);
    const roles = (await A.get('/roles').expect(200)).body.data as { id: string; name: string }[];
    const roleId = roles.find((r) => r.name === roleName)!.id;
    const phone = uniquePhone();
    const inv = await A.post('/invitations', {
      phone,
      roleId,
      branchIds: [shop.branchId],
    }).expect(201);
    const acc = await ctx
      .http()
      .post(`${B}/auth/accept-invitation`)
      .send({
        code: inv.body.data.code,
        fullName: roleName,
        password: PW,
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    return acc.body.data.accessToken as string;
  }

  it('pulls products, categories, units and customers with updated_since deltas and soft deletes', async () => {
    const A = api(shopA.token, shopA.branchId);

    // Seed category, product (with barcode & price), and customer in Shop A
    const cat = (await A.post('/categories', { name: 'Grains' }).expect(201)).body.data as {
      id: string;
    };
    const prod = (
      await A.post('/products', {
        name: 'Sona Masoori Rice',
        type: 'WEIGHT',
        baseUnitId: shopA.kg,
        categoryId: cat.id,
        barcodes: ['8901234500001'],
        prices: [{ unitId: shopA.kg, quantity: '1', price: '62.50' }],
      }).expect(201)
    ).body.data as { id: string };
    const cust = (
      await A.post('/customers', {
        name: 'Ramesh Kirana',
        phone: uniquePhone(),
        creditLimit: '5000.00',
      }).expect(201)
    ).body.data as { id: string };

    // Initial full sync
    const p1 = await A.get('/sync/products').expect(200);
    expect(p1.body.meta.hasMore).toBe(false);
    expect(p1.body.meta.nextCursor).toBeNull();
    expect(typeof p1.body.meta.serverTime).toBe('string');
    const syncedProd = (
      p1.body.data as {
        id: string;
        basePrice: string | null;
        deletedAt: string | null;
        barcodes: { barcode: string }[];
      }[]
    ).find((x) => x.id === prod.id);
    expect(syncedProd).toBeDefined();
    expect(syncedProd!.basePrice).toBe('62.50');
    expect(syncedProd!.deletedAt).toBeNull();
    expect(syncedProd!.barcodes.map((b) => b.barcode)).toEqual(['8901234500001']);

    const c1 = await A.get('/sync/categories').expect(200);
    expect((c1.body.data as { id: string }[]).some((x) => x.id === cat.id)).toBe(true);

    const cu1 = await A.get('/sync/customers').expect(200);
    const syncedCust = (
      cu1.body.data as {
        id: string;
        balance: string;
        creditLimit: string | null;
        deletedAt: string | null;
      }[]
    ).find((x) => x.id === cust.id);
    expect(syncedCust).toBeDefined();
    expect(syncedCust!.balance).toBe('0.00');
    expect(syncedCust!.creditLimit).toBe('5000.00');
    expect(syncedCust!.deletedAt).toBeNull();

    // Units feed pages stably by id
    const unitIds: string[] = [];
    let unitCursor: string | null = null;
    for (;;) {
      const url = unitCursor
        ? `/sync/units?limit=3&cursor=${encodeURIComponent(unitCursor)}`
        : '/sync/units?limit=3';
      const uRes = await A.get(url).expect(200);
      unitIds.push(...(uRes.body.data as { id: string }[]).map((u) => u.id));
      if (!uRes.body.meta.hasMore) break;
      unitCursor = uRes.body.meta.nextCursor as string;
    }
    expect(unitIds.length).toBeGreaterThanOrEqual(4);
    expect(new Set(unitIds).size).toBe(unitIds.length);

    // Record watermark, then edit price + soft-delete product, category and customer
    const watermark = new Date(Date.now() + 25).toISOString();
    await new Promise((r) => setTimeout(r, 40));

    // Price change must bump product.updated_at so it appears in updated_since
    await A.put(`/products/${prod.id}/prices`, {
      prices: [
        { unitId: shopA.kg, quantity: '1', price: '62.50' },
        { unitId: shopA.kg, quantity: '5', price: '300.00' },
      ],
    }).expect(200);

    const pDeltaPrice = await A.get(
      `/sync/products?updated_since=${encodeURIComponent(watermark)}`,
    ).expect(200);
    const updatedRow = (
      pDeltaPrice.body.data as { id: string; prices: { quantity: string; price: string }[] }[]
    ).find((x) => x.id === prod.id);
    expect(updatedRow).toBeDefined();
    expect(updatedRow!.prices.some((x) => x.quantity === '5.000' && x.price === '300.00')).toBe(
      true,
    );

    // Soft-delete product and category via API, and verify customer deactivation + soft-delete in delta feed
    const deleteWatermark = new Date(Date.now() + 25).toISOString();
    await new Promise((r) => setTimeout(r, 40));
    await A.delete(`/products/${prod.id}`).expect(204);
    await A.delete(`/categories/${cat.id}`).expect(204);
    await A.post(`/customers/${cust.id}/deactivate`).expect(200);
    await ctx.prisma.customer.update({
      where: { id: cust.id },
      data: { deletedAt: new Date() },
    });

    const pDeleted = await A.get(
      `/sync/products?updated_since=${encodeURIComponent(deleteWatermark)}`,
    ).expect(200);
    expect(
      (pDeleted.body.data as { id: string; deletedAt: string | null }[]).find(
        (x) => x.id === prod.id,
      )?.deletedAt,
    ).not.toBeNull();

    const catDeleted = await A.get(
      `/sync/categories?updated_since=${encodeURIComponent(deleteWatermark)}`,
    ).expect(200);
    expect(
      (catDeleted.body.data as { id: string; deletedAt: string | null }[]).find(
        (x) => x.id === cat.id,
      )?.deletedAt,
    ).not.toBeNull();

    const custDeleted = await A.get(
      `/sync/customers?updated_since=${encodeURIComponent(deleteWatermark)}`,
    ).expect(200);
    expect(
      (custDeleted.body.data as { id: string; deletedAt: string | null }[]).find(
        (x) => x.id === cust.id,
      )?.deletedAt,
    ).not.toBeNull();
  });

  it('pages stably with composite (updated_at, id) cursor when rows share the exact same updated_at', async () => {
    const A = api(shopA.token, shopA.branchId);
    const createdIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await A.post('/customers', {
        name: `Tie Customer ${i}`,
        phone: uniquePhone(),
      }).expect(201);
      createdIds.push(r.body.data.id as string);
    }

    // Force all 5 customers to share the exact same future updated_at timestamp
    const tiedAt = new Date(Date.now() + 60_000);
    await ctx.prisma.$executeRawUnsafe(
      `UPDATE customers SET updated_at = $1 WHERE id = ANY($2::uuid[])`,
      tiedAt,
      createdIds,
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const url = cursor
        ? `/sync/customers?updated_since=${encodeURIComponent(tiedAt.toISOString())}&limit=2&cursor=${encodeURIComponent(cursor)}`
        : `/sync/customers?updated_since=${encodeURIComponent(tiedAt.toISOString())}&limit=2`;
      const res = await A.get(url).expect(200);
      const batch = res.body.data as { id: string }[];
      seen.push(...batch.map((c) => c.id));
      if (!res.body.meta.hasMore) break;
      cursor = res.body.meta.nextCursor as string;
      expect(cursor).toBeTruthy();
    }

    // Zero skipped, zero duplicated
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...createdIds].sort());
  });

  it('enforces cross-tenant isolation, permissions and input validation on /sync/*', async () => {
    const A = api(shopA.token, shopA.branchId);
    const ShopBApi = api(shopB.token, shopB.branchId);

    const pA = (
      await A.post('/products', {
        name: 'Shop A Secret Item',
        type: 'COUNT',
        baseUnitId: shopA.pcs,
        prices: [{ unitId: shopA.pcs, quantity: '1', price: '10.00' }],
      }).expect(201)
    ).body.data as { id: string };
    const catA = (await A.post('/categories', { name: 'Shop A Cat' }).expect(201)).body.data as {
      id: string;
    };
    const custA = (
      await A.post('/customers', { name: 'Shop A Customer', phone: uniquePhone() }).expect(201)
    ).body.data as { id: string };

    // Shop B sees zero of Shop A's records
    const bProds = await ShopBApi.get('/sync/products').expect(200);
    const bCats = await ShopBApi.get('/sync/categories').expect(200);
    const bCusts = await ShopBApi.get('/sync/customers').expect(200);
    expect((bProds.body.data as { id: string }[]).some((x) => x.id === pA.id)).toBe(false);
    expect((bCats.body.data as { id: string }[]).some((x) => x.id === catA.id)).toBe(false);
    expect((bCusts.body.data as { id: string }[]).some((x) => x.id === custA.id)).toBe(false);

    // Unauthenticated -> 401
    await ctx.http().get(`${B}/sync/products`).expect(401);

    // Collection Agent has customer.read but NOT product.read
    const agentToken = await hireRole(shopA, 'Collection Agent');
    const Agent = api(agentToken, shopA.branchId);
    await Agent.get('/sync/products').expect(403);
    await Agent.get('/sync/categories').expect(403);
    await Agent.get('/sync/units').expect(403);
    await Agent.get('/sync/customers').expect(200);

    // Invalid cursor / updated_since -> 400
    const badCursor = await A.get('/sync/products?cursor=not-valid').expect(400);
    expect(badCursor.body.error.code).toBe('INVALID_CURSOR');

    const badDate = await A.get('/sync/customers?updated_since=2026-01-01').expect(400);
    expect(badDate.body.error.code).toBe('INVALID_UPDATED_SINCE');
  });

  it('makes POST /held-bills idempotent with Idempotency-Key and prevents duplicates on retry', async () => {
    const A = api(shopA.token, shopA.branchId);
    const key = randomUUID();
    const body = {
      label: 'Counter 1 Parked',
      payload: {
        lines: [],
        customerId: null,
        customerName: null,
        billDiscount: '0',
      },
    };

    // First upload
    const first = await A.post('/held-bills', body, key).expect(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const firstId = first.body.data.id as string;

    // Exact retry with the same Idempotency-Key replays the same held bill and creates zero duplicates
    const retry = await A.post('/held-bills', body, key).expect(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.data.id).toBe(firstId);

    const rows = await ctx.prisma.heldBill.findMany({
      where: { organizationId: shopA.organizationId, label: 'Counter 1 Parked', deletedAt: null },
    });
    expect(rows).toHaveLength(1);

    // Same Idempotency-Key with a different payload -> 422 IDEMPOTENCY_KEY_REUSED
    const reuse = await A.post('/held-bills', { ...body, label: 'Different Label' }, key).expect(
      422,
    );
    expect(reuse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Invalid Idempotency-Key -> 400 IDEMPOTENCY_KEY_INVALID
    const badKey = await A.post('/held-bills', body, 'not-a-uuid').expect(400);
    expect(badKey.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');

    // Without Idempotency-Key continues to work normally
    const plain = await A.post('/held-bills', { ...body, label: 'No Key Bill' }).expect(201);
    expect(plain.body.data.id).not.toBe(firstId);
  });
});
