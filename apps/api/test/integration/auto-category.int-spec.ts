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

suite('Auto-categorization & parent-category filtering (real database)', () => {
  jest.setTimeout(300_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let token: string;
  let branchId: string;
  let pcs: string;

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
        shopName: 'AutoCat Shop',
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    token = res.body.data.accessToken as string;
    branchId = res.body.data.branches[0].id as string;
    const units = (
      await ctx.http().get(`${B}/units`).set('Authorization', `Bearer ${token}`).expect(200)
    ).body.data as { id: string; code: string }[];
    pcs = units.find((u) => u.code === 'PCS')!.id;
  });

  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  const api = () => {
    const auth = <T extends { set(k: string, v: string): T }>(r: T) =>
      r.set('Authorization', `Bearer ${token}`).set('x-branch-id', branchId);
    return {
      get: (p: string) => auth(ctx.http().get(B + p)),
      post: (p: string, body: object = {}) => auth(ctx.http().post(B + p)).send(body),
    };
  };

  it('auto-categorizes products on creation, auto-assigns existing ones, and filters parent + child categories', async () => {
    const A = api();

    // 1. Auto-categorize on POST /products when autoCategorize=true
    const soap = (
      await A.post('/products', {
        name: 'Santoor Sandal Soap',
        type: 'COUNT',
        baseUnitId: pcs,
        autoCategorize: true,
        prices: [{ unitId: pcs, quantity: '1', price: '35.00' }],
      }).expect(201)
    ).body.data as { id: string; category: { id: string; name: string } | null };
    expect(soap.category?.name).toBe('Bath Soaps');

    const surf = (
      await A.post('/products', {
        name: 'Surf Excel Quick Wash',
        type: 'COUNT',
        baseUnitId: pcs,
        autoCategorize: true,
        prices: [{ unitId: pcs, quantity: '1', price: '120.00' }],
      }).expect(201)
    ).body.data as { id: string; category: { id: string; name: string } | null };
    expect(surf.category?.name).toBe('Detergents & Surf');

    // 2. Product created without autoCategorize stays uncategorized, then POST /categories/auto-assign categorizes it
    const soup = (
      await A.post('/products', {
        name: 'Knorr Tomato Soup',
        type: 'COUNT',
        baseUnitId: pcs,
        prices: [{ unitId: pcs, quantity: '1', price: '65.00' }],
      }).expect(201)
    ).body.data as { id: string; category: { id: string; name: string } | null };
    expect(soup.category).toBeNull();

    const assigned = (await A.post('/categories/auto-assign').expect(200)).body.data as {
      updated: number;
      createdCategories: number;
    };
    expect(assigned.updated).toBe(1);
    expect(assigned.createdCategories).toBe(1);

    // 3. Filtering /inventory/balances by categoryId returns only matching items
    const soapStock = await A.get(`/inventory/balances?categoryId=${soap.category!.id}`).expect(
      200,
    );
    expect(soapStock.body.meta.total).toBe(1);
    expect((soapStock.body.data as { productId: string }[])[0]!.productId).toBe(soap.id);

    // 4. Parent-category filter includes child categories on both /products and /inventory/balances
    const parent = (await A.post('/categories', { name: 'Cleaning' }).expect(201)).body.data as {
      id: string;
    };
    const child = (
      await A.post('/categories', { name: 'Dish Bars', parentId: parent.id }).expect(201)
    ).body.data as { id: string };
    const dishBar = (
      await A.post('/products', {
        name: 'Exo Round Bar',
        type: 'COUNT',
        baseUnitId: pcs,
        categoryId: child.id,
        prices: [{ unitId: pcs, quantity: '1', price: '25.00' }],
      }).expect(201)
    ).body.data as { id: string };

    const byParentProducts = await A.get(`/products?categoryId=${parent.id}`).expect(200);
    expect((byParentProducts.body.data as { id: string }[]).map((p) => p.id)).toEqual([dishBar.id]);

    const byParentStock = await A.get(`/inventory/balances?categoryId=${parent.id}`).expect(200);
    expect((byParentStock.body.data as { productId: string }[]).map((p) => p.productId)).toEqual([
      dishBar.id,
    ]);
  });
});
