import { ReconciliationRunner } from '../../src/common/reconcile/reconciliation-runner';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/** FIXES F21: reconciliation is owner-only, throttled, time-limited and cached. */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const ROUTES = [
  '/inventory/reconciliation',
  '/sales/reconciliation',
  '/finance/reconciliation',
  '/collections/reconciliation',
  '/procurement/reconciliation',
];

suite('Reconciliation guard (real database)', () => {
  jest.setTimeout(300_000);
  let db: TestSchema;
  let ctx: IntegrationApp; // harness defaults: no cache, no throttle
  let cached: IntegrationApp; // production-like: 5-minute cache, 2 calls a minute

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
    cached = await createIntegrationApp(db, {
      RECONCILE_CACHE_SECONDS: '300',
      RECONCILE_THROTTLE_LIMIT: '2',
    });
  });
  afterAll(async () => {
    await ctx?.close();
    await cached?.close();
    await db?.drop();
  });

  const shop = async (app: IntegrationApp) => {
    const phone = uniquePhone();
    const res = await app
      .http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Owner',
        phone,
        password: PW,
        shopName: `S ${phone}`,
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    const d = res.body.data;
    return {
      token: d.accessToken as string,
      branch: d.branches[0].id as string,
      org: d.organization.id as string,
    };
  };
  const get = (app: IntegrationApp, s: { token: string; branch: string }, path: string) =>
    app
      .http()
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${s.token}`)
      .set('x-branch-id', s.branch);

  it('only the owner may run them; a manager and a cashier get 403', async () => {
    const owner = await shop(ctx);
    const roles = (await get(ctx, owner, '/roles').expect(200)).body.data as {
      id: string;
      name: string;
    }[];
    for (const name of ['Manager', 'Cashier']) {
      const phone = uniquePhone();
      const inv = await ctx
        .http()
        .post('/api/v1/invitations')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ phone, roleId: roles.find((r) => r.name === name)!.id, branchIds: [owner.branch] })
        .expect(201);
      const joined = await ctx
        .http()
        .post('/api/v1/auth/accept-invitation')
        .send({ code: inv.body.data.code, fullName: name, password: PW, deviceUid: `d-${phone}` })
        .expect(201);
      const staff = { token: joined.body.data.accessToken as string, branch: owner.branch };
      for (const route of ROUTES) await get(ctx, staff, route).expect(403);
    }
    for (const route of ROUTES) await get(ctx, owner, route).expect(200);
  });

  it("checks only the caller's own shop (cross-tenant)", async () => {
    const a = await shop(ctx);
    const b = await shop(ctx);
    const pcs = await ctx.prisma.unitOfMeasurement.findFirstOrThrow({ where: { code: 'PCS' } });
    const p = await ctx.prisma.product.create({
      data: {
        organizationId: b.org,
        sku: 'B-ONLY',
        name: 'B only',
        type: 'COUNT',
        baseUnitId: pcs.id,
      },
    });
    // Shop B's stock is broken behind the application's back; shop A's check must not see it.
    await ctx.prisma.inventoryBalance.create({
      data: { organizationId: b.org, branchId: b.branch, productId: p.id, quantityOnHand: '7.000' },
    });
    expect((await get(ctx, a, '/inventory/reconciliation').expect(200)).body.data.consistent).toBe(
      true,
    );
    expect((await get(ctx, b, '/inventory/reconciliation').expect(200)).body.data.consistent).toBe(
      false,
    );
  });

  it('repeats within 5 minutes reuse the result instead of re-running the scan', async () => {
    const s = await shop(cached);
    expect(
      (await get(cached, s, '/inventory/reconciliation').expect(200)).body.data.consistent,
    ).toBe(true);
    const pcs = await ctx.prisma.unitOfMeasurement.findFirstOrThrow({ where: { code: 'PCS' } });
    const p = await ctx.prisma.product.create({
      data: {
        organizationId: s.org,
        sku: 'TAMPER',
        name: 'Tamper',
        type: 'COUNT',
        baseUnitId: pcs.id,
      },
    });
    await ctx.prisma.inventoryBalance.create({
      data: { organizationId: s.org, branchId: s.branch, productId: p.id, quantityOnHand: '3.000' },
    });
    // Cached: still the earlier answer. The uncached instance sees the problem at once.
    expect(
      (await get(cached, s, '/inventory/reconciliation').expect(200)).body.data.consistent,
    ).toBe(true);
    expect((await get(ctx, s, '/inventory/reconciliation').expect(200)).body.data.consistent).toBe(
      false,
    );
  });

  it('is throttled to 2 calls a minute', async () => {
    const s = await shop(cached);
    await get(cached, s, '/sales/reconciliation').expect(200);
    await get(cached, s, '/sales/reconciliation').expect(200);
    await get(cached, s, '/sales/reconciliation').expect(429);
  });

  it('runs its queries under a 10 s statement timeout', async () => {
    const runner = ctx.app.get(ReconciliationRunner);
    const shown = await runner.run(
      'probe',
      'org',
      null,
      async (tx) => tx.$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`,
    );
    expect(shown[0]!.statement_timeout).toBe('10s');
  });
});
