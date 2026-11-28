import { randomUUID } from 'node:crypto';
import { addMonths } from '../../src/common/subscription/subscription-state';
import { PlatformAdminsService } from '../../src/modules/platform/admins/platform-admins.service';
import { base32Decode, stepAt, totpAt } from '../../src/modules/platform/auth/totp';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/** ADMIN_PANEL.md Phase B2 against a real database: shops, lock, payments/extend, plans, roles. */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const ADMIN_PW = 'Admin-Str0ng-Pass!';

suite('Platform shops and subscriptions (real database)', () => {
  jest.setTimeout(300_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let admin: string; // bearer
  let support: string; // bearer

  const http = () => ctx.http();

  /** Creates an admin/support user and walks the full first sign-in; returns a Bearer header. */
  const signedIn = async (role: 'ADMIN' | 'SUPPORT') => {
    const email = `${role.toLowerCase()}-${randomUUID()}@example.com`;
    const { temporaryPassword } = await ctx.app
      .get(PlatformAdminsService)
      .create(null, { email, fullName: role, role }, {});
    const s1 = await http()
      .post('/admin/v1/auth/login')
      .send({ email, password: temporaryPassword })
      .expect(200);
    const mfaToken = s1.body.data.mfaToken as string;
    const setup = await http().post('/admin/v1/auth/mfa/setup').send({ mfaToken }).expect(200);
    const code = totpAt(base32Decode(setup.body.data.secret as string), stepAt(Date.now()));
    const done = await http()
      .post('/admin/v1/auth/mfa/confirm')
      .send({ mfaToken, code })
      .expect(200);
    const bearer = `Bearer ${done.body.data.accessToken as string}`;
    await http()
      .post('/admin/v1/auth/change-password')
      .set('Authorization', bearer)
      .send({ currentPassword: temporaryPassword, newPassword: ADMIN_PW })
      .expect(200);
    return bearer;
  };

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
    admin = await signedIn('ADMIN');
    support = await signedIn('SUPPORT');
  });
  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  interface Shop {
    phone: string;
    token: string;
    orgId: string;
  }
  const register = async (): Promise<Shop> => {
    const phone = uniquePhone();
    const res = await http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Owner',
        phone,
        password: PW,
        shopName: `Shop ${phone}`,
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    return { phone, token: res.body.data.accessToken, orgId: res.body.data.organization.id };
  };
  const shopLogin = (s: Shop, password = PW) =>
    http()
      .post('/api/v1/auth/login')
      .send({ identifier: s.phone, password, deviceUid: `d-${s.phone}` });
  const asAdmin = (method: 'get' | 'post' | 'patch', path: string, who = admin) =>
    http()[method](`/admin/v1${path}`).set('Authorization', who);
  const pro = async () => (await ctx.prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } })).id;
  const extend = (orgId: string, body: object, key = randomUUID()) =>
    asAdmin('post', `/shops/${orgId}/subscription/extend`).set('Idempotency-Key', key).send(body);
  const subOf = (orgId: string) =>
    ctx.prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });

  it('lists shops with their derived state and finds them by phone', async () => {
    const s = await register();
    const res = await asAdmin('get', `/shops?q=${s.phone}`).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: s.orgId, state: 'TRIAL', planCode: 'TRIAL' });
    expect(res.body.data[0].owner.phone).toBe(s.phone);
    const detail = await asAdmin('get', `/shops/${s.orgId}`).expect(200);
    expect(detail.body.data.users[0]).toMatchObject({ isOwner: true, phone: s.phone });
    expect(detail.body.data.payments).toEqual([]);
  });

  it('lock blocks the shop at once and ends its sessions; unlock restores without changing dates', async () => {
    const s = await register();
    const before = await subOf(s.orgId);
    const res = await asAdmin('post', `/shops/${s.orgId}/lock`)
      .send({ reason: 'payment overdue' })
      .expect(200);
    expect(res.body.data.sessionsRevoked).toBeGreaterThan(0);
    await http().get('/api/v1/customers').set('Authorization', `Bearer ${s.token}`).expect(401);
    expect((await shopLogin(s).expect(403)).body.error.code).toBe('ORG_LOCKED');
    const locked = await asAdmin('get', `/shops?status=LOCKED&q=${s.phone}`).expect(200);
    expect(locked.body.data).toHaveLength(1);

    await asAdmin('post', `/shops/${s.orgId}/unlock`).send({ reason: 'paid' }).expect(200);
    await shopLogin(s).expect(200);
    expect((await subOf(s.orgId)).endsAt.getTime()).toBe(before.endsAt.getTime());
    const audit = await ctx.prisma.platformAuditLog.findMany({
      where: { organizationId: s.orgId },
      select: { action: true, reason: true },
    });
    expect(audit).toEqual(
      expect.arrayContaining([
        { action: 'shop.lock', reason: 'payment overdue' },
        { action: 'shop.unlock', reason: 'paid' },
      ]),
    );
  });

  it('record payment extends from the current end (early renewal) at the discounted price, exactly once per key', async () => {
    const s = await register();
    const trialEnd = (await subOf(s.orgId)).endsAt;
    const key = randomUUID();
    const body = {
      months: 3,
      planId: await pro(),
      payment: { method: 'UPI', reference: `UPI-${s.phone}` },
    };
    const first = await extend(s.orgId, body, key).expect(200);
    expect(first.body.data.payment.amount).toBe('1707.15'); // 599 × 3 − 5%
    expect(new Date(first.body.data.newEndsAt).getTime()).toBe(addMonths(trialEnd, 3).getTime());
    const again = await extend(s.orgId, body, key).expect(200);
    expect(again.body.data.replayed).toBe(true);
    expect(await ctx.prisma.subscriptionPayment.count({ where: { organizationId: s.orgId } })).toBe(
      1,
    );

    const dup = await extend(s.orgId, body).expect(409); // new key, same UPI reference
    expect(dup.body.error.code).toBe('DUPLICATE_PAYMENT_REFERENCE');

    const me = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${s.token}`)
      .expect(200);
    expect(me.body.data.subscription).toMatchObject({ state: 'ACTIVE', planCode: 'PRO' });
    const types = (
      await ctx.prisma.subscriptionEvent.findMany({ where: { organizationId: s.orgId } })
    ).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['TRIAL_STARTED', 'PLAN_CHANGED', 'EXTENDED']));
  });

  it('an expired shop is extended from today, and the admin may override the amount', async () => {
    const s = await register();
    const past = new Date(Date.now() - 40 * 86_400_000);
    await ctx.prisma.subscription.update({
      where: { organizationId: s.orgId },
      data: { startsAt: new Date(past.getTime() - 86_400_000), endsAt: past },
    });
    const res = await extend(s.orgId, {
      months: 1,
      planId: await pro(),
      payment: { method: 'CASH', amount: '500' },
    }).expect(200);
    expect(res.body.data.payment.amount).toBe('500.00');
    const ends = new Date(res.body.data.newEndsAt).getTime();
    expect(Math.abs(ends - addMonths(new Date(), 1).getTime())).toBeLessThan(60_000);
  });

  it('two payments recorded at the same moment both count (no lost update)', async () => {
    const s = await register();
    const planId = await pro();
    const start = (await subOf(s.orgId)).endsAt;
    const [a, b] = await Promise.all([
      extend(s.orgId, { months: 1, planId, payment: { method: 'CASH' } }),
      extend(s.orgId, { months: 1, planId, payment: { method: 'CASH' } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await subOf(s.orgId)).endsAt.getTime()).toBe(
      addMonths(addMonths(start, 1), 1).getTime(),
    );
  });

  it('extending a locked shop can unlock it in the same step', async () => {
    const s = await register();
    await asAdmin('post', `/shops/${s.orgId}/lock`).send({ reason: 'overdue' }).expect(200);
    const res = await extend(s.orgId, {
      months: 1,
      planId: await pro(),
      payment: { method: 'UPI' },
      unlock: true,
      reason: 'paid by UPI',
    }).expect(200);
    expect(res.body.data.unlocked).toBe(true);
    await shopLogin(s).expect(200);
  });

  it('refund adds a negative row, once; dates are unchanged', async () => {
    const s = await register();
    const paid = await extend(s.orgId, {
      months: 1,
      planId: await pro(),
      payment: { method: 'UPI' },
    }).expect(200);
    const ends = (await subOf(s.orgId)).endsAt.getTime();
    const paymentId = paid.body.data.payment.id as string;
    const r = await asAdmin('post', `/shops/${s.orgId}/subscription/refund`)
      .send({ paymentId, amount: '100', reason: 'partial refund' })
      .expect(200);
    expect(r.body.data.amount).toBe('-100.00');
    const again = await asAdmin('post', `/shops/${s.orgId}/subscription/refund`)
      .send({ paymentId, reason: 'again' })
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_REFUNDED');
    expect((await subOf(s.orgId)).endsAt.getTime()).toBe(ends);
    const ledger = await asAdmin('get', `/payments?orgId=${s.orgId}`).expect(200);
    expect((ledger.body.data as { amount: string }[]).map((p) => p.amount).sort()).toEqual([
      '-100',
      '599',
    ]);
  });

  it('change plan to BASIC applies its limits to the shop', async () => {
    const s = await register();
    const basic = (await ctx.prisma.plan.findUniqueOrThrow({ where: { code: 'BASIC' } })).id;
    await asAdmin('post', `/shops/${s.orgId}/subscription/change-plan`)
      .send({ planId: basic, reason: 'downgrade' })
      .expect(200);
    const res = await http()
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ code: 'B2', name: 'Second' })
      .expect(409);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('adjust moves the end date and grace days, with events', async () => {
    const s = await register();
    const endsAt = new Date(Date.now() + 60 * 86_400_000).toISOString();
    await asAdmin('post', `/shops/${s.orgId}/subscription/adjust`)
      .send({ endsAt, graceDays: 10, reason: 'goodwill' })
      .expect(200);
    const sub = await subOf(s.orgId);
    expect(sub.endsAt.toISOString()).toBe(endsAt);
    expect(sub.graceDays).toBe(10);
  });

  it('reset owner password: the old one stops working, the temporary one works', async () => {
    const s = await register();
    const res = await asAdmin('post', `/shops/${s.orgId}/reset-owner-password`)
      .send({ reason: 'owner forgot it' })
      .expect(200);
    await shopLogin(s).expect(401);
    await shopLogin(s, res.body.data.temporaryPassword as string).expect(200);
  });

  it('cross-tenant: extending shop A never touches shop B', async () => {
    const a = await register();
    const b = await register();
    const bBefore = await subOf(b.orgId);
    await extend(a.orgId, { months: 6, planId: await pro(), payment: { method: 'BANK' } }).expect(
      200,
    );
    const bAfter = await subOf(b.orgId);
    expect(bAfter.endsAt.getTime()).toBe(bBefore.endsAt.getTime());
    expect(bAfter.version).toBe(bBefore.version);
    expect(await ctx.prisma.subscriptionPayment.count({ where: { organizationId: b.orgId } })).toBe(
      0,
    );
  });

  it('SUPPORT reads and force-logs-out but cannot lock, extend, see money or edit plans', async () => {
    const s = await register();
    await asAdmin('get', '/shops', support).expect(200);
    const detail = await asAdmin('get', `/shops/${s.orgId}`, support).expect(200);
    expect(detail.body.data.payments).toBeNull();
    await asAdmin('post', `/shops/${s.orgId}/notes`, support)
      .send({ note: 'recommend lock' })
      .expect(200);
    await asAdmin('post', `/shops/${s.orgId}/lock`, support).send({ reason: 'x x x' }).expect(403);
    await extend(s.orgId, { months: 1, payment: { method: 'UPI' } })
      .set('Authorization', support)
      .expect(403);
    await asAdmin('get', '/payments', support).expect(403);
    await asAdmin('get', '/plans', support).expect(200);
    await asAdmin('post', '/plans', support)
      .send({ code: 'NOPE', name: 'Nope', monthlyPrice: '1' })
      .expect(403);
    await asAdmin('post', `/shops/${s.orgId}/force-logout`, support)
      .send({ reason: 'stolen phone' })
      .expect(200);
    await http().get('/api/v1/customers').set('Authorization', `Bearer ${s.token}`).expect(401);
  });

  it('ADMIN edits plan prices (decimal strings) and the quote follows', async () => {
    const s = await register();
    const created = await asAdmin('post', '/plans')
      .send({
        code: `P${Date.now().toString(36).toUpperCase()}`,
        name: 'Test plan',
        monthlyPrice: '100.50',
        durationDiscounts: { '3': '10' },
        maxBranches: 2,
        maxUsers: 5,
      })
      .expect(201);
    const planId = created.body.data.id as string;
    expect(created.body.data.monthlyPrice).toBe('100.5');
    const q = await asAdmin(
      'get',
      `/shops/${s.orgId}/subscription/quote?months=3&planId=${planId}`,
    ).expect(200);
    expect(q.body.data.amount).toBe('271.35'); // 301.50 − 10%
    await asAdmin('patch', `/plans/${planId}`)
      .send({ durationDiscounts: { '3': 'lots' }, reason: 'bad' })
      .expect(400);
    await asAdmin('patch', `/plans/${planId}`)
      .send({ isActive: false, reason: 'retire' })
      .expect(200);
    const off = await extend(s.orgId, { months: 1, planId, payment: { method: 'UPI' } }).expect(
      400,
    );
    expect(off.body.error.code).toBe('PLAN_INACTIVE');
  });
});
