import { randomUUID } from 'node:crypto';
import { descendantCategoryIds } from '../../src/modules/catalog/category-tree';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/** FIXES F11: the recursive query returns exactly what the old in-memory walk returned. */
const suite = testDbUrl() ? describe : describe.skip;

/** The implementation it replaced, kept here as the reference. */
function oldWalk(all: { id: string; parentId: string | null }[], rootId: string): string[] {
  const result = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of all) {
      if (row.parentId && result.has(row.parentId) && !result.has(row.id)) {
        result.add(row.id);
        grew = true;
      }
    }
  }
  return [...result];
}

suite('Category tree (real database)', () => {
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

  const shop = async () => {
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
    return res.body.data.organization.id as string;
  };
  const cat = (organizationId: string, name: string, parentId: string | null, deleted = false) =>
    ctx.prisma.productCategory
      .create({
        data: { organizationId, name, parentId, deletedAt: deleted ? new Date() : null },
        select: { id: true },
      })
      .then((c) => c.id);

  it('matches the old walk for nested, empty and deleted-child trees, and stays in its shop', async () => {
    const org = await shop();
    const other = await shop();
    const food = await cat(org, 'Food', null);
    const grains = await cat(org, 'Grains', food);
    const rice = await cat(org, 'Rice', grains);
    await cat(org, 'Basmati', rice);
    const gone = await cat(org, 'Old', food, true); // deleted: it and its subtree are not reached
    await cat(org, 'Under old', gone);
    const empty = await cat(org, 'Empty', null);
    // Another shop's category pointing at this shop's root must never be returned.
    await ctx.prisma.productCategory.create({
      data: { organizationId: other, name: 'Intruder', parentId: food },
    });

    const all = await ctx.prisma.productCategory.findMany({
      where: { organizationId: org, deletedAt: null },
      select: { id: true, parentId: true },
    });
    for (const root of [food, grains, rice, empty, gone, randomUUID()]) {
      const now = await descendantCategoryIds(ctx.prisma, org, root);
      expect(now.sort()).toEqual(oldWalk(all, root).sort());
    }
    // Food, Grains, Rice, Basmati: the other shop's "Intruder" child is not included.
    expect((await descendantCategoryIds(ctx.prisma, org, food)).length).toBe(4);
    const intruder = await ctx.prisma.productCategory.findFirstOrThrow({
      where: { organizationId: other },
      select: { id: true },
    });
    expect(await descendantCategoryIds(ctx.prisma, org, food)).not.toContain(intruder.id);
  });
});
