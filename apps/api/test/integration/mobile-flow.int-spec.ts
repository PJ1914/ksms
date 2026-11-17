import { buildProductPayload } from '@ksms/validation';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/**
 * The exact sequence of calls the mobile app makes in its first slice (sign-in screen, product list,
 * add product), against a real database. The product body is built by the app's own code, so a change
 * on either side that breaks the phone fails here.
 */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const B = '/api/v1';

suite('Mobile app flow (real database)', () => {
  jest.setTimeout(300_000);
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

  it('create shop → sign in → refresh → add products → search → sign out', async () => {
    const http = () => ctx.http();
    const phone = uniquePhone();
    const device = {
      deviceUid: '6f1c1f4e-2b0a-4c38-9a5e-0d7f6c1e9b11',
      deviceName: 'Test phone',
      appVersion: '0.1.0',
    };

    // "Create your shop" (the app sends the phone as typed; the server normalises it)
    const reg = await http()
      .post(`${B}/auth/register-owner`)
      .send({
        fullName: 'Ramesh Kumar',
        phone: `+91 ${phone}`,
        password: PW,
        shopName: 'Sri Lakshmi Stores',
        ...device,
      })
      .expect(201);
    const r = reg.body.data;
    expect(r).toMatchObject({
      expiresIn: expect.any(Number),
      user: { fullName: 'Ramesh Kumar', phone },
      organization: { name: 'Sri Lakshmi Stores' },
      role: { name: 'Owner' },
    });
    expect(r.branches.filter((b: { isDefault: boolean }) => b.isDefault)).toHaveLength(1);
    expect(r.permissions).toEqual(expect.arrayContaining(['product.read', 'product.manage']));

    // A second registration with the same number is refused (the app shows "sign in instead")
    const dup = await http()
      .post(`${B}/auth/register-owner`)
      .send({ fullName: 'Someone', phone, password: PW, shopName: 'Other Shop', ...device });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');

    // "Sign in" with a wrong password, then the right one
    const bad = await http()
      .post(`${B}/auth/login`)
      .send({ identifier: phone, password: 'wrong-pass', ...device });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const login = (
      await http()
        .post(`${B}/auth/login`)
        .send({ identifier: phone, password: PW, ...device })
        .expect(200)
    ).body.data;

    // App restart: the stored refresh token gives a new session; the old one is then refused
    const refreshed = (
      await http().post(`${B}/auth/refresh`).send({ refreshToken: login.refreshToken }).expect(200)
    ).body.data;
    expect(refreshed.organization.name).toBe('Sri Lakshmi Stores');
    expect(refreshed.refreshToken).not.toBe(login.refreshToken);

    const token = refreshed.accessToken as string;
    const branchId = (refreshed.branches as { id: string; isDefault: boolean }[]).find(
      (b) => b.isDefault,
    )!.id;
    const get = (p: string) =>
      http()
        .get(B + p)
        .set('Authorization', `Bearer ${token}`)
        .set('x-branch-id', branchId);
    const post = (p: string, body: object) =>
      http()
        .post(B + p)
        .set('Authorization', `Bearer ${token}`)
        .set('x-branch-id', branchId)
        .send(body);

    // Empty list first ("No products yet")
    const empty = (await get('/products?page=1&pageSize=30&sort=name').expect(200)).body;
    expect(empty).toEqual({ data: [], meta: { page: 1, pageSize: 30, total: 0 } });

    // "Add product" for each way of selling, using the app's own payload builder
    const units = (await get('/units').expect(200)).body.data as { id: string; code: string }[];
    for (const input of [
      { name: 'Sona Masoori Rice', sellBy: 'KG' as const, price: '52.50' },
      { name: 'Sunflower Oil', sellBy: 'L' as const, price: '180' },
      { name: 'Lux Soap', sellBy: 'PCS' as const, price: '35' },
    ]) {
      await post('/products', buildProductPayload(input, units)).expect(201);
    }

    // The list shows name, unit and price as decimal strings, sorted by name
    const list = (await get('/products?page=1&pageSize=30&sort=name').expect(200)).body;
    expect(list.meta.total).toBe(3);
    expect(
      list.data.map((p: { name: string; baseUnit: { code: string }; basePrice: string }) => [
        p.name,
        p.baseUnit.code,
        p.basePrice,
      ]),
    ).toEqual([
      ['Lux Soap', 'PCS', '35.00'],
      ['Sona Masoori Rice', 'KG', '52.50'],
      ['Sunflower Oil', 'L', '180.00'],
    ]);

    // Search box
    const found = (await get('/products?page=1&pageSize=30&sort=name&q=rice').expect(200)).body;
    expect(found.data.map((p: { name: string }) => p.name)).toEqual(['Sona Masoori Rice']);

    // Paging ("load more" at the end of the list)
    const p2 = (await get('/products?page=2&pageSize=2&sort=name').expect(200)).body;
    expect(p2.data.map((p: { name: string }) => p.name)).toEqual(['Sunflower Oil']);

    // A bad price is refused by the server too, never stored
    const badPrice = await post('/products', {
      ...buildProductPayload({ name: 'Dal', sellBy: 'KG', price: '1' }, units),
      prices: [{ unitId: units.find((u) => u.code === 'KG')!.id, price: '12.345' }],
    });
    expect(badPrice.status).toBe(400);

    // "Sign out": the token stops working at once
    await http().post(`${B}/auth/logout`).set('Authorization', `Bearer ${token}`).expect(204);
    await get('/products').expect(401);
  });
});
