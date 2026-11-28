import { SessionCache } from '../../src/common/auth/session-cache';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/** ADMIN_PANEL.md Phase B1 against a real database: trial, state table §2.5, lock, plan limits. */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const DAY = 86_400_000;

suite('Subscriptions and enforcement (real database)', () => {
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

  interface Shop {
    phone: string;
    token: string;
    orgId: string;
    branchId: string;
  }
  const register = async (): Promise<Shop> => {
    const phone = uniquePhone();
    const res = await ctx
      .http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Owner',
        phone,
        password: PW,
        shopName: `Shop ${phone}`,
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    const d = res.body.data;
    return { phone, token: d.accessToken, orgId: d.organization.id, branchId: d.branches[0].id };
  };
  const get = (s: Shop, path: string) =>
    ctx.http().get(`/api/v1${path}`).set('Authorization', `Bearer ${s.token}`);
  const post = (s: Shop, path: string, body: object = {}) =>
    ctx.http().post(`/api/v1${path}`).set('Authorization', `Bearer ${s.token}`).send(body);
  const newCustomer = (s: Shop) =>
    post(s, '/customers', { name: `Cust ${Date.now()}`, phone: uniquePhone() });

  /** Moves the shop's end date; clears the read cache so the next GET sees it (writes always do). */
  const setEndsAt = async (s: Shop, endsAt: Date) => {
    await ctx.prisma.subscription.update({
      where: { organizationId: s.orgId },
      data: { startsAt: new Date(endsAt.getTime() - 30 * DAY), endsAt }, // ends_at >= starts_at
    });
    ctx.app.get(SessionCache).reset();
  };
  const setLock = async (s: Shop, locked: boolean) => {
    await ctx.prisma.organization.update({
      where: { id: s.orgId },
      data: locked
        ? { lockStatus: 'LOCKED', lockReason: 'test', lockedAt: new Date() }
        : { lockStatus: 'NONE', lockReason: null, lockedAt: null },
    });
    ctx.app.get(SessionCache).reset();
  };
  const setPlan = async (s: Shop, code: string) => {
    const plan = await ctx.prisma.plan.findUniqueOrThrow({ where: { code } });
    await ctx.prisma.subscription.update({
      where: { organizationId: s.orgId },
      data: { planId: plan.id, endsAt: new Date(Date.now() + 30 * DAY) },
    });
  };

  it('a new shop starts a 14-day trial in the same transaction, visible in /auth/me', async () => {
    const s = await register();
    const me = await get(s, '/auth/me').expect(200);
    expect(me.headers['x-subscription-state']).toBe('TRIAL');
    const sub = me.body.data.subscription;
    expect(sub).toMatchObject({ state: 'TRIAL', planCode: 'TRIAL', daysLeft: 14 });
    expect(sub.limits).toEqual({ maxBranches: 3, maxUsers: 10 });
    expect(typeof sub.serverTime).toBe('string');
    const events = await ctx.prisma.subscriptionEvent.findMany({
      where: { organizationId: s.orgId },
    });
    expect(events.map((e) => e.type)).toEqual(['TRIAL_STARTED']);
  });

  it('GRACE: full access with the state header', async () => {
    const s = await register();
    await setEndsAt(s, new Date(Date.now() - DAY));
    const list = await get(s, '/customers').expect(200);
    expect(list.headers['x-subscription-state']).toBe('GRACE');
    await newCustomer(s).expect(201);
  });

  it('EXPIRED: reads work, writes answer 402, allowed writes still work', async () => {
    const s = await register();
    await setEndsAt(s, new Date(Date.now() - 6 * DAY)); // past the 5 grace days
    const list = await get(s, '/customers').expect(200);
    expect(list.headers['x-subscription-state']).toBe('EXPIRED');
    const denied = await newCustomer(s).expect(402);
    expect(denied.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
    expect(denied.body.error.details.graceEndsAt).toBeTruthy();
    await post(s, '/notifications/read-all').expect((r) => expect(r.status).toBeLessThan(300));
    const me = await get(s, '/auth/me').expect(200);
    expect(me.body.data.subscription.state).toBe('EXPIRED');
    // Signing in still works: an expired shop keeps read access.
    await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ identifier: s.phone, password: PW, deviceUid: `d-${s.phone}` })
      .expect(200);
  });

  it('LOCKED: blocked on the next request, except me/subscription/logout; login refused; unlock restores', async () => {
    const s = await register();
    const before = await ctx.prisma.subscription.findUniqueOrThrow({
      where: { organizationId: s.orgId },
    });
    await setLock(s, true);
    const blocked = await get(s, '/customers').expect(403);
    expect(blocked.body.error.code).toBe('ORG_LOCKED');
    expect(blocked.headers['x-subscription-state']).toBe('LOCKED');
    await newCustomer(s).expect(403);
    expect((await get(s, '/auth/me').expect(200)).body.data.subscription.state).toBe('LOCKED');
    await get(s, '/subscription').expect(200);
    const login = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ identifier: s.phone, password: PW, deviceUid: `d-${s.phone}` })
      .expect(403);
    expect(login.body.error.code).toBe('ORG_LOCKED');

    await setLock(s, false);
    await get(s, '/customers').expect(200);
    await newCustomer(s).expect(201);
    const after = await ctx.prisma.subscription.findUniqueOrThrow({
      where: { organizationId: s.orgId },
    });
    expect(after.endsAt.getTime()).toBe(before.endsAt.getTime()); // unlock never changes dates
  });

  it('a locked shop cannot be joined through an invitation', async () => {
    const s = await register();
    const roles = (await get(s, '/roles').expect(200)).body.data as { id: string; name: string }[];
    const phone = uniquePhone();
    const inv = await post(s, '/invitations', {
      phone,
      roleId: roles.find((r) => r.name === 'Cashier')!.id,
      branchIds: [s.branchId],
    }).expect(201);
    await setLock(s, true);
    const res = await ctx
      .http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: inv.body.data.code,
        fullName: 'Cashier',
        password: PW,
        deviceUid: `d-${phone}`,
      })
      .expect(403);
    expect(res.body.error.code).toBe('ORG_LOCKED');
  });

  it('plan limits: BASIC allows 1 branch and 3 active users', async () => {
    const s = await register();
    // TRIAL (Pro limits) allows a second branch.
    await post(s, '/branches', { code: 'B2', name: 'Second' }).expect(201);
    await setPlan(s, 'BASIC');
    const branch = await post(s, '/branches', { code: 'B3', name: 'Third' }).expect(409);
    expect(branch.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(branch.body.error.details).toMatchObject({
      limit: 'branches',
      max: 1,
      planCode: 'BASIC',
    });

    const roles = (await get(s, '/roles').expect(200)).body.data as { id: string; name: string }[];
    const cashier = roles.find((r) => r.name === 'Cashier')!.id;
    const hire = async () => {
      const phone = uniquePhone();
      const inv = await post(s, '/invitations', {
        phone,
        roleId: cashier,
        branchIds: [s.branchId],
      });
      if (inv.status !== 201) return inv;
      return ctx
        .http()
        .post('/api/v1/auth/accept-invitation')
        .send({
          code: inv.body.data.code,
          fullName: 'Staff',
          password: PW,
          deviceUid: `d-${phone}`,
        });
    };
    expect((await hire()).status).toBe(201); // 2 active
    expect((await hire()).status).toBe(201); // 3 active
    const over = await hire();
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('an invitation made under the limit cannot be accepted once the shop is full', async () => {
    const s = await register();
    await setPlan(s, 'BASIC');
    const roles = (await get(s, '/roles').expect(200)).body.data as { id: string; name: string }[];
    const cashier = roles.find((r) => r.name === 'Cashier')!.id;
    const invite = async () => {
      const phone = uniquePhone();
      const inv = await post(s, '/invitations', {
        phone,
        roleId: cashier,
        branchIds: [s.branchId],
      }).expect(201);
      return { phone, code: inv.body.data.code as string };
    };
    const a = await invite();
    const b = await invite();
    const c = await invite(); // three invitations while only the owner is active
    const accept = (i: { phone: string; code: string }) =>
      ctx
        .http()
        .post('/api/v1/auth/accept-invitation')
        .send({ code: i.code, fullName: 'Staff', password: PW, deviceUid: `d-${i.phone}` });
    expect((await accept(a)).status).toBe(201);
    expect((await accept(b)).status).toBe(201);
    const third = await accept(c);
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('cross-tenant: locking or expiring one shop never touches another; each sees only its own history', async () => {
    const a = await register();
    const b = await register();
    await setLock(b, true);
    await get(a, '/customers').expect(200);
    const mine = (await get(a, '/subscription').expect(200)).body.data;
    expect(mine.state).toBe('TRIAL');
    const otherEvents = await ctx.prisma.subscriptionEvent.findMany({
      where: { organizationId: b.orgId },
    });
    const myIds = new Set((mine.events as { id: string }[]).map((e) => e.id));
    expect(otherEvents.some((e) => myIds.has(e.id))).toBe(false);
  });

  it('/subscription is for the owner (shop-settings permission), not cashiers', async () => {
    const s = await register();
    const roles = (await get(s, '/roles').expect(200)).body.data as { id: string; name: string }[];
    const phone = uniquePhone();
    const inv = await post(s, '/invitations', {
      phone,
      roleId: roles.find((r) => r.name === 'Cashier')!.id,
      branchIds: [s.branchId],
    }).expect(201);
    const joined = await ctx
      .http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: inv.body.data.code,
        fullName: 'Cashier',
        password: PW,
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    const cashier = { ...s, token: joined.body.data.accessToken as string };
    await get(cashier, '/subscription').expect(403);
    expect((await get(cashier, '/auth/me').expect(200)).body.data.subscription.state).toBe('TRIAL');
  });

  it('a shop with no subscription row (legacy gap) keeps working as ACTIVE', async () => {
    const s = await register();
    await ctx.prisma.subscription.delete({ where: { organizationId: s.orgId } });
    ctx.app.get(SessionCache).reset();
    const res = await get(s, '/customers').expect(200);
    expect(res.headers['x-subscription-state']).toBe('ACTIVE');
    await newCustomer(s).expect(201);
  });

  it('subscription history is append-only (trigger)', async () => {
    const s = await register();
    await expect(
      ctx.prisma.subscriptionEvent.updateMany({
        where: { organizationId: s.orgId },
        data: { reason: 'x' },
      }),
    ).rejects.toThrow(/append-only/);
  });
});
