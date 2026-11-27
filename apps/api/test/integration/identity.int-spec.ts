import { ALL_PERMISSION_KEYS, SYSTEM_ROLE_PERMISSIONS } from '@ksms/constants';
import { createHash } from 'node:crypto';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/**
 * Identity, sessions, invitations, RBAC and tenant isolation against a REAL PostgreSQL schema
 * (all migrations applied, so DB constraints and triggers are active). Runs only when a database URL is available.
 */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

suite('Identity, RBAC and tenant isolation (real database)', () => {
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

  // ---------- helpers ----------
  const api = (token: string, branchId?: string) => {
    const auth = <T extends { set(k: string, v: string): T }>(r: T) => {
      r.set('Authorization', `Bearer ${token}`);
      if (branchId) r.set('x-branch-id', branchId);
      return r;
    };
    const base = '/api/v1';
    return {
      get: (p: string) => auth(ctx.http().get(base + p)),
      post: (p: string, body?: object) => auth(ctx.http().post(base + p)).send(body ?? {}),
      patch: (p: string, body: object) => auth(ctx.http().patch(base + p)).send(body),
      del: (p: string) => auth(ctx.http().delete(base + p)),
    };
  };
  const noSecrets = (text: string) => {
    for (const s of [
      'passwordHash',
      'argon2',
      'codeHash',
      'refreshTokenHash',
      'previousTokenHash',
    ]) {
      expect(text).not.toContain(s);
    }
  };

  interface Session {
    phone: string;
    accessToken: string;
    refreshToken: string;
    organizationId: string;
    userId: string;
    branchId: string;
  }
  const registerOwner = async (over: Record<string, unknown> = {}): Promise<Session> => {
    const phone = uniquePhone();
    const res = await ctx
      .http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Shop Owner',
        phone,
        password: PW,
        shopName: `Shop ${phone}`,
        deviceUid: `device-${phone}`,
        ...over,
      })
      .expect(201);
    noSecrets(res.text);
    const d = res.body.data;
    return {
      phone,
      accessToken: d.accessToken,
      refreshToken: d.refreshToken,
      organizationId: d.organization.id,
      userId: d.user.id,
      branchId: d.branches[0].id,
    };
  };
  const roleId = async (owner: Session, name: string): Promise<string> => {
    const res = await api(owner.accessToken).get('/roles').expect(200);
    return res.body.data.find((r: { name: string }) => r.name === name).id;
  };
  /** Owner invites a person with the given role name; the person accepts. Returns their session. */
  const hire = async (owner: Session, roleName: string, branchIds = [owner.branchId]) => {
    const phone = uniquePhone();
    const inv = await api(owner.accessToken)
      .post('/invitations', { phone, roleId: await roleId(owner, roleName), branchIds })
      .expect(201);
    const res = await ctx
      .http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: inv.body.data.code,
        fullName: `${roleName} Person`,
        password: PW,
        deviceUid: `device-${phone}`,
      })
      .expect(201);
    return {
      phone,
      accessToken: res.body.data.accessToken as string,
      refreshToken: res.body.data.refreshToken as string,
      userId: res.body.data.user.id as string,
      memberId: undefined as string | undefined,
      invitationId: inv.body.data.id as string,
      permissions: res.body.data.permissions as string[],
    };
  };
  const memberIdOf = async (owner: Session, userId: string): Promise<string> => {
    const res = await api(owner.accessToken).get('/employees').expect(200);
    return res.body.data.find((e: { user: { id: string } }) => e.user.id === userId).id;
  };

  // ---------- A. registration ----------
  describe('owner registration', () => {
    it('creates the whole shop in one go: org, roles, permissions, branch, register, number series, categories', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/auth/register-owner')
        .send({
          fullName: 'Ravi Kumar',
          phone: uniquePhone(),
          email: 'Ravi@Example.COM',
          password: PW,
          shopName: 'Ravi Kirana',
          deviceUid: 'device-ravi-001',
          stateCode: '36',
        })
        .expect(201);
      noSecrets(res.text);
      const d = res.body.data;
      expect(d.role.name).toBe('Owner');
      expect(d.permissions).toHaveLength(ALL_PERMISSION_KEYS.length);
      expect(d.branches).toHaveLength(1);
      expect(d.branches[0].code).toBe('MAIN');
      expect(d.user.email).toBe('ravi@example.com'); // normalised
      expect(typeof d.accessToken).toBe('string');
      expect(d.expiresIn).toBe(900);

      const { prisma } = ctx;
      const orgId = d.organization.id as string;
      const roles = await prisma.role.findMany({
        where: { organizationId: orgId },
        include: { _count: { select: { permissions: true } } },
      });
      expect(roles.map((r) => r.name).sort()).toEqual([
        'Cashier',
        'Collection Agent',
        'Manager',
        'Owner',
      ]);
      const count = (n: string) => roles.find((r) => r.name === n)!._count.permissions;
      expect(count('Owner')).toBe(SYSTEM_ROLE_PERMISSIONS.Owner.length);
      expect(count('Cashier')).toBe(SYSTEM_ROLE_PERMISSIONS.Cashier.length);
      expect(count('Collection Agent')).toBe(SYSTEM_ROLE_PERMISSIONS['Collection Agent'].length);
      expect(await prisma.cashRegister.count({ where: { organizationId: orgId } })).toBe(1);
      expect(await prisma.documentSequence.count({ where: { organizationId: orgId } })).toBe(5);
      expect(
        await prisma.expenseCategory.count({ where: { organizationId: orgId } }),
      ).toBeGreaterThanOrEqual(5);
      expect(
        await prisma.auditLog.count({
          where: { organizationId: orgId, action: 'organization.register' },
        }),
      ).toBe(1);
      const branch = await prisma.branch.findFirstOrThrow({ where: { organizationId: orgId } });
      expect(branch.stateCode).toBe('36');
    });

    it('never stores the password or refresh token in readable form', async () => {
      const o = await registerOwner();
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: o.userId } });
      expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(user.passwordHash).not.toContain(PW);
      const session = await ctx.prisma.userSession.findFirstOrThrow({
        where: { userId: o.userId },
      });
      expect(session.refreshTokenHash).toBe(sha256(o.refreshToken));
      expect(session.refreshTokenHash).not.toBe(o.refreshToken);
    });

    it('rejects a duplicate mobile number with 409 and creates nothing extra', async () => {
      const o = await registerOwner();
      const before = await ctx.prisma.organization.count();
      const res = await ctx
        .http()
        .post('/api/v1/auth/register-owner')
        .send({
          fullName: 'Copy',
          phone: o.phone,
          password: PW,
          shopName: 'Copy Shop',
          deviceUid: 'device-copy-001',
        })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(await ctx.prisma.organization.count()).toBe(before); // transaction rolled back, no orphan org
    });

    it.each([
      ['short password', { password: 'short' }],
      ['password without a number', { password: 'onlyletters' }],
      ['password without a letter', { password: '1234567890' }],
      ['unknown shop type', { businessType: 'SPACESHIP' }],
      ['bad phone', { phone: '12345' }],
      ['bad email', { email: 'nope' }],
      ['missing shop name', { shopName: '' }],
      [
        'unknown field (mass assignment)',
        { organizationId: '00000000-0000-4000-8000-000000000000' },
      ],
      ['bad GSTIN', { gstin: '123' }],
    ])('validates input: %s', async (_n, over) => {
      const res = await ctx
        .http()
        .post('/api/v1/auth/register-owner')
        .send({
          fullName: 'X Y',
          phone: uniquePhone(),
          password: PW,
          shopName: 'Shop',
          deviceUid: 'device-val-0001',
          ...over,
        })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts phone formats and normalises them for login', async () => {
      await ctx
        .http()
        .post('/api/v1/auth/register-owner')
        .send({
          fullName: 'Fmt Owner',
          phone: '+91 98765-43211',
          password: PW,
          shopName: 'Fmt Shop',
          deviceUid: 'device-fmt-0001',
        })
        .expect(201);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: '9876543211', password: PW, deviceUid: 'device-fmt-0002' })
        .expect(200);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: '09876543211', password: PW, deviceUid: 'device-fmt-0003' })
        .expect(200);
    });
  });

  // ---------- B. login, refresh, logout ----------
  describe('login, refresh, logout, password change', () => {
    it('logs in by phone and by email', async () => {
      const email = `login${uniquePhone()}@example.com`;
      const o = await registerOwner({ email });
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: o.phone, password: PW, deviceUid: 'device-login-01' })
        .expect(200);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: email.toUpperCase(), password: PW, deviceUid: 'device-login-02' })
        .expect(200);
    });

    it('gives the SAME 401 for wrong password and unknown user (no account enumeration)', async () => {
      const o = await registerOwner();
      const wrong = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: o.phone, password: 'WrongPass1!', deviceUid: 'device-enum-01' })
        .expect(401);
      const unknown = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: '9000000001', password: 'WrongPass1!', deviceUid: 'device-enum-02' })
        .expect(401);
      const strip = (b: { error: { correlationId?: string } }) => ({
        ...b.error,
        correlationId: undefined,
      });
      expect(strip(wrong.body)).toEqual(strip(unknown.body));
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns profile, role, branches and permissions to the app', async () => {
      const o = await registerOwner();
      const res = await api(o.accessToken).get('/auth/me').expect(200);
      expect(res.body.data.user.id).toBe(o.userId);
      expect(res.body.data.organization.id).toBe(o.organizationId);
      expect(res.body.data.permissions).toContain('sale.create');
    });

    it('rotates the refresh token; replaying the OLD one revokes the whole session', async () => {
      const o = await registerOwner();
      const r1 = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: o.refreshToken })
        .expect(200);
      const newRefresh = r1.body.data.refreshToken as string;
      const newAccess = r1.body.data.accessToken as string;
      expect(newRefresh).not.toBe(o.refreshToken);
      await api(newAccess).get('/auth/me').expect(200);

      // attacker (or buggy client) replays the already-used token
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: o.refreshToken })
        .expect(401);
      // ... so the session is dead, including the legitimately rotated tokens
      await api(newAccess).get('/auth/me').expect(401);
      await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: newRefresh }).expect(401);
      const s = await ctx.prisma.userSession.findFirstOrThrow({ where: { userId: o.userId } });
      expect(s.revokedReason).toBe('refresh_token_reuse');
    });

    it('the read cache never outlives logout or deactivation on this instance (F7)', async () => {
      const o = await registerOwner();
      await api(o.accessToken).get('/auth/me').expect(200); // fills the cache
      await api(o.accessToken).get('/auth/me').expect(200); // served from it
      await api(o.accessToken).post('/auth/logout').expect(204);
      await api(o.accessToken).get('/auth/me').expect(401);

      const owner = await registerOwner();
      const cashier = await hire(owner, 'Cashier');
      await api(cashier.accessToken).get('/auth/me').expect(200);
      await api(cashier.accessToken).get('/auth/me').expect(200);
      const memberId = await memberIdOf(owner, cashier.userId);
      await api(owner.accessToken).post(`/employees/${memberId}/deactivate`, {}).expect(200);
      await api(cashier.accessToken).get('/auth/me').expect(401);
    });

    it('a session past its absolute lifetime cannot refresh, even if used yesterday (F5)', async () => {
      const o = await registerOwner();
      const s = await ctx.prisma.userSession.findFirstOrThrow({ where: { userId: o.userId } });
      // Started 91 days ago, refreshed yesterday: the sliding expiry alone would keep it alive.
      await ctx.prisma.userSession.update({
        where: { id: s.id },
        data: {
          createdAt: new Date(Date.now() - 91 * 86_400_000),
          lastUsedAt: new Date(Date.now() - 86_400_000),
          expiresAt: new Date(Date.now() + 29 * 86_400_000),
        },
      });
      await api(o.accessToken).get('/auth/me').expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: o.refreshToken })
        .expect(401);
      const after = await ctx.prisma.userSession.findUniqueOrThrow({ where: { id: s.id } });
      expect(after.revokedReason).toBe('absolute_expiry');
    });

    it('the sliding expiry never passes the absolute cap (F5)', async () => {
      const o = await registerOwner();
      const s = await ctx.prisma.userSession.findFirstOrThrow({ where: { userId: o.userId } });
      const createdAt = new Date(Date.now() - 80 * 86_400_000);
      await ctx.prisma.userSession.update({ where: { id: s.id }, data: { createdAt } });
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: o.refreshToken })
        .expect(200);
      const after = await ctx.prisma.userSession.findUniqueOrThrow({ where: { id: s.id } });
      expect(after.expiresAt.getTime()).toBe(createdAt.getTime() + 90 * 86_400_000);
    });

    it('lets only ONE of two concurrent refreshes with the same token succeed', async () => {
      const o = await registerOwner();
      const results = await Promise.all([
        ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: o.refreshToken }),
        ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: o.refreshToken }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('rejects an expired session on refresh and on API calls', async () => {
      const o = await registerOwner();
      await ctx.prisma.userSession.updateMany({
        where: { userId: o.userId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: o.refreshToken })
        .expect(401);
      await api(o.accessToken).get('/auth/me').expect(401);
    });

    it('logout revokes the session immediately (access and refresh tokens both die)', async () => {
      const o = await registerOwner();
      await api(o.accessToken).post('/auth/logout').expect(204);
      await api(o.accessToken).get('/auth/me').expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: o.refreshToken })
        .expect(401);
    });

    it('changing the password signs out every device and invalidates the old password', async () => {
      const o = await registerOwner();
      const second = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: o.phone, password: PW, deviceUid: 'device-pw-other' })
        .expect(200);
      await api(o.accessToken)
        .post('/auth/change-password', {
          currentPassword: 'nope-nope',
          newPassword: 'Another-Pass1',
        })
        .expect(401);
      await api(o.accessToken)
        .post('/auth/change-password', { currentPassword: PW, newPassword: PW })
        .expect(400);
      await api(o.accessToken)
        .post('/auth/change-password', { currentPassword: PW, newPassword: 'Another-Pass1' })
        .expect(204);

      await api(o.accessToken).get('/auth/me').expect(401);
      await api(second.body.data.accessToken).get('/auth/me').expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: o.phone, password: PW, deviceUid: 'device-pw-3' })
        .expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: o.phone, password: 'Another-Pass1', deviceUid: 'device-pw-4' })
        .expect(200);
    });

    it('registers the device and lets users update only their own device record', async () => {
      const o = await registerOwner();
      const res = await api(o.accessToken)
        .patch('/devices/current', { pushToken: 'fcm-token-abc', appVersion: '0.1.0' })
        .expect(200);
      expect(res.body.data.appVersion).toBe('0.1.0');
      const device = await ctx.prisma.device.findFirstOrThrow({ where: { userId: o.userId } });
      expect(device.pushToken).toBe('fcm-token-abc');
    });
  });

  // ---------- B2. devices (FIXES F1) ----------
  describe('devices: revoke, restore, release', () => {
    const login = (identifier: string, deviceUid: string) =>
      ctx.http().post('/api/v1/auth/login').send({ identifier, password: PW, deviceUid });
    const deviceOf = (o: Session) =>
      ctx.prisma.device.findFirstOrThrow({
        where: { organizationId: o.organizationId, deviceUid: `device-${o.phone}` },
      });

    it('a revoked device cannot sign in again and its sessions end at once', async () => {
      const o = await registerOwner();
      const device = await deviceOf(o);
      const second = await login(o.phone, `device-${o.phone}`).expect(200);

      await api(o.accessToken).post(`/devices/${device.id}/revoke`).expect(200);
      await api(second.body.data.accessToken).get('/auth/me').expect(401);

      const before = await ctx.prisma.userSession.count({ where: { userId: o.userId } });
      const refused = await login(o.phone, `device-${o.phone}`).expect(403);
      expect(refused.body.error.code).toBe('DEVICE_REVOKED');
      expect(await ctx.prisma.userSession.count({ where: { userId: o.userId } })).toBe(before);
      const row = await ctx.prisma.device.findUniqueOrThrow({ where: { id: device.id } });
      expect(row.revokedAt).not.toBeNull();

      // A different phone still works for the same person.
      await login(o.phone, `device-other-${o.phone}`).expect(200);
    });

    it("another user cannot take over someone else's phone record", async () => {
      const o = await registerOwner();
      const cashier = await hire(o, 'Cashier');
      const device = await deviceOf(o);

      const refused = await login(cashier.phone, `device-${o.phone}`).expect(403);
      expect(refused.body.error.code).toBe('DEVICE_OWNED_BY_OTHER');
      const row = await ctx.prisma.device.findUniqueOrThrow({ where: { id: device.id } });
      expect(row.userId).toBe(o.userId);
    });

    it('only the owner path re-enables or releases a phone, and both are audited', async () => {
      const o = await registerOwner();
      const cashier = await hire(o, 'Cashier');
      const device = await deviceOf(o);

      await api(cashier.accessToken).post(`/devices/${device.id}/revoke`).expect(403);
      await api(o.accessToken).post(`/devices/${device.id}/revoke`).expect(200);
      // Revoking ended the owner's own session on that phone; sign in on another one.
      const fresh = await login(o.phone, `device-admin-${o.phone}`).expect(200);
      const owner = api(fresh.body.data.accessToken);

      await owner.post(`/devices/${device.id}/release`).expect(409); // blocked: re-enable first
      const restored = await owner.post(`/devices/${device.id}/restore`).expect(200);
      expect(restored.body.data.revokedAt).toBeNull();
      await login(o.phone, `device-${o.phone}`).expect(200);

      await owner.post(`/devices/${device.id}/release`).expect(200);
      await login(cashier.phone, `device-${o.phone}`).expect(200);
      const listed = await owner.get('/devices').expect(200);
      expect(listed.body.data.map((d: { id: string }) => d.id)).not.toContain(device.id);

      const actions = await ctx.prisma.auditLog.findMany({
        where: { organizationId: o.organizationId, entityId: device.id },
        select: { action: true, actorId: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(actions.map((a) => a.action)).toEqual([
        'device.revoke',
        'device.restore',
        'device.release',
      ]);
      expect(actions.every((a) => a.actorId === o.userId)).toBe(true);
    });

    it("cannot list, revoke or restore another shop's phone (cross-tenant)", async () => {
      const a = await registerOwner();
      const b = await registerOwner();
      const deviceA = await deviceOf(a);

      for (const action of ['revoke', 'restore', 'release']) {
        await api(b.accessToken).post(`/devices/${deviceA.id}/${action}`).expect(404);
      }
      const listed = await api(b.accessToken).get('/devices').expect(200);
      expect(listed.body.data.map((d: { id: string }) => d.id)).not.toContain(deviceA.id);
      const row = await ctx.prisma.device.findUniqueOrThrow({ where: { id: deviceA.id } });
      expect(row.revokedAt).toBeNull();
    });
  });

  // ---------- C. invitations ----------
  describe('invitations', () => {
    it('shows the one-time code once, stores only its hash, and never lists it', async () => {
      const o = await registerOwner();
      const phone = uniquePhone();
      const res = await api(o.accessToken)
        .post('/invitations', {
          phone,
          roleId: await roleId(o, 'Cashier'),
          branchIds: [o.branchId],
        })
        .expect(201);
      expect(res.body.data.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const row = await ctx.prisma.invitation.findUniqueOrThrow({
        where: { id: res.body.data.id },
      });
      expect(row.codeHash).not.toContain(res.body.data.code.replace(/-/g, ''));
      const list = await api(o.accessToken).get('/invitations').expect(200);
      expect(list.text).not.toContain(res.body.data.code);
      noSecrets(list.text);
      expect(list.body.data[0].status).toBe('PENDING');
    });

    it('lets the invitee join with the right role and branch, and the code works only once', async () => {
      const o = await registerOwner();
      const phone = uniquePhone();
      const inv = await api(o.accessToken)
        .post('/invitations', {
          phone,
          roleId: await roleId(o, 'Cashier'),
          branchIds: [o.branchId],
        })
        .expect(201);
      const code = inv.body.data.code as string;
      const body = {
        code: code.toLowerCase(),
        fullName: 'New Cashier',
        password: PW,
        deviceUid: 'device-cashier-1',
      }; // code is case/dash tolerant
      const joined = await ctx.http().post('/api/v1/auth/accept-invitation').send(body).expect(201);
      expect(joined.body.data.role.name).toBe('Cashier');
      expect(joined.body.data.branches.map((b: { id: string }) => b.id)).toEqual([o.branchId]);
      expect([...joined.body.data.permissions].sort()).toEqual(
        [...SYSTEM_ROLE_PERMISSIONS.Cashier].sort(),
      );
      expect(joined.body.data.user.phone).toBe(phone);

      const again = await ctx
        .http()
        .post('/api/v1/auth/accept-invitation')
        .send({ ...body, deviceUid: 'device-cashier-2' })
        .expect(400);
      expect(again.body.error.code).toBe('INVITATION_INVALID');
      const status = (await api(o.accessToken).get('/invitations').expect(200)).body.data[0].status;
      expect(status).toBe('ACCEPTED');
    });

    it('rejects wrong, revoked and expired codes with the same generic error', async () => {
      const o = await registerOwner();
      const make = async () =>
        (
          await api(o.accessToken)
            .post('/invitations', {
              phone: uniquePhone(),
              roleId: await roleId(o, 'Cashier'),
              branchIds: [o.branchId],
            })
            .expect(201)
        ).body.data;
      const accept = (code: string) =>
        ctx
          .http()
          .post('/api/v1/auth/accept-invitation')
          .send({ code, fullName: 'Some One', password: PW, deviceUid: 'device-inv-0001' });

      expect((await accept('AAAA-BBBB-CCCC').expect(400)).body.error.code).toBe(
        'INVITATION_INVALID',
      );

      const revoked = await make();
      await api(o.accessToken).post(`/invitations/${revoked.id}/revoke`).expect(204);
      expect((await accept(revoked.code).expect(400)).body.error.code).toBe('INVITATION_INVALID');

      const expired = await make();
      await ctx.prisma.invitation.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await accept(expired.code).expect(400)).body.error.code).toBe('INVITATION_INVALID');
    });

    it('lets exactly one of two simultaneous acceptances win', async () => {
      const o = await registerOwner();
      const inv = (
        await api(o.accessToken)
          .post('/invitations', {
            phone: uniquePhone(),
            roleId: await roleId(o, 'Cashier'),
            branchIds: [o.branchId],
          })
          .expect(201)
      ).body.data;
      const send = (n: number) =>
        ctx
          .http()
          .post('/api/v1/auth/accept-invitation')
          .send({
            code: inv.code,
            fullName: 'Racer',
            password: PW,
            deviceUid: `device-race-000${n}`,
          });
      const results = await Promise.all([send(1), send(2)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(
        await ctx.prisma.organizationMember.count({ where: { organizationId: o.organizationId } }),
      ).toBe(2); // owner + one hire
    });

    it('refuses owner-role invitations, existing members and a revoke after acceptance', async () => {
      const o = await registerOwner();
      const emp = await hire(o, 'Cashier');
      const ownerRole = await roleId(o, 'Owner');
      expect(
        (
          await api(o.accessToken)
            .post('/invitations', {
              phone: uniquePhone(),
              roleId: ownerRole,
              branchIds: [o.branchId],
            })
            .expect(400)
        ).body.error.code,
      ).toBe('OWNER_ROLE_NOT_ASSIGNABLE');
      expect(
        (
          await api(o.accessToken)
            .post('/invitations', {
              phone: emp.phone,
              roleId: await roleId(o, 'Cashier'),
              branchIds: [o.branchId],
            })
            .expect(409)
        ).body.error.code,
      ).toBe('ALREADY_MEMBER');
      expect(
        (await api(o.accessToken).post(`/invitations/${emp.invitationId}/revoke`).expect(409)).body
          .error.code,
      ).toBe('INVITATION_ALREADY_USED');
    });

    it('supports one person in several shops: existing accounts must prove their password, then pick a shop at login', async () => {
      const shopA = await registerOwner();
      const shopB = await registerOwner();
      // shop B's owner is invited to shop A as a manager
      const inv = (
        await api(shopA.accessToken)
          .post('/invitations', {
            phone: shopB.phone,
            roleId: await roleId(shopA, 'Manager'),
            branchIds: [shopA.branchId],
          })
          .expect(201)
      ).body.data;
      const accept = (password: string) =>
        ctx.http().post('/api/v1/auth/accept-invitation').send({
          code: inv.code,
          fullName: 'Ignored Name',
          password,
          deviceUid: 'device-multi-001',
        });
      expect((await accept('Wrong-Password1').expect(401)).body.error.code).toBe(
        'INVALID_CREDENTIALS',
      );
      await accept(PW).expect(201);

      const ambiguous = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: shopB.phone, password: PW, deviceUid: 'device-multi-002' })
        .expect(409);
      expect(ambiguous.body.error.code).toBe('ORGANIZATION_REQUIRED');
      expect(ambiguous.body.error.details.organizations).toHaveLength(2);
      const chosen = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({
          identifier: shopB.phone,
          password: PW,
          organizationId: shopA.organizationId,
          deviceUid: 'device-multi-003',
        })
        .expect(200);
      expect(chosen.body.data.organization.id).toBe(shopA.organizationId);
      expect(chosen.body.data.role.name).toBe('Manager');
    });
  });

  // ---------- D. RBAC ----------
  describe('role-based access control', () => {
    it('cashiers can use billing-related reads but not administration', async () => {
      const o = await registerOwner();
      const c = await hire(o, 'Cashier');
      await api(c.accessToken).get('/auth/me').expect(200);
      await api(c.accessToken).get('/context').expect(200);
      for (const path of [
        '/employees',
        '/roles',
        '/permissions',
        '/invitations',
        '/organization',
        '/branches',
      ]) {
        const res = await api(c.accessToken).get(path).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      await api(c.accessToken)
        .post('/roles', { name: 'Hack', permissionKeys: ['sale.create'] })
        .expect(403);
      await api(c.accessToken)
        .post('/invitations', {
          phone: uniquePhone(),
          roleId: await roleId(o, 'Cashier'),
          branchIds: [o.branchId],
        })
        .expect(403);
      await api(c.accessToken).patch('/organization', { name: 'Hacked Shop' }).expect(403);
    });

    it('managers can read admin data but cannot change roles, employees or shop settings', async () => {
      const o = await registerOwner();
      const m = await hire(o, 'Manager');
      await api(m.accessToken).get('/employees').expect(200);
      await api(m.accessToken).get('/roles').expect(200);
      await api(m.accessToken).get('/organization').expect(200);
      await api(m.accessToken)
        .post('/roles', { name: 'Mgr Role', permissionKeys: ['product.read'] })
        .expect(403);
      await api(m.accessToken).patch('/organization', { gstEnabled: true }).expect(403);
      await api(m.accessToken).post('/branches', { code: 'NEW', name: 'New' }).expect(403);
    });

    it('collection agents have only the narrow permissions they were given', async () => {
      const o = await registerOwner();
      const a = await hire(o, 'Collection Agent');
      expect([...a.permissions].sort()).toEqual(
        [...SYSTEM_ROLE_PERMISSIONS['Collection Agent']].sort(),
      );
      await api(a.accessToken).get('/employees').expect(403);
    });

    it('custom roles: create, assign, and permission changes take effect immediately', async () => {
      const o = await registerOwner();
      const role = (
        await api(o.accessToken)
          .post('/roles', {
            name: 'Stock Clerk',
            description: 'Views staff',
            permissionKeys: ['employee.read', 'stock.read'],
          })
          .expect(201)
      ).body.data;
      expect(role.isSystem).toBe(false);
      const emp = await hire(o, 'Stock Clerk');
      await api(emp.accessToken).get('/employees').expect(200);
      await api(emp.accessToken).get('/roles').expect(403); // not granted

      await api(o.accessToken)
        .patch(`/roles/${role.id}`, { permissionKeys: ['stock.read'] })
        .expect(200);
      await api(emp.accessToken).get('/employees').expect(403); // revoked right away, not after a cache expiry
    });

    it('blocks privilege escalation: you cannot grant or assign permissions you do not hold', async () => {
      const o = await registerOwner();
      await api(o.accessToken)
        .post('/roles', {
          name: 'Role Admin',
          permissionKeys: [
            'role.manage',
            'role.read',
            'employee.manage',
            'employee.read',
            'invitation.manage',
            'product.read',
          ],
        })
        .expect(201);
      const admin = await hire(o, 'Role Admin');
      const cashier = await hire(o, 'Cashier');
      const cashierMember = await memberIdOf(o, cashier.userId);

      const sneaky = await api(admin.accessToken)
        .post('/roles', { name: 'Sneaky', permissionKeys: ['sale.cancel', 'product.read'] })
        .expect(403);
      expect(sneaky.body.error.code).toBe('PERMISSION_ESCALATION');
      await api(admin.accessToken)
        .post('/roles', { name: 'Harmless', permissionKeys: ['product.read'] })
        .expect(201);

      // cannot hand out the Manager role (it contains permissions this admin lacks)
      const managerRole = await roleId(o, 'Manager');
      expect(
        (
          await api(admin.accessToken)
            .patch(`/employees/${cashierMember}`, { roleId: managerRole })
            .expect(403)
        ).body.error.code,
      ).toBe('PERMISSION_ESCALATION');
      expect(
        (
          await api(admin.accessToken)
            .post('/invitations', {
              phone: uniquePhone(),
              roleId: managerRole,
              branchIds: [o.branchId],
            })
            .expect(403)
        ).body.error.code,
      ).toBe('PERMISSION_ESCALATION');
      // cannot edit an existing role to gain permissions either
      const harmless = (await api(admin.accessToken).get('/roles').expect(200)).body.data.find(
        (r: { name: string }) => r.name === 'Harmless',
      );
      expect(
        (
          await api(admin.accessToken)
            .patch(`/roles/${harmless.id}`, { permissionKeys: ['sale.cancel'] })
            .expect(403)
        ).body.error.code,
      ).toBe('PERMISSION_ESCALATION');
    });

    it('protects the Owner role and system roles, and refuses to delete roles that are in use', async () => {
      const o = await registerOwner();
      const ownerRole = await roleId(o, 'Owner');
      const cashierRole = await roleId(o, 'Cashier');
      expect(
        (
          await api(o.accessToken)
            .patch(`/roles/${ownerRole}`, { permissionKeys: ['product.read'] })
            .expect(403)
        ).body.error.code,
      ).toBe('OWNER_PROTECTED');
      expect(
        (await api(o.accessToken).del(`/roles/${cashierRole}`).expect(403)).body.error.code,
      ).toBe('SYSTEM_ROLE_PROTECTED');
      expect(
        (await api(o.accessToken).patch(`/roles/${cashierRole}`, { name: 'Renamed' }).expect(403))
          .body.error.code,
      ).toBe('SYSTEM_ROLE_PROTECTED');
      await api(o.accessToken)
        .patch(`/roles/${cashierRole}`, { permissionKeys: ['product.read', 'sale.create'] })
        .expect(200); // permissions of system roles are editable

      const custom = (
        await api(o.accessToken)
          .post('/roles', { name: 'Temp Role', permissionKeys: ['product.read'] })
          .expect(201)
      ).body.data;
      await hire(o, 'Temp Role');
      expect(
        (await api(o.accessToken).del(`/roles/${custom.id}`).expect(409)).body.error.code,
      ).toBe('ROLE_IN_USE');
      const unused = (
        await api(o.accessToken).post('/roles', { name: 'Unused', permissionKeys: [] }).expect(201)
      ).body.data;
      await api(o.accessToken).del(`/roles/${unused.id}`).expect(204);
    });

    it('rejects unknown permission keys', async () => {
      const o = await registerOwner();
      const res = await api(o.accessToken)
        .post('/roles', { name: 'Bad', permissionKeys: ['nuke.everything'] })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------- E. employees, deactivation, branches ----------
  describe('employees, deactivation and branches', () => {
    it('deactivation signs the person out at once and blocks login; reactivation restores it', async () => {
      const o = await registerOwner();
      const e = await hire(o, 'Cashier');
      const memberId = await memberIdOf(o, e.userId);
      await api(e.accessToken).get('/context').expect(200);

      const res = await api(o.accessToken)
        .post(`/employees/${memberId}/deactivate`, { reason: 'left the shop' })
        .expect(200);
      expect(res.body.data.status).toBe('DEACTIVATED');
      await api(e.accessToken).get('/context').expect(401); // existing token dies immediately
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: e.refreshToken })
        .expect(401);
      const login = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: e.phone, password: PW, deviceUid: 'device-deact-01' })
        .expect(403);
      expect(login.body.error.code).toBe('NO_ACTIVE_MEMBERSHIP');

      await api(o.accessToken).post(`/employees/${memberId}/reactivate`).expect(200);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: e.phone, password: PW, deviceUid: 'device-deact-02' })
        .expect(200);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { organizationId: o.organizationId, action: 'employee.deactivate' },
      });
      expect(audit.reason).toBe('left the shop');
    });

    it('protects the owner and prevents self-modification', async () => {
      const o = await registerOwner();
      await api(o.accessToken)
        .post('/roles', {
          name: 'People Manager',
          permissionKeys: ['employee.manage', 'employee.read'],
        })
        .expect(201);
      const pm = await hire(o, 'People Manager');
      const ownerMember = await memberIdOf(o, o.userId);
      const pmMember = await memberIdOf(o, pm.userId);
      expect(
        (await api(pm.accessToken).post(`/employees/${ownerMember}/deactivate`).expect(403)).body
          .error.code,
      ).toBe('OWNER_PROTECTED');
      expect(
        (
          await api(pm.accessToken)
            .patch(`/employees/${ownerMember}`, { roleId: await roleId(o, 'Cashier') })
            .expect(403)
        ).body.error.code,
      ).toBe('OWNER_PROTECTED');
      expect(
        (await api(pm.accessToken).post(`/employees/${pmMember}/deactivate`).expect(403)).body.error
          .code,
      ).toBe('CANNOT_MODIFY_SELF');
      expect(
        (
          await api(pm.accessToken)
            .patch(`/employees/${pmMember}`, { branchIds: [o.branchId] })
            .expect(403)
        ).body.error.code,
      ).toBe('CANNOT_MODIFY_SELF');
    });

    it('enforces branch assignment, and owners are auto-assigned to new branches', async () => {
      const o = await registerOwner();
      const godown = (
        await api(o.accessToken)
          .post('/branches', { code: 'GODOWN', name: 'Godown', stateCode: '36' })
          .expect(201)
      ).body.data;
      // new branch got its register and number series
      expect(await ctx.prisma.cashRegister.count({ where: { branchId: godown.id } })).toBe(1);
      expect(await ctx.prisma.documentSequence.count({ where: { branchId: godown.id } })).toBe(5);
      expect(
        (await api(o.accessToken).post('/branches', { code: 'GODOWN', name: 'Dup' }).expect(409))
          .body.error.code,
      ).toBe('CONFLICT');

      await api(o.accessToken, godown.id).get('/context').expect(200); // owner auto-assigned
      const c = await hire(o, 'Cashier', [o.branchId]);
      expect(
        (await api(c.accessToken, godown.id).get('/context').expect(403)).body.error.code,
      ).toBe('BRANCH_FORBIDDEN');

      const cashierMember = await memberIdOf(o, c.userId);
      await api(o.accessToken)
        .patch(`/employees/${cashierMember}`, { branchIds: [o.branchId, godown.id] })
        .expect(200);
      await api(c.accessToken, godown.id).get('/context').expect(200);
      // assigning a branch that does not exist in the shop
      expect(
        (
          await api(o.accessToken)
            .patch(`/employees/${cashierMember}`, {
              branchIds: ['00000000-0000-4000-8000-000000000000'],
            })
            .expect(404)
        ).body.error.code,
      ).toBe('BRANCH_NOT_FOUND');
    });

    it('organization settings: owner can change them, with validation and an audit trail', async () => {
      const o = await registerOwner();
      const res = await api(o.accessToken)
        .patch('/organization', {
          gstEnabled: true,
          maxCashierDiscountPercent: '7.5',
          defaultTaxMode: 'EXCLUSIVE',
        })
        .expect(200);
      expect(res.body.data.gstEnabled).toBe(true);
      expect(res.body.data.maxCashierDiscountPercent).toBe('7.5');
      expect(
        (await api(o.accessToken).get('/organization').expect(200)).body.data.defaultTaxMode,
      ).toBe('EXCLUSIVE');
      await api(o.accessToken)
        .patch('/organization', { maxCashierDiscountPercent: '150' })
        .expect(400);
      expect(
        await ctx.prisma.auditLog.count({
          where: { organizationId: o.organizationId, action: 'organization.update' },
        }),
      ).toBe(1);
    });
  });

  // ---------- F. cross-organization isolation ----------
  describe('cross-organization isolation', () => {
    it('shop A can never read or change shop B data, by any route', async () => {
      const a = await registerOwner();
      const b = await registerOwner();
      const bCashier = await hire(b, 'Cashier');
      const bMember = await memberIdOf(b, bCashier.userId);
      const bRole = await roleId(b, 'Cashier');
      const bCustomRole = (
        await api(b.accessToken)
          .post('/roles', { name: 'B Only', permissionKeys: ['product.read'] })
          .expect(201)
      ).body.data.id as string;
      const bInvitation = (
        await api(b.accessToken)
          .post('/invitations', { phone: uniquePhone(), roleId: bRole, branchIds: [b.branchId] })
          .expect(201)
      ).body.data.id as string;
      const aCashier = await hire(a, 'Cashier');
      const aCashierMember = await memberIdOf(a, aCashier.userId);

      // lists only contain A's own data
      const employees = (await api(a.accessToken).get('/employees').expect(200)).body.data as {
        id: string;
      }[];
      expect(employees.map((e) => e.id)).not.toContain(bMember);
      expect(employees).toHaveLength(2);
      const roles = (await api(a.accessToken).get('/roles').expect(200)).body.data as {
        id: string;
      }[];
      expect(roles.map((r) => r.id)).not.toContain(bCustomRole);
      const invitations = (await api(a.accessToken).get('/invitations').expect(200)).body.data as {
        id: string;
      }[];
      expect(invitations.map((i) => i.id)).not.toContain(bInvitation);
      const branches = (await api(a.accessToken).get('/branches').expect(200)).body.data as {
        id: string;
      }[];
      expect(branches.map((x) => x.id)).toEqual([a.branchId]);

      // direct access to B's ids looks exactly like "does not exist"
      expect(
        (await api(a.accessToken).get(`/employees/${bMember}`).expect(404)).body.error.code,
      ).toBe('NOT_FOUND');
      await api(a.accessToken)
        .patch(`/employees/${bMember}`, { branchIds: [a.branchId] })
        .expect(404);
      await api(a.accessToken).post(`/employees/${bMember}/deactivate`).expect(404);
      await api(a.accessToken).post(`/employees/${bMember}/reactivate`).expect(404);
      await api(a.accessToken).get(`/roles/${bCustomRole}`).expect(404);
      await api(a.accessToken)
        .patch(`/roles/${bCustomRole}`, { permissionKeys: ['sale.create'] })
        .expect(404);
      await api(a.accessToken).del(`/roles/${bCustomRole}`).expect(404);
      await api(a.accessToken).post(`/invitations/${bInvitation}/revoke`).expect(404);
      await api(a.accessToken).patch(`/branches/${b.branchId}`, { name: 'Stolen' }).expect(404);

      // cross-shop references inside A's own operations are refused
      expect(
        (
          await api(a.accessToken)
            .post('/invitations', { phone: uniquePhone(), roleId: bRole, branchIds: [a.branchId] })
            .expect(404)
        ).body.error.code,
      ).toBe('ROLE_NOT_FOUND');
      expect(
        (
          await api(a.accessToken)
            .post('/invitations', {
              phone: uniquePhone(),
              roleId: await roleId(a, 'Cashier'),
              branchIds: [b.branchId],
            })
            .expect(404)
        ).body.error.code,
      ).toBe('BRANCH_NOT_FOUND');
      expect(
        (
          await api(a.accessToken)
            .patch(`/employees/${aCashierMember}`, { roleId: bRole })
            .expect(404)
        ).body.error.code,
      ).toBe('ROLE_NOT_FOUND');
      expect(
        (
          await api(a.accessToken)
            .patch(`/employees/${aCashierMember}`, { branchIds: [b.branchId] })
            .expect(404)
        ).body.error.code,
      ).toBe('BRANCH_NOT_FOUND');
      expect(
        (await api(a.accessToken, b.branchId).get('/context').expect(403)).body.error.code,
      ).toBe('BRANCH_FORBIDDEN');

      // nothing of B changed
      const bAfter = (await api(b.accessToken).get('/employees').expect(200)).body.data as {
        id: string;
        status: string;
      }[];
      expect(bAfter.find((e) => e.id === bMember)!.status).toBe('ACTIVE');
      expect((await api(b.accessToken).get('/branches').expect(200)).body.data[0].name).toBe(
        'Main Branch',
      );
      expect((await api(b.accessToken).get('/invitations').expect(200)).body.data[0].status).toBe(
        'PENDING',
      );
    });

    it("settings changes affect only the caller's shop, and client-supplied org ids are ignored", async () => {
      const a = await registerOwner();
      const b = await registerOwner();
      await api(a.accessToken).patch('/organization', { name: 'Shop A Renamed' }).expect(200);
      const res = await ctx
        .http()
        .get('/api/v1/organization')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('x-organization-id', b.organizationId)
        .query({ organizationId: b.organizationId })
        .expect(200);
      expect(res.body.data.id).toBe(a.organizationId);
      expect((await api(b.accessToken).get('/organization').expect(200)).body.data.name).not.toBe(
        'Shop A Renamed',
      );
      const ctxRes = await api(a.accessToken)
        .get('/context')
        .set('x-organization-id', b.organizationId)
        .expect(200);
      expect(ctxRes.body.data.organizationId).toBe(a.organizationId);
    });

    it('a user in two shops is confined to the shop their session was issued for', async () => {
      const a = await registerOwner();
      const b = await registerOwner();
      const inv = (
        await api(a.accessToken)
          .post('/invitations', {
            phone: b.phone,
            roleId: await roleId(a, 'Cashier'),
            branchIds: [a.branchId],
          })
          .expect(201)
      ).body.data;
      await ctx
        .http()
        .post('/api/v1/auth/accept-invitation')
        .send({ code: inv.code, fullName: 'X Y', password: PW, deviceUid: 'device-two-shops-1' })
        .expect(201);
      // b's owner token (shop B) cannot see shop A even though they belong to it as a cashier
      const employees = (await api(b.accessToken).get('/employees').expect(200)).body.data as {
        user: { id: string };
      }[];
      expect(employees.every((e) => e.user.id === b.userId)).toBe(true);
    });
  });

  // ---------- G. audit & misc ----------
  describe('audit trail and database protections', () => {
    it('records sensitive operations in the append-only audit log', async () => {
      const o = await registerOwner();
      const role = (
        await api(o.accessToken)
          .post('/roles', { name: 'Audited', permissionKeys: ['product.read'] })
          .expect(201)
      ).body.data;
      await api(o.accessToken)
        .patch(`/roles/${role.id}`, { permissionKeys: ['product.read', 'stock.read'] })
        .expect(200);
      await hire(o, 'Audited');
      const actions = (
        await ctx.prisma.auditLog.findMany({
          where: { organizationId: o.organizationId },
          select: { action: true },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'organization.register',
          'role.create',
          'role.update',
          'invitation.create',
          'invitation.accept',
        ]),
      );
    });

    it('the database itself refuses to alter or delete audit history', async () => {
      const o = await registerOwner();
      await expect(
        ctx.prisma.auditLog.deleteMany({ where: { organizationId: o.organizationId } }),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.prisma.auditLog.updateMany({
          where: { organizationId: o.organizationId },
          data: { action: 'tampered' },
        }),
      ).rejects.toThrow(/append-only/);
    });
  });
});

/** Separate app instance with a tiny limit, to prove credential endpoints are rate limited per IP. */
suite('Credential endpoint rate limiting (real database)', () => {
  jest.setTimeout(120_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db, { AUTH_THROTTLE_LIMIT: '3' });
  });
  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  it('answers 429 RATE_LIMITED after repeated login attempts, but not for normal API routes', async () => {
    const attempt = () =>
      ctx.http().post('/api/v1/auth/login').send({
        identifier: '9000000002',
        password: 'Whatever-123',
        deviceUid: 'device-rate-0001',
      });
    for (let i = 0; i < 3; i++) await attempt().expect(401);
    const blocked = await attempt().expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    await ctx.http().get('/api/v1/health').expect(200); // unaffected
  });
});
