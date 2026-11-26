import { randomUUID } from 'node:crypto';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/** FIXES F15: an Idempotency-Key is replayed only to the user who first used it, with the right status. */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';

suite('Idempotency scope (real database)', () => {
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

  const as = (token: string, branchId: string) => ({
    post: (path: string, body: object, key?: string) => {
      const r = ctx
        .http()
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-branch-id', branchId);
      if (key) r.set('Idempotency-Key', key);
      return r.send(body);
    },
    get: (path: string) =>
      ctx
        .http()
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-branch-id', branchId),
  });

  const setup = async () => {
    const phone = uniquePhone();
    const reg = await ctx
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
    const d = reg.body.data;
    const owner = as(d.accessToken, d.branches[0].id);
    const roles = (await owner.get('/roles').expect(200)).body.data as {
      id: string;
      name: string;
    }[];
    const mPhone = uniquePhone();
    const inv = await owner
      .post('/invitations', {
        phone: mPhone,
        roleId: roles.find((r) => r.name === 'Manager')!.id,
        branchIds: [d.branches[0].id],
      })
      .expect(201);
    const joined = await ctx
      .http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: inv.body.data.code,
        fullName: 'Manager',
        password: PW,
        deviceUid: `d-${mPhone}`,
      })
      .expect(201);
    const manager = as(joined.body.data.accessToken, d.branches[0].id);
    const categories = (await owner.get('/expense-categories').expect(200)).body.data as {
      id: string;
    }[];
    return { owner, manager, orgId: d.organization.id as string, categoryId: categories[0]!.id };
  };

  it("another user's key is refused (422), never answered with the first user's result", async () => {
    const { owner, manager, categoryId } = await setup();
    const key = randomUUID();
    const body = { categoryId, amount: '150.00', method: 'CASH', description: 'Tea' };
    const first = await owner.post('/expenses', body, key).expect(201);
    // Same user, same key, same body: replayed once, not recorded twice.
    const again = await owner.post('/expenses', body, key).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.data.id).toBe(first.body.data.id);

    const stolen = await manager.post('/expenses', body, key).expect(422);
    expect(stolen.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(JSON.stringify(stolen.body)).not.toContain(first.body.data.id);

    const list = (await owner.get('/expenses').expect(200)).body.data as unknown[];
    expect(list).toHaveLength(1);
  });

  it('a 200 endpoint stores and replays with status 200', async () => {
    const { owner, orgId, categoryId } = await setup();
    const made = await owner
      .post('/expenses', { categoryId, amount: '10.00', method: 'CASH' }, randomUUID())
      .expect(201);
    const key = randomUUID();
    await owner
      .post(`/expenses/${made.body.data.id}/cancel`, { reason: 'Typed twice' }, key)
      .expect(200);
    const replay = await owner
      .post(`/expenses/${made.body.data.id}/cancel`, { reason: 'Typed twice' }, key)
      .expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const record = await ctx.prisma.idempotencyRecord.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: orgId, key } },
    });
    expect(record.responseStatus).toBe(200);
    expect(record.userId).not.toBeNull();
  });
});
