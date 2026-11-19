import { randomUUID } from 'node:crypto';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';

/** Phase 11 audit probes: rules that must hold even when requests race or the database is touched directly. */
suite('Collections audit probes (real database)', () => {
  jest.setTimeout(900_000);
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

  async function setupShop() {
    const phone = uniquePhone();
    const reg = await ctx
      .http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Owner',
        phone,
        password: PW,
        shopName: 'Audit Collections',
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    const x = reg.body.data;
    const token = x.accessToken as string;
    const branchId = x.branches[0].id as string;
    const call = <T extends { set(k: string, v: string): T }>(r: T) =>
      r.set('Authorization', `Bearer ${token}`).set('x-branch-id', branchId);
    return {
      userId: x.user.id as string,
      organizationId: x.organization.id as string,
      branchId,
      get: (p: string) => call(ctx.http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        call(ctx.http().post(`/api/v1${p}`))
          .set('idempotency-key', randomUUID())
          .send(body),
    };
  }

  it('one login can be linked to only ONE collection agent, even when created at the same moment', async () => {
    const s = await setupShop();
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        s.post('/collection-agents', { name: `Agent ${i}`, userId: s.userId }),
      ),
    );
    const statuses = results.map((r: { status: number }) => r.status).sort();
    expect(statuses.filter((c: number) => c === 201)).toHaveLength(1);
    expect(statuses.filter((c: number) => c >= 500)).toHaveLength(0);
  });

  it('the database refuses a second active collector for a customer and a second agent for a login', async () => {
    const s = await setupShop();
    const a1 = await s.post('/collection-agents', { name: 'First' }).expect(201);
    const a2 = await s.post('/collection-agents', { name: 'Second' }).expect(201);
    const c = await s.post('/customers', { name: 'Ravi', phone: uniquePhone() }).expect(201);
    await s
      .post(`/collection-agents/${a1.body.data.id}/assignments`, { customerId: c.body.data.id })
      .expect(201);

    const attempt = (sql: string) => ctx.prisma.$executeRawUnsafe(sql);
    await expect(
      attempt(
        `INSERT INTO collection_assignments (id, organization_id, agent_id, customer_id, status, start_date, updated_at)
         VALUES (gen_random_uuid(), '${s.organizationId}', '${a2.body.data.id}', '${c.body.data.id}', 'ACTIVE', current_date, now())`,
      ),
    ).rejects.toThrow();

    await s.post('/collection-agents', { name: 'Linked', userId: s.userId }).expect(201);
    await expect(
      attempt(
        `INSERT INTO collection_agents (id, organization_id, user_id, name, is_active, updated_at)
         VALUES (gen_random_uuid(), '${s.organizationId}', '${s.userId}', 'Twin', true, now())`,
      ),
    ).rejects.toThrow();
  });
});
