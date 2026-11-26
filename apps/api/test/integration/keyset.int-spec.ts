import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/** FIXES F12: opt-in keyset paging and capped totals. */
const suite = testDbUrl() ? describe : describe.skip;

suite('Keyset pagination (real database)', () => {
  jest.setTimeout(240_000);
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

  const shop = async () => {
    const phone = uniquePhone();
    const res = await ctx
      .http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Owner',
        phone,
        password: 'Str0ng-Pass!',
        shopName: `Shop ${phone}`,
        deviceUid: `device-${phone}`,
      })
      .expect(201);
    const d = res.body.data;
    return {
      token: d.accessToken as string,
      org: d.organization.id as string,
      branch: d.branches[0].id as string,
    };
  };
  const get = (s: { token: string; branch: string }, path: string) =>
    ctx
      .http()
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${s.token}`)
      .set('x-branch-id', s.branch);

  const seedProducts = async (org: string, names: string[]) => {
    const pcs = await ctx.prisma.unitOfMeasurement.findFirstOrThrow({ where: { code: 'PCS' } });
    for (const [i, name] of names.entries()) {
      await ctx.prisma.product.create({
        data: {
          organizationId: org,
          sku: `K${org.slice(0, 4)}${i}`,
          name,
          type: 'COUNT',
          baseUnitId: pcs.id,
        },
      });
    }
  };

  it('walking the cursor gives exactly the offset listing, with no total, in both directions', async () => {
    const s = await shop();
    // Duplicate names exercise the (name, id) tie-break.
    await seedProducts(s.org, ['Atta', 'Biscuit', 'Biscuit', 'Dal', 'Ghee', 'Oil', 'Rice', 'Salt']);

    for (const order of ['asc', 'desc']) {
      const all = (await get(s, `/products?pageSize=100&order=${order}`).expect(200)).body;
      expect(all.meta).toMatchObject({ total: 8, totalCapped: false });

      const seen: string[] = [];
      let res = (await get(s, `/products?paging=cursor&pageSize=3&order=${order}`).expect(200))
        .body;
      for (;;) {
        expect(res.meta.total).toBeUndefined();
        seen.push(...res.data.map((p: { id: string }) => p.id));
        if (!res.meta.hasMore) break;
        res = (
          await get(s, `/products?cursor=${res.meta.nextCursor}&pageSize=3&order=${order}`).expect(
            200,
          )
        ).body;
      }
      expect(seen).toEqual(all.data.map((p: { id: string }) => p.id));
    }
  });

  it('refuses a tampered cursor, and a cursor never crosses into another shop', async () => {
    const a = await shop();
    const b = await shop();
    await seedProducts(a.org, ['Alpha', 'Beta', 'Gamma']);
    await seedProducts(b.org, ['Delta']);

    expect((await get(a, '/products?cursor=not-a-cursor').expect(400)).body.error.code).toBe(
      'INVALID_CURSOR',
    );
    const first = (await get(a, '/products?paging=cursor&pageSize=1').expect(200)).body;
    const fromB = (
      await get(b, `/products?cursor=${first.meta.nextCursor}&pageSize=10`).expect(200)
    ).body;
    expect(fromB.data.map((p: { name: string }) => p.name)).toEqual(['Delta']);
  });

  it('sales and stock movements support cursor mode too', async () => {
    const s = await shop();
    for (const path of ['/sales', '/inventory/movements']) {
      const res = (await get(s, `${path}?paging=cursor&pageSize=5`).expect(200)).body;
      expect(res.meta).toMatchObject({ limit: 5, hasMore: false, nextCursor: null });
      const paged = (await get(s, `${path}?page=1&pageSize=5`).expect(200)).body;
      expect(paged.meta).toMatchObject({ page: 1, pageSize: 5, totalCapped: false });
    }
  });
});
