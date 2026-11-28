import { randomUUID } from 'node:crypto';
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

/** The admin Users page against a real database: list everyone, edit, change role, remove, reset. */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';

suite('Platform users (real database)', () => {
  jest.setTimeout(300_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let admin: string;
  let support: string;
  const http = () => ctx.http();

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
      .send({ currentPassword: temporaryPassword, newPassword: 'Admin-Str0ng-Pass!' })
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
    branchId: string;
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
    const d = res.body.data;
    return { phone, token: d.accessToken, orgId: d.organization.id, branchId: d.branches[0].id };
  };
  const shopApi = (s: { token: string }) => ({
    get: (p: string) => http().get(`/api/v1${p}`).set('Authorization', `Bearer ${s.token}`),
    post: (p: string, b: object = {}) =>
      http().post(`/api/v1${p}`).set('Authorization', `Bearer ${s.token}`).send(b),
  });
  const plat = (who: string) => ({
    get: (p: string) => http().get(`/admin/v1${p}`).set('Authorization', who),
    post: (p: string, b: object = {}) =>
      http().post(`/admin/v1${p}`).set('Authorization', who).send(b),
    patch: (p: string, b: object = {}) =>
      http().patch(`/admin/v1${p}`).set('Authorization', who).send(b),
  });
  const roles = async (s: Shop) =>
    (await plat(admin).get(`/shops/${s.orgId}/roles`).expect(200)).body.data as {
      id: string;
      name: string;
    }[];
  /** A staff member who joined through an invitation. */
  const hire = async (s: Shop, roleName = 'Cashier') => {
    const phone = uniquePhone();
    const roleId = (await roles(s)).find((r) => r.name === roleName)!.id;
    const inv = await shopApi(s)
      .post('/invitations', { phone, roleId, branchIds: [s.branchId] })
      .expect(201);
    const joined = await http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: inv.body.data.code,
        fullName: `${roleName} Person`,
        password: PW,
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    return {
      phone,
      token: joined.body.data.accessToken as string,
      userId: joined.body.data.user.id as string,
    };
  };
  const memberOf = async (orgId: string, userId: string) =>
    ctx.prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      include: { role: true },
    });

  it('lists every person across shops, searchable by phone and filterable by shop', async () => {
    const a = await register();
    const b = await register();
    const staff = await hire(a);
    const byPhone = await plat(support).get(`/users?q=${staff.phone}`).expect(200);
    expect(byPhone.body.data).toHaveLength(1);
    expect(byPhone.body.data[0]).toMatchObject({
      role: { name: 'Cashier', isOwner: false },
      shop: { id: a.orgId },
      user: { phone: staff.phone },
    });
    const ofA = await plat(admin).get(`/users?orgId=${a.orgId}`).expect(200);
    expect(ofA.body.data).toHaveLength(2); // owner + cashier
    const ofB = await plat(admin).get(`/users?orgId=${b.orgId}`).expect(200);
    expect(ofB.body.data).toHaveLength(1);
    const owners = await plat(admin).get(`/users?orgId=${a.orgId}&role=Owner`).expect(200);
    expect(owners.body.data).toHaveLength(1);
    // never leaks secrets
    expect(JSON.stringify(ofA.body)).not.toMatch(/passwordHash|refresh/i);
  });

  it('changes a role to any role of the same shop; the person gets the new permissions', async () => {
    const s = await register();
    const staff = await hire(s, 'Cashier');
    const member = await memberOf(s.orgId, staff.userId);
    expect(
      await shopApi(staff)
        .get('/employees')
        .then((r) => r.status),
    ).toBe(403); // cashier: no staff view
    const manager = (await roles(s)).find((r) => r.name === 'Manager')!.id;
    const res = await plat(admin)
      .patch(`/users/${member.id}`, { roleId: manager, reason: 'promoted to manager' })
      .expect(200);
    expect(res.body.data.role.name).toBe('Manager');
    expect((await memberOf(s.orgId, staff.userId)).role.name).toBe('Manager');
    const audit = await ctx.prisma.platformAuditLog.findFirst({
      where: { entityId: member.id, action: 'user.update' },
    });
    expect(audit?.reason).toBe('promoted to manager');
    expect(audit?.beforeData).toMatchObject({ role: 'Cashier' });
  });

  it('refuses a role that belongs to another shop, and demoting the only Owner', async () => {
    const a = await register();
    const b = await register();
    const staff = await hire(a);
    const member = await memberOf(a.orgId, staff.userId);
    const foreign = (await roles(b)).find((r) => r.name === 'Manager')!.id;
    const bad = await plat(admin)
      .patch(`/users/${member.id}`, { roleId: foreign, reason: 'wrong shop' })
      .expect(400);
    expect(bad.body.error.code).toBe('ROLE_NOT_FOUND');

    const owner = await ctx.prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: a.orgId, role: { name: 'Owner' } },
    });
    const cashier = (await roles(a)).find((r) => r.name === 'Cashier')!.id;
    const last = await plat(admin)
      .patch(`/users/${owner.id}`, { roleId: cashier, reason: 'demote' })
      .expect(409);
    expect(last.body.error.code).toBe('LAST_OWNER');
    const remove = await plat(admin)
      .post(`/users/${owner.id}/status`, { status: 'DEACTIVATED', reason: 'remove' })
      .expect(409);
    expect(remove.body.error.code).toBe('LAST_OWNER');
  });

  it('edits name, phone and email; refuses duplicates and bad numbers', async () => {
    const s = await register();
    const staff = await hire(s);
    const other = await hire(s);
    const member = await memberOf(s.orgId, staff.userId);
    const fresh = uniquePhone();
    const ok = await plat(admin)
      .patch(`/users/${member.id}`, {
        fullName: 'Renamed Person',
        phone: `+91 ${fresh}`,
        email: 'New.Mail@Example.com',
        reason: 'owner asked',
      })
      .expect(200);
    expect(ok.body.data.user).toMatchObject({
      fullName: 'Renamed Person',
      phone: fresh,
      email: 'new.mail@example.com',
    });
    const dup = await plat(admin)
      .patch(`/users/${member.id}`, { phone: other.phone, reason: 'dup' })
      .expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    await plat(admin).patch(`/users/${member.id}`, { phone: '12345', reason: 'bad' }).expect(400);
    await plat(admin).patch(`/users/${member.id}`, { reason: 'nothing' }).expect(400);
  });

  it('removing a user signs them out at once and blocks login; restoring brings them back', async () => {
    const s = await register();
    const staff = await hire(s);
    const member = await memberOf(s.orgId, staff.userId);
    await shopApi(staff).get('/auth/me').expect(200);
    await plat(admin)
      .post(`/users/${member.id}/status`, { status: 'DEACTIVATED', reason: 'left the shop' })
      .expect(200);
    await shopApi(staff).get('/auth/me').expect(401);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ identifier: staff.phone, password: PW, deviceUid: `d-${staff.phone}` });
    expect(login.status).toBe(403);
    await plat(admin)
      .post(`/users/${member.id}/status`, { status: 'ACTIVE', reason: 'came back' })
      .expect(200);
    await http()
      .post('/api/v1/auth/login')
      .send({ identifier: staff.phone, password: PW, deviceUid: `d-${staff.phone}` })
      .expect(200);
  });

  it('restoring respects the plan user limit', async () => {
    const s = await register();
    const basic = await ctx.prisma.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
    await ctx.prisma.subscription.update({
      where: { organizationId: s.orgId },
      data: { planId: basic.id },
    });
    const a = await hire(s);
    const b = await hire(s); // owner + 2 = 3, the BASIC limit
    const first = await memberOf(s.orgId, a.userId);
    await plat(admin)
      .post(`/users/${first.id}/status`, { status: 'DEACTIVATED', reason: 'x x x' })
      .expect(200);
    await hire(s); // takes the free seat
    const over = await plat(admin)
      .post(`/users/${first.id}/status`, { status: 'ACTIVE', reason: 'restore' })
      .expect(409);
    expect(over.body.error.code).toBe('PLAN_LIMIT_REACHED');
    void b;
  });

  it('reset password gives a working temporary password and ends sessions', async () => {
    const s = await register();
    const staff = await hire(s);
    const member = await memberOf(s.orgId, staff.userId);
    const res = await plat(admin)
      .post(`/users/${member.id}/reset-password`, { reason: 'forgot it' })
      .expect(200);
    await shopApi(staff).get('/auth/me').expect(401);
    await http()
      .post('/api/v1/auth/login')
      .send({
        identifier: staff.phone,
        password: res.body.data.temporaryPassword,
        deviceUid: `d-${staff.phone}`,
      })
      .expect(200);
  });

  it('SUPPORT can list and sign people out but cannot edit, remove or reset', async () => {
    const s = await register();
    const staff = await hire(s);
    const member = await memberOf(s.orgId, staff.userId);
    await plat(support).get('/users').expect(200);
    await plat(support)
      .patch(`/users/${member.id}`, { fullName: 'Nope Nope', reason: 'no' })
      .expect(403);
    await plat(support)
      .post(`/users/${member.id}/status`, { status: 'DEACTIVATED', reason: 'no no' })
      .expect(403);
    await plat(support).post(`/users/${member.id}/reset-password`, { reason: 'no no' }).expect(403);
    await plat(support)
      .post(`/users/${member.id}/force-logout`, { reason: 'stolen phone' })
      .expect(200);
    await shopApi(staff).get('/auth/me').expect(401);
  });

  it('a shop token cannot reach the users API', async () => {
    const s = await register();
    await http().get('/admin/v1/users').set('Authorization', `Bearer ${s.token}`).expect(401);
  });

  it('admin accounts: edit name and email, with duplicate protection', async () => {
    const list = (await plat(admin).get('/admins').expect(200)).body.data as {
      id: string;
      email: string;
    }[];
    const target = list.find((x) => x.email.startsWith('support-'))!;
    const other = list.find((x) => x.email.startsWith('admin-'))!;
    const res = await plat(admin)
      .patch(`/admins/${target.id}`, {
        fullName: 'Support Renamed',
        email: `Renamed-${randomUUID()}@Example.com`,
        reason: 'typo',
      })
      .expect(200);
    expect(res.body.data.fullName).toBe('Support Renamed');
    expect(res.body.data.email).toBe(res.body.data.email.toLowerCase());
    await plat(admin)
      .patch(`/admins/${target.id}`, { email: other.email, reason: 'dup' })
      .expect(409);
  });
});
