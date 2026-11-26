import { randomUUID } from 'node:crypto';
import { RetentionService } from '../../src/modules/retention/retention.service';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/** FIXES F4: the retention purge deletes only expired operational rows, in batches, in every shop. */
const suite = testDbUrl() ? describe : describe.skip;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

suite('Retention purge (real database)', () => {
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

  const registerOwner = async () => {
    const phone = uniquePhone();
    const res = await ctx
      .http()
      .post('/api/v1/auth/register-owner')
      .send({
        fullName: 'Owner',
        phone,
        password: 'Str0ng-Pass!',
        shopName: `Shop ${phone}`,
        deviceUid: `device-${phone}`,
      })
      .expect(201);
    return {
      organizationId: res.body.data.organization.id as string,
      userId: res.body.data.user.id,
    };
  };

  /** One old (purgeable) and one fresh row in every table the purge touches. */
  const seed = async (org: { organizationId: string; userId: string }) => {
    const p = ctx.prisma;
    const idem = (expiresAt: Date) =>
      p.idempotencyRecord.create({
        data: {
          organizationId: org.organizationId,
          key: randomUUID(),
          endpoint: 'POST /sales',
          requestHash: 'x',
          status: 'COMPLETED',
          expiresAt,
        },
        select: { id: true },
      });
    const session = (data: { expiresAt: Date; revokedAt?: Date }) =>
      p.userSession.create({
        data: {
          userId: org.userId,
          organizationId: org.organizationId,
          refreshTokenHash: randomUUID(),
          ...data,
        },
        select: { id: true },
      });
    const note = (readAt: Date | null) =>
      p.notification.create({
        data: {
          organizationId: org.organizationId,
          type: 'GENERAL',
          title: 't',
          body: 'b',
          readAt,
        },
        select: { id: true },
      });
    const op = (status: 'DONE' | 'PENDING', serverReceivedAt: Date) =>
      p.syncOperation.create({
        data: {
          organizationId: org.organizationId,
          operationId: randomUUID(),
          deviceId: randomUUID(),
          operationType: 'HELD_BILL_UPLOAD',
          status,
          localCreatedAt: serverReceivedAt,
          serverReceivedAt,
        },
        select: { id: true },
      });

    return {
      gone: [
        await idem(ago(3)),
        await session({ expiresAt: ago(40) }),
        await session({ expiresAt: new Date(Date.now() + DAY), revokedAt: ago(31) }),
        await note(ago(91)),
        await op('DONE', ago(91)),
      ].map((r) => r.id),
      kept: [
        await idem(ago(0.5)), // expired, but still inside the 1-day grace
        await idem(new Date(Date.now() + DAY)),
        await session({ expiresAt: ago(5) }),
        await session({ expiresAt: new Date(Date.now() + DAY), revokedAt: ago(2) }),
        await note(null), // unread notifications are never purged
        await note(ago(10)),
        await op('PENDING', ago(200)), // not finished
        await op('DONE', ago(10)),
      ].map((r) => r.id),
    };
  };

  const exists = async (ids: string[]) => {
    const p = ctx.prisma;
    const found = await Promise.all([
      p.idempotencyRecord.findMany({ where: { id: { in: ids } }, select: { id: true } }),
      p.userSession.findMany({ where: { id: { in: ids } }, select: { id: true } }),
      p.notification.findMany({ where: { id: { in: ids } }, select: { id: true } }),
      p.syncOperation.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    ]);
    return found.flat().map((r) => r.id);
  };

  it('deletes only expired rows, across shops, and is idempotent', async () => {
    const a = await seed(await registerOwner());
    const b = await seed(await registerOwner());
    const auditBefore = await ctx.prisma.auditLog.count();

    const counts = await new RetentionService(ctx.prisma).purge();
    expect(counts.idempotencyRecords).toBeGreaterThanOrEqual(2);
    expect(counts.userSessions).toBeGreaterThanOrEqual(4);
    expect(counts.notifications).toBeGreaterThanOrEqual(2);
    expect(counts.syncOperations).toBeGreaterThanOrEqual(2);

    expect(await exists([...a.gone, ...b.gone])).toEqual([]);
    expect((await exists([...a.kept, ...b.kept])).sort()).toEqual([...a.kept, ...b.kept].sort());
    // Append-only history is untouched.
    expect(await ctx.prisma.auditLog.count()).toBe(auditBefore);

    const again = await new RetentionService(ctx.prisma).purge();
    expect(again).toEqual({
      idempotencyRecords: 0,
      userSessions: 0,
      notifications: 0,
      syncOperations: 0,
    });
  });

  it('works through more rows than one batch', async () => {
    const org = await registerOwner();
    await ctx.prisma.idempotencyRecord.createMany({
      data: Array.from({ length: 2500 }, () => ({
        organizationId: org.organizationId,
        key: randomUUID(),
        endpoint: 'POST /sales',
        requestHash: 'x',
        expiresAt: ago(5),
      })),
    });
    const counts = await new RetentionService(ctx.prisma).purge();
    expect(counts.idempotencyRecords).toBe(2500);
    expect(
      await ctx.prisma.idempotencyRecord.count({ where: { organizationId: org.organizationId } }),
    ).toBe(0);
  });
});
