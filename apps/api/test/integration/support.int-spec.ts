import { randomUUID } from 'node:crypto';
import { SessionCache } from '../../src/common/auth/session-cache';
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

/** ADMIN_PANEL.md Phase D against a real database: tickets, notes, contact, locked shops, roles. */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';

suite('Support tickets (real database)', () => {
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
  const shop = (s: Shop) => ({
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
  const raise = (s: Shop, subject = 'Printer not working') =>
    shop(s).post('/support/tickets', {
      category: 'BUG',
      subject,
      message: 'It prints blank pages',
    });

  it('the full loop: raise, reply, internal note never leaks, notification, shop reply reopens', async () => {
    const s = await register();
    const created = await raise(s).expect(201);
    const id = created.body.data.id as string;
    expect(created.body.data.label).toMatch(/^T-\d{6}$/);

    const queue = await plat(support).get(`/tickets?orgId=${s.orgId}`).expect(200);
    expect(queue.body.data.map((t: { id: string }) => t.id)).toContain(id);

    await plat(support)
      .post(`/tickets/${id}/messages`, { body: 'secret: owner sounds angry', internalNote: true })
      .expect(201);
    await plat(support)
      .post(`/tickets/${id}/messages`, { body: 'Please restart the printer' })
      .expect(201);

    const thread = await shop(s).get(`/support/tickets/${id}`).expect(200);
    expect(thread.body.data.status).toBe('WAITING_CUSTOMER');
    const bodies = (thread.body.data.messages as { body: string }[]).map((m) => m.body);
    expect(bodies).toEqual(['It prints blank pages', 'Please restart the printer']);
    expect(JSON.stringify(thread.body)).not.toContain('secret');

    const notes = await shop(s).get('/notifications').expect(200);
    expect(JSON.stringify(notes.body.data)).toContain('Support replied');

    await plat(support).post(`/tickets/${id}/status`, { status: 'RESOLVED' }).expect(200);
    await shop(s).post(`/support/tickets/${id}/messages`, { body: 'Still broken' }).expect(201);
    expect((await shop(s).get(`/support/tickets/${id}`).expect(200)).body.data.status).toBe(
      'IN_PROGRESS',
    );

    await plat(admin).post(`/tickets/${id}/status`, { status: 'CLOSED' }).expect(200);
    const closed = await shop(s)
      .post(`/support/tickets/${id}/messages`, { body: 'hello?' })
      .expect(409);
    expect(closed.body.error.code).toBe('TICKET_CLOSED');
  });

  it('a LOCKED shop can still raise and read tickets and see the contact', async () => {
    await plat(admin)
      .patch('/support-settings', {
        phone: '+919876543210',
        whatsapp: '919876543210',
        hours: 'Mon-Sat 9-7',
      })
      .expect(200);
    const s = await register();
    await ctx.prisma.organization.update({
      where: { id: s.orgId },
      data: { lockStatus: 'LOCKED', lockedAt: new Date() },
    });
    ctx.app.get(SessionCache).reset();
    await shop(s).get('/customers').expect(403);
    const contact = await shop(s).get('/support/contact').expect(200);
    expect(contact.body.data.phone).toBe('+919876543210');
    expect(contact.body.data.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    const t = await raise(s, 'My shop is locked').expect(201);
    await shop(s).get(`/support/tickets/${t.body.data.id}`).expect(200);
    await shop(s)
      .post('/support/callback', { phone: uniquePhone(), window: 'Today 4-6 pm' })
      .expect(201);
    const me = await shop(s).get('/auth/me').expect(200);
    expect(me.body.data.supportContact.whatsapp).toBe('919876543210');
  });

  it('cross-tenant: a shop never sees another shop’s tickets', async () => {
    const a = await register();
    const b = await register();
    const t = await raise(a).expect(201);
    await shop(b).get(`/support/tickets/${t.body.data.id}`).expect(404);
    const list = await shop(b).get('/support/tickets').expect(200);
    expect(list.body.data).toEqual([]);
  });

  it('staff cannot raise tickets until the owner grants support.create', async () => {
    const s = await register();
    const roles = (await shop(s).get('/roles').expect(200)).body.data as {
      id: string;
      name: string;
    }[];
    const phone = uniquePhone();
    const inv = await shop(s)
      .post('/invitations', {
        phone,
        roleId: roles.find((r) => r.name === 'Cashier')!.id,
        branchIds: [s.branchId],
      })
      .expect(201);
    const joined = await http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: inv.body.data.code,
        fullName: 'Cashier',
        password: PW,
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    const cashier = { ...s, token: joined.body.data.accessToken as string };
    await raise(cashier).expect(403);
    await shop(cashier).get('/support/contact').expect(200);
  });

  it('SUPPORT replies but cannot change the support settings; rate limit stops ticket floods', async () => {
    await plat(support).patch('/support-settings', { phone: '+910000000000' }).expect(403);
    await plat(support).get('/support-settings').expect(200);
    const s = await register();
    for (let i = 0; i < 10; i++) await raise(s, `Ticket number ${i}`).expect(201);
    const over = await raise(s, 'One too many').expect(429);
    expect(over.body.error.code).toBe('TICKET_RATE_LIMITED');
  });

  it('ticket messages are append-only and the dashboard counts open tickets', async () => {
    const s = await register();
    const t = await raise(s).expect(201);
    await expect(
      ctx.prisma.ticketMessage.updateMany({
        where: { ticketId: t.body.data.id },
        data: { body: 'x' },
      }),
    ).rejects.toThrow(/append-only/);
    const dash = await plat(support).get('/dashboard').expect(200);
    expect(dash.body.data.openTickets.NORMAL).toBeGreaterThan(0);
    expect(dash.body.data.revenue).toBeNull(); // SUPPORT sees no money
    expect((await plat(admin).get('/dashboard').expect(200)).body.data.revenue).toEqual(
      expect.any(Array),
    );
  });
});
