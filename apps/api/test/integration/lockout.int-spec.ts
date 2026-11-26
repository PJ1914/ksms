import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/** FIXES F13: database-backed lockout after repeated wrong passwords. */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';

suite('Login lockout (real database)', () => {
  jest.setTimeout(300_000);
  let db: TestSchema;
  let one: IntegrationApp;
  let two: IntegrationApp; // a second API instance on the same database

  beforeAll(async () => {
    db = await createTestSchema();
    one = await createIntegrationApp(db);
    two = await createIntegrationApp(db);
  });
  afterAll(async () => {
    await one?.close();
    await two?.close();
    await db?.drop();
  });

  const register = async () => {
    const phone = uniquePhone();
    const res = await one
      .http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Owner',
        phone,
        password: PW,
        shopName: `Shop ${phone}`,
        deviceUid: `device-${phone}`,
      })
      .expect(201);
    return {
      phone,
      userId: res.body.data.user.id as string,
      orgId: res.body.data.organization.id as string,
      token: res.body.data.accessToken as string,
    };
  };
  const login = (app: IntegrationApp, identifier: string, password: string) =>
    app
      .http()
      .post('/api/v1/auth/login')
      .send({ identifier, password, deviceUid: `d-${identifier}` });
  const wrong = (app: IntegrationApp, identifier: string, times: number) =>
    Array.from({ length: times }).reduce<Promise<unknown>>(
      (p) => p.then(() => login(app, identifier, 'Wrong-Pass1!').expect(401)),
      Promise.resolve(),
    );

  it('locks after 5 wrong passwords, refuses even the right one, and the lock is shared by instances', async () => {
    const o = await register();
    // Failures spread over both instances still add up.
    await wrong(one, o.phone, 3);
    await wrong(two, o.phone, 2);
    const refused = await login(two, o.phone, PW).expect(401);
    const user = await one.prisma.user.findUniqueOrThrow({ where: { id: o.userId } });
    expect(user.failedLoginCount).toBe(5);
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Locked, unknown and wrong-password answers are indistinguishable.
    const unknown = await login(one, uniquePhone(), PW).expect(401);
    const plainWrong = await login(one, (await register()).phone, 'Wrong-Pass1!').expect(401);
    const shape = (b: { error: Record<string, unknown> }) => ({
      ...b.error,
      correlationId: undefined,
    });
    for (const r of [unknown, plainWrong]) {
      expect(r.status).toBe(refused.status);
      expect(shape(r.body)).toEqual(shape(refused.body));
    }

    const audits = await one.prisma.auditLog.findMany({
      where: { organizationId: o.orgId, action: 'user.login_locked' },
    });
    expect(audits).toHaveLength(1);
  });

  it('the lock expires on its own, and a successful login resets the counter', async () => {
    const o = await register();
    await wrong(one, o.phone, 5);
    await login(one, o.phone, PW).expect(401);
    await one.prisma.user.update({
      where: { id: o.userId },
      data: { lockedUntil: new Date(Date.now() - 1000) }, // the minute has passed
    });
    await login(one, o.phone, PW).expect(200);
    const user = await one.prisma.user.findUniqueOrThrow({ where: { id: o.userId } });
    expect(user).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it('the owner can unlock an employee at once; another shop cannot (cross-tenant)', async () => {
    const owner = await register();
    const other = await register();
    const roles = await one
      .http()
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const cashierRole = roles.body.data.find((r: { name: string }) => r.name === 'Cashier').id;
    const phone = uniquePhone();
    const inv = await one
      .http()
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phone, roleId: cashierRole, branchIds: [] })
      .then((r) => r);
    const branchId = (
      await one.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${owner.token}`)
    ).body.data.branches[0].id;
    const invitation =
      inv.status === 201
        ? inv
        : await one
            .http()
            .post('/api/v1/invitations')
            .set('Authorization', `Bearer ${owner.token}`)
            .send({ phone, roleId: cashierRole, branchIds: [branchId] })
            .expect(201);
    await one
      .http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: invitation.body.data.code,
        fullName: 'Cashier',
        password: PW,
        deviceUid: `c-${phone}`,
      })
      .expect(201);

    await wrong(one, phone, 5);
    await login(one, phone, PW).expect(401);
    const employees = await one
      .http()
      .get('/api/v1/employees')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const memberId = employees.body.data.find(
      (e: { user: { phone: string } }) => e.user.phone === phone,
    ).id;

    await one
      .http()
      .post(`/api/v1/employees/${memberId}/unlock-login`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    await login(one, phone, PW).expect(401); // still locked

    await one
      .http()
      .post(`/api/v1/employees/${memberId}/unlock-login`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    await login(one, phone, PW).expect(200);
    expect(
      await one.prisma.auditLog.count({
        where: { organizationId: owner.orgId, action: 'employee.unlock_login' },
      }),
    ).toBe(1);
  });

  it('a per-identifier limit applies across IPs (throttler)', async () => {
    const limited = await createIntegrationApp(db, { AUTH_THROTTLE_LIMIT: '3' });
    try {
      const id = uniquePhone();
      for (let i = 0; i < 3; i++) {
        await limited
          .http()
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', `10.0.0.${i}`)
          .send({ identifier: id, password: 'x', deviceUid: 'device-throttle' })
          .expect(401);
      }
      await limited
        .http()
        .post('/api/v1/auth/login')
        .send({ identifier: id, password: 'x', deviceUid: 'device-throttle' })
        .expect(429);
    } finally {
      await limited.close();
    }
  });
});
