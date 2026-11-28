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

/** Phase A of ADMIN_PANEL.md against a real database: identity, MFA, sessions, roles, audit. */
const suite = testDbUrl() ? describe : describe.skip;
const NEW_PW = 'Admin-Str0ng-Pass!';

suite('Platform plane (real database)', () => {
  jest.setTimeout(300_000);
  let db: TestSchema;
  let one: IntegrationApp;

  beforeAll(async () => {
    db = await createTestSchema();
    one = await createIntegrationApp(db);
  });
  afterAll(async () => {
    await one?.close();
    await db?.drop();
  });

  const http = () => one.http();
  let seq = 0;
  /** Creates an admin the way the CLI does (no creator). */
  const bootstrap = async (role: 'ADMIN' | 'SUPPORT' = 'ADMIN') => {
    const email = `admin${++seq}-${Date.now()}@example.com`;
    const { admin, temporaryPassword } = await one.app
      .get(PlatformAdminsService)
      .create(null, { email, fullName: `Admin ${seq}`, role }, {});
    return { id: admin.id, email, password: temporaryPassword };
  };
  const login = (email: string, password: string) =>
    http().post('/admin/v1/auth/login').send({ email, password });

  /** A code for a step that has not been used yet (the server refuses replays within a step). */
  const codeFor = (secret: string, offset = 0) =>
    totpAt(base32Decode(secret), stepAt(Date.now()) + offset);

  /** Full first sign-in: password → enrol → confirm → change temporary password. */
  const enrol = async (who: { email: string; password: string }) => {
    const step1 = await login(who.email, who.password).expect(200);
    expect(step1.body.data.step).toBe('MFA_SETUP');
    const mfaToken = step1.body.data.mfaToken as string;
    const setup = await http().post('/admin/v1/auth/mfa/setup').send({ mfaToken }).expect(200);
    const secret = setup.body.data.secret as string;
    expect(setup.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const confirm = await http()
      .post('/admin/v1/auth/mfa/confirm')
      .send({ mfaToken, code: codeFor(secret, -1) })
      .expect(200);
    const recoveryCodes = confirm.body.data.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);
    const token = confirm.body.data.accessToken as string;
    // Temporary password: everything but me/change-password/logout is refused.
    const pending = await http()
      .get('/admin/v1/audit')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(pending.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await http()
      .post('/admin/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: who.password, newPassword: NEW_PW })
      .expect(200);
    return { secret, recoveryCodes, token, refreshToken: confirm.body.data.refreshToken as string };
  };

  /** Sign in again later with password + a fresh code. */
  const signIn = async (email: string, secret: string, offset = 0) => {
    const s1 = await login(email, NEW_PW).expect(200);
    expect(s1.body.data.step).toBe('MFA_VERIFY');
    const res = await http()
      .post('/admin/v1/auth/mfa/verify')
      .send({ mfaToken: s1.body.data.mfaToken, code: codeFor(secret, offset) });
    return res;
  };

  it('first sign-in forces MFA enrolment and a password change; the secret is stored encrypted', async () => {
    const a = await bootstrap();
    const { secret, token } = await enrol(a);
    const me = await http().get('/admin/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.data).toMatchObject({
      email: a.email,
      role: 'ADMIN',
      mustChangePassword: false,
    });

    const row = await one.prisma.platformAdmin.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.mfaSecretEnc).not.toContain(secret);
    expect(row.mfaSecretEnc!.startsWith('v1.')).toBe(true);
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);

    const actions = (
      await one.prisma.platformAuditLog.findMany({
        where: { adminId: a.id },
        select: { action: true },
      })
    ).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'admin.bootstrap',
        'auth.mfa_enrolled',
        'auth.login',
        'auth.password_changed',
      ]),
    );
  });

  it('an admin cannot get a session without the second factor', async () => {
    const a = await bootstrap();
    const s1 = await login(a.email, a.password).expect(200);
    expect(s1.body.data.accessToken).toBeUndefined();
    await http()
      .get('/admin/v1/me')
      .set('Authorization', `Bearer ${s1.body.data.mfaToken}`)
      .expect(401);
  });

  it('wrong password and unknown email answer the same', async () => {
    const a = await bootstrap();
    const wrong = await login(a.email, 'nope-nope-nope').expect(401);
    const unknown = await login('nobody@example.com', 'nope-nope-nope').expect(401);
    expect(wrong.body.error.code).toBe(unknown.body.error.code);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('a TOTP code cannot be replayed, and codes outside ±1 step are refused', async () => {
    const a = await bootstrap();
    const { secret } = await enrol(a);
    expect((await signIn(a.email, secret, 0)).status).toBe(200); // uses the current step
    expect((await signIn(a.email, secret, 0)).status).toBe(401); // same step again
    expect((await signIn(a.email, secret, -1)).status).toBe(401); // older step after a newer one
    const far = await signIn(a.email, secret, 5);
    expect(far.status).toBe(401);
    expect(far.body.error.code).toBe('MFA_INVALID');
  });

  it('recovery codes work once each', async () => {
    const a = await bootstrap();
    const { recoveryCodes } = await enrol(a);
    const use = async (code: string) => {
      const s1 = await login(a.email, NEW_PW).expect(200);
      return http()
        .post('/admin/v1/auth/mfa/verify')
        .send({ mfaToken: s1.body.data.mfaToken, recoveryCode: code });
    };
    expect((await use(recoveryCodes[0]!.toLowerCase())).status).toBe(200);
    expect((await use(recoveryCodes[0]!)).status).toBe(401);
    expect((await use(recoveryCodes[1]!)).status).toBe(200);
  });

  it('locks after 5 failures, in the database, and refuses even the right password while locked', async () => {
    const a = await bootstrap();
    const { secret } = await enrol(a);
    for (let i = 0; i < 5; i++) await login(a.email, 'Wrong-Pass-123').expect(401);
    const row = await one.prisma.platformAdmin.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    await login(a.email, NEW_PW).expect(401); // locked: same answer as a wrong password
    // A second API instance sees the same lock (state is in the DB, survives restarts).
    const two = await createIntegrationApp(db);
    try {
      await two
        .http()
        .post('/admin/v1/auth/login')
        .send({ email: a.email, password: NEW_PW })
        .expect(401);
    } finally {
      await two.close();
    }
    await one.prisma.platformAdmin.update({
      where: { id: a.id },
      data: { lockedUntil: null, failedLoginCount: 0 },
    });
    expect((await signIn(a.email, secret, 1)).status).toBe(200);
  });

  it('refresh rotates; reusing an old refresh token revokes the session', async () => {
    const a = await bootstrap();
    const { refreshToken, token } = await enrol(a);
    const r1 = await http().post('/admin/v1/auth/refresh').send({ refreshToken }).expect(200);
    await http().post('/admin/v1/auth/refresh').send({ refreshToken }).expect(401); // reuse
    await http()
      .post('/admin/v1/auth/refresh')
      .send({ refreshToken: r1.body.data.refreshToken })
      .expect(401); // whole session revoked
    await http().get('/admin/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('SUPPORT is kept out of ADMIN routes and sees only its own audit entries', async () => {
    const boss = await bootstrap('ADMIN');
    const bossSession = await enrol(boss);
    const helper = await bootstrap('SUPPORT');
    const { token } = await enrol(helper);
    const auth = `Bearer ${token}`;
    await http().get('/admin/v1/admins').set('Authorization', auth).expect(403);
    await http()
      .post('/admin/v1/admins')
      .set('Authorization', auth)
      .send({ email: 'x@example.com', fullName: 'X', role: 'ADMIN' })
      .expect(403);
    const audit = await http()
      .get(`/admin/v1/audit?adminId=${boss.id}`)
      .set('Authorization', auth)
      .expect(200);
    const rows = audit.body.data as { adminId: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.adminId === helper.id)).toBe(true);
    const all = await http()
      .get(`/admin/v1/audit?adminId=${boss.id}`)
      .set('Authorization', `Bearer ${bossSession.token}`)
      .expect(200);
    expect((all.body.data as { adminId: string }[]).every((r) => r.adminId === boss.id)).toBe(true);
  });

  it('ADMIN manages admins; the last active ADMIN cannot be removed; self-change is refused', async () => {
    // Make boss the only active ADMIN in this schema before testing the rule.
    const boss = await bootstrap('ADMIN');
    const { token } = await enrol(boss);
    const auth = `Bearer ${token}`;
    await one.prisma.platformAdmin.updateMany({
      where: { id: { not: boss.id }, role: 'ADMIN' },
      data: { isActive: false },
    });

    const created = await http()
      .post('/admin/v1/admins')
      .set('Authorization', auth)
      .send({ email: `New.Person${Date.now()}@Example.com`, fullName: 'New Person', role: 'ADMIN' })
      .expect(201);
    const newId = created.body.data.admin.id as string;
    expect(created.body.data.admin.email).toBe(created.body.data.admin.email.toLowerCase());
    expect(typeof created.body.data.temporaryPassword).toBe('string');
    expect(created.body.data.admin.passwordHash).toBeUndefined();

    // Two ADMINs: demoting the new one is fine; then boss is the last one.
    await http()
      .patch(`/admin/v1/admins/${newId}`)
      .set('Authorization', auth)
      .send({ role: 'SUPPORT', reason: 'moving to support' })
      .expect(200);
    const self = await http()
      .patch(`/admin/v1/admins/${boss.id}`)
      .set('Authorization', auth)
      .send({ isActive: false, reason: 'test' })
      .expect(400);
    expect(self.body.error.code).toBe('CANNOT_CHANGE_SELF');

    // Boss is now the only active ADMIN: nobody may disable or demote them.
    const svc = one.app.get(PlatformAdminsService);
    await expect(
      svc.update(
        { adminId: newId, sessionId: newId, role: 'ADMIN' },
        boss.id,
        { isActive: false, reason: 'try to remove the last admin' },
        {},
      ),
    ).rejects.toMatchObject({ code: 'LAST_ADMIN' });

    // Reset MFA and password are audited with the reason.
    await http()
      .post(`/admin/v1/admins/${newId}/reset-mfa`)
      .set('Authorization', auth)
      .send({ reason: 'lost phone' })
      .expect(200);
    const reset = await http()
      .post(`/admin/v1/admins/${newId}/reset-password`)
      .set('Authorization', auth)
      .send({ reason: 'forgot password' })
      .expect(200);
    expect(typeof reset.body.data.temporaryPassword).toBe('string');
    const reasons = await one.prisma.platformAuditLog.findMany({
      where: {
        entityId: newId,
        action: { in: ['admin.reset_mfa', 'admin.reset_password', 'admin.update'] },
      },
      select: { reason: true },
    });
    expect(reasons.map((r) => r.reason).sort()).toEqual([
      'forgot password',
      'lost phone',
      'moving to support',
    ]);
  });

  it('the platform audit log is append-only (trigger)', async () => {
    const a = await bootstrap();
    await expect(
      one.prisma.platformAuditLog.updateMany({
        where: { adminId: a.id },
        data: { reason: 'edited' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      one.prisma.platformAuditLog.deleteMany({ where: { adminId: a.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it('shop users and admins stay apart: a shop token gets nothing from /admin/v1', async () => {
    const phone = uniquePhone();
    const res = await http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Owner',
        phone,
        password: 'Str0ng-Pass!',
        shopName: `Shop ${phone}`,
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    const shopToken = res.body.data.accessToken as string;
    await http().get('/admin/v1/me').set('Authorization', `Bearer ${shopToken}`).expect(401);
    await http().get('/admin/v1/audit').set('Authorization', `Bearer ${shopToken}`).expect(401);
  });
});
