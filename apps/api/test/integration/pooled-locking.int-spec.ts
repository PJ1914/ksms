import { PrismaPg } from '@prisma/adapter-pg';
import { TRANSACTION_OPTIONS } from '../../src/database/prisma.service';
import { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Risk R-07: do row locks, conditional updates and advisory locks stay correct through the
 * connection URL the running API uses (Neon's PgBouncer pooler in transaction mode)?
 * Runs only when DATABASE_URL is set. Uses its own temporary table and drops it afterwards.
 */
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('Concurrency guarantees through DATABASE_URL (R-07)', () => {
  jest.setTimeout(120_000);
  let prisma: PrismaClient;
  const table = `_ksms_lock_test_${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
      transactionOptions: TRANSACTION_OPTIONS, // same settings the API uses
    });
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "${table}" (id int PRIMARY KEY, counter int NOT NULL, stock int NOT NULL, adv int NOT NULL)`,
    );
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`);
    await prisma.$disconnect();
  });
  const reset = (stock: number) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "${table}" (id, counter, stock, adv) VALUES (1, 0, ${stock}, 0)
       ON CONFLICT (id) DO UPDATE SET counter = 0, stock = ${stock}, adv = 0`,
    );
  const row = async () =>
    (
      await prisma.$queryRawUnsafe<{ counter: number; stock: number; adv: number }[]>(
        `SELECT counter, stock, adv FROM "${table}" WHERE id = 1`,
      )
    )[0]!;

  it('SELECT ... FOR UPDATE serializes read-modify-write (no lost updates)', async () => {
    await reset(0);
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, () =>
        prisma.$transaction(async (tx) => {
          const [r] = await tx.$queryRawUnsafe<{ counter: number }[]>(
            `SELECT counter FROM "${table}" WHERE id = 1 FOR UPDATE`,
          );
          await tx.$executeRawUnsafe(
            `UPDATE "${table}" SET counter = ${r!.counter + 1} WHERE id = 1`,
          );
        }),
      ),
    );
    expect((await row()).counter).toBe(N); // would be < 25 if locking were broken
  });

  it('conditional stock decrement never oversells under concurrent checkouts', async () => {
    await reset(5);
    const attempts = 20;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        prisma.$transaction(async (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE "${table}" SET stock = stock - 1 WHERE id = 1 AND stock >= 1`,
          ),
        ),
      ),
    );
    const sold = results.filter((affected) => affected === 1).length;
    expect(sold).toBe(5);
    expect((await row()).stock).toBe(0);
  });

  it('pg_advisory_xact_lock serializes critical sections', async () => {
    await reset(0);
    const N = 15;
    await Promise.all(
      Array.from({ length: N }, () =>
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(4242)`);
          const [r] = await tx.$queryRawUnsafe<{ adv: number }[]>(
            `SELECT adv FROM "${table}" WHERE id = 1`,
          );
          await tx.$executeRawUnsafe(`UPDATE "${table}" SET adv = ${r!.adv + 1} WHERE id = 1`);
        }),
      ),
    );
    expect((await row()).adv).toBe(N);
  });

  it('a failed transaction rolls back completely', async () => {
    await reset(10);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "${table}" SET stock = 0 WHERE id = 1`);
        throw new Error('simulated failure after partial work');
      }),
    ).rejects.toThrow('simulated failure');
    expect((await row()).stock).toBe(10);
  });
});
