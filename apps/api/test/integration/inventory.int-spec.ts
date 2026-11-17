import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { todayInIndia } from '../../src/modules/inventory/domain/stock';
import { InventoryService, type StockContext } from '../../src/modules/inventory/inventory.service';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/** Inventory engine: balances, movements, batches/FEFO, costing, concurrency, idempotency, isolation. Real PostgreSQL. */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const d = (v: string | number) => new Decimal(v);
const addDays = (days: number) => {
  const t = new Date(`${todayInIndia()}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

suite('Inventory engine (real database)', () => {
  jest.setTimeout(900_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let inv: InventoryService;
  let U: Record<string, string>;

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
    inv = ctx.app.get(InventoryService);
  });
  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  // ---------- helpers ----------
  interface Shop {
    token: string;
    organizationId: string;
    userId: string;
    branchId: string;
  }
  const api = (token: string, branchId?: string) => {
    const a = <T extends { set(k: string, v: string): T }>(r: T) => {
      r.set('Authorization', `Bearer ${token}`);
      if (branchId) r.set('x-branch-id', branchId);
      return r;
    };
    const b = '/api/v1';
    return {
      get: (p: string) => a(ctx.http().get(b + p)),
      post: (p: string, body: object, key: string | null = randomUUID()) => {
        const r = a(ctx.http().post(b + p));
        if (key) r.set('idempotency-key', key);
        return r.send(body);
      },
      patch: (p: string, body: object) => a(ctx.http().patch(b + p)).send(body),
    };
  };
  const newShop = async (): Promise<Shop> => {
    const phone = uniquePhone();
    const res = await ctx
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
    const x = res.body.data;
    return {
      token: x.accessToken,
      organizationId: x.organization.id,
      userId: x.user.id,
      branchId: x.branches[0].id,
    };
  };
  const hire = async (
    shop: Shop,
    roleName: string,
    branchIds = [shop.branchId],
  ): Promise<string> => {
    const roles = (await api(shop.token).get('/roles').expect(200)).body.data as {
      id: string;
      name: string;
    }[];
    const phone = uniquePhone();
    const inv2 = await api(shop.token)
      .post(
        '/invitations',
        { phone, roleId: roles.find((r) => r.name === roleName)!.id, branchIds },
        null,
      )
      .expect(201);
    const res = await ctx
      .http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: inv2.body.data.code,
        fullName: `${roleName} X`,
        password: PW,
        deviceUid: `device-${phone}`,
      })
      .expect(201);
    return res.body.data.accessToken;
  };
  const errCode = (res: { body: { error: { code: string } } }) => res.body.error.code;
  const sctx = (s: Shop): StockContext => ({
    organizationId: s.organizationId,
    branchId: s.branchId,
    actorId: s.userId,
  });
  const engineIssue = (
    s: Shop,
    productId: string,
    quantity: string,
    type: 'SALE' | 'DAMAGE' = 'SALE',
  ) =>
    ctx.prisma.$transaction((tx) =>
      inv.issue(tx, sctx(s), {
        productId,
        type,
        baseQuantity: d(quantity),
        reference: { type: 'TEST', id: randomUUID() },
      }),
    );
  const engineReceive = (
    s: Shop,
    productId: string,
    quantity: string,
    unitCost: string,
    batch?: { batchNumber?: string; expiryDate?: string },
  ) =>
    ctx.prisma.$transaction((tx) =>
      inv.receive(tx, sctx(s), {
        productId,
        type: 'PURCHASE_RECEIPT',
        baseQuantity: d(quantity),
        unitCost: d(unitCost),
        batch,
        reference: { type: 'TEST', id: randomUUID() },
      }),
    );
  const balanceOf = async (s: Shop, productId: string) =>
    (await api(s.token, s.branchId).get(`/inventory/balances/${productId}`).expect(200)).body.data;
  const reconcile = async (s: Shop) =>
    (await api(s.token, s.branchId).get('/inventory/reconciliation').expect(200)).body.data;

  let shop: Shop;
  let A: ReturnType<typeof api>;
  const product = async (body: object, s: Shop = shop) =>
    (await api(s.token).post('/products', body, null).expect(201)).body.data as { id: string };
  const looseRice = (s?: Shop, name = 'Loose Rice') =>
    product(
      {
        name,
        type: 'WEIGHT',
        baseUnitId: U.KG,
        minStockLevel: '20',
        conversions: [{ unitId: U.G }, { unitId: U.BAG, factorToBase: '25' }],
      },
      s,
    );
  const milk = (s?: Shop, name = 'Milk 500ml') =>
    product({ name, type: 'COUNT', baseUnitId: U.PCS, trackExpiry: true }, s);

  beforeAll(async () => {
    shop = await newShop();
    A = api(shop.token, shop.branchId);
    const units = (await api(shop.token).get('/units').expect(200)).body.data as {
      id: string;
      code: string;
    }[];
    U = Object.fromEntries(units.map((u) => [u.code, u.id]));
  });

  // ---------- 0. the harness itself ----------
  it('raw SQL runs inside the isolated test schema, never in the real "public" schema', async () => {
    const [row] = await ctx.prisma.$queryRaw<{ s: string }[]>`SELECT current_schema() AS s`;
    expect(row!.s).toBe(db.schema);
  });

  // ---------- A. the specification's example ----------
  describe('every stock change is a signed movement and balances reconcile', () => {
    it('SPEC: opening +100, purchase +25, sale -2, damage -1 = 122 kg; average cost 52; value 6344', async () => {
      const rice = await looseRice();
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '100',
        unitCost: '50',
      }).expect(201);
      await engineReceive(shop, rice.id, '25', '60'); // purchase receipt (Phase 8 will call exactly this)
      const sale = await engineIssue(shop, rice.id, '2'); // sale (Phase 9 will call exactly this)
      expect(sale.costOfGoods).toBe('104.00'); // 2 kg x 52
      const dmg = await A.post('/inventory/adjustments', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '-1',
        reason: 'DAMAGE',
        notes: 'torn bag',
      }).expect(201);
      expect(dmg.body.data.quantityOnHand).toBe('122.000');

      const s = await balanceOf(shop, rice.id);
      expect(s).toMatchObject({
        quantityOnHand: '122.000',
        availableQuantity: '122.000',
        averageCost: '52.0000',
        stockValue: '6344.00',
      });
      const moves = [...s.recentMovements].reverse();
      expect(
        moves.map((m: { type: string; quantity: string; balanceAfter: string }) => [
          m.type,
          m.quantity,
          m.balanceAfter,
        ]),
      ).toEqual([
        ['OPENING', '100.000', '100.000'],
        ['PURCHASE_RECEIPT', '25.000', '125.000'],
        ['SALE', '-2.000', '123.000'],
        ['DAMAGE', '-1.000', '122.000'],
      ]);
      expect(moves[2].unitCost).toBe('52.0000'); // issued at the moving average
      expect((await reconcile(shop)).consistent).toBe(true);
    });

    it('opening stock can be entered in bags: 5 bags at 1400 = 125 kg at 56/kg', async () => {
      const rice = await looseRice(undefined, 'Bag Rice');
      const res = await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.BAG,
        quantity: '5',
        unitCost: '1400',
      }).expect(201);
      expect(res.body.data).toMatchObject({
        baseQuantity: '125.000',
        quantityOnHand: '125.000',
        averageCost: '56.0000',
      });
    });

    it('opening stock is only for setting up: refused once real activity exists', async () => {
      const rice = await looseRice(undefined, 'Locked Rice');
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '10',
        unitCost: '40',
      }).expect(201);
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '5',
        unitCost: '40',
      }).expect(201); // still setting up
      await engineIssue(shop, rice.id, '1');
      const res = await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '5',
        unitCost: '40',
      }).expect(409);
      expect(errCode(res)).toBe('OPENING_STOCK_LOCKED');
    });
  });

  // ---------- B. negative stock ----------
  describe('negative stock protection', () => {
    it('refuses to issue more than is available, and leaves no trace when it refuses', async () => {
      const rice = await looseRice(undefined, 'Scarce Rice');
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '3',
        unitCost: '40',
      }).expect(201);
      await expect(engineIssue(shop, rice.id, '3.5')).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK',
      });
      const res = await A.post('/inventory/adjustments', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '-4',
        reason: 'LOSS',
      }).expect(409);
      expect(errCode(res)).toBe('INSUFFICIENT_STOCK');
      expect(res.body.error.details).toMatchObject({ requested: '4.000', available: '3.000' });
      const s = await balanceOf(shop, rice.id);
      expect(s.quantityOnHand).toBe('3.000');
      expect(s.recentMovements).toHaveLength(1); // only the opening; the failed attempts rolled back completely
      expect(await ctx.prisma.stockAdjustment.count({ where: { productId: rice.id } })).toBe(0);
    });

    it('an override needs the shop setting, the permission and a reason, and is audited', async () => {
      const s2 = await newShop();
      const B = api(s2.token, s2.branchId);
      const rice = await looseRice(s2, 'Override Rice');
      await B.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '2',
        unitCost: '40',
      }).expect(201);
      const take = (body: object = {}) =>
        B.post('/inventory/adjustments', {
          productId: rice.id,
          unitId: U.KG,
          quantity: '-5',
          reason: 'COUNT_CORRECTION',
          allowNegative: true,
          notes: 'goods sold before purchase was entered',
          ...body,
        });

      expect(errCode(await take().expect(422))).toBe('NEGATIVE_STOCK_DISABLED'); // shop setting is off by default
      await api(s2.token).patch('/organization', { allowNegativeStock: true }).expect(200);
      expect(errCode(await take({ notes: 'x' }).expect(422))).toBe('OVERRIDE_REASON_REQUIRED');

      // a role that may adjust stock but NOT override cannot go negative
      await api(s2.token)
        .post(
          '/roles',
          { name: 'Stock Clerk', permissionKeys: ['stock.read', 'stock.adjust', 'product.read'] },
          null,
        )
        .expect(201);
      const clerk = api(await hire(s2, 'Stock Clerk'), s2.branchId);
      expect(
        errCode(
          await clerk
            .post('/inventory/adjustments', {
              productId: rice.id,
              unitId: U.KG,
              quantity: '-5',
              reason: 'COUNT_CORRECTION',
              allowNegative: true,
              notes: 'long enough reason',
            })
            .expect(403),
        ),
      ).toBe('FORBIDDEN');

      const ok = await take().expect(201);
      expect(ok.body.data.quantityOnHand).toBe('-3.000');
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { organizationId: s2.organizationId, action: 'stock.adjust.negative_override' },
      });
      expect(audit.reason).toContain('goods sold before purchase');
      // the next receipt covers the deficit, and the average restarts from the new cost
      const after = await engineReceive(s2, rice.id, '10', '45');
      expect(after).toMatchObject({ quantityOnHand: '7.000', averageCost: '45.0000' });
      expect((await reconcile(s2)).consistent).toBe(true);
    });
  });

  // ---------- C. concurrency ----------
  describe('concurrency (real row locks on PostgreSQL)', () => {
    it('20 simultaneous sales of the last 5 units: exactly 5 succeed, stock ends at 0, never below', async () => {
      const rice = await looseRice(undefined, 'Last Five');
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '5',
        unitCost: '40',
      }).expect(201);
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => engineIssue(shop, rice.id, '1')),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(ok).toBe(5);
      expect(
        rejected.every((r) => (r.reason as { code?: string }).code === 'INSUFFICIENT_STOCK'),
      ).toBe(true);
      const s = await balanceOf(shop, rice.id);
      expect(s.quantityOnHand).toBe('0.000');
      expect(
        await ctx.prisma.stockMovement.count({ where: { productId: rice.id, type: 'SALE' } }),
      ).toBe(5);
      expect((await reconcile(shop)).consistent).toBe(true);
    });

    it('mixed concurrent receipts and sales keep the balance equal to the movement history', async () => {
      const rice = await looseRice(undefined, 'Busy Rice');
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '3',
        unitCost: '40',
      }).expect(201);
      const ops = Array.from({ length: 24 }, (_, i) =>
        i % 3 === 0 ? engineReceive(shop, rice.id, '2', '42') : engineIssue(shop, rice.id, '1'),
      );
      const results = await Promise.allSettled(ops);
      const sales = results.filter((r, i) => i % 3 !== 0 && r.status === 'fulfilled').length;
      const s = await balanceOf(shop, rice.id);
      expect(d(s.quantityOnHand).toNumber()).toBe(3 + 8 * 2 - sales);
      expect(d(s.quantityOnHand).gte(0)).toBe(true);
      expect((await reconcile(shop)).consistent).toBe(true);
    });

    it('concurrent receipts at different costs give the correct weighted average', async () => {
      const rice = await looseRice(undefined, 'Average Rice');
      const costs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      await Promise.all(costs.map((c) => engineReceive(shop, rice.id, '1', String(c))));
      const s = await balanceOf(shop, rice.id);
      expect(s.quantityOnHand).toBe('10.000');
      // exact mean is 55; each step rounds to 4 decimals, so allow a tiny tolerance
      expect(Math.abs(d(s.averageCost).minus(55).toNumber())).toBeLessThan(0.001);
      expect((await reconcile(shop)).consistent).toBe(true);
    });
  });

  // ---------- D. batches, expiry and FEFO ----------
  describe('batches, expiry and FEFO', () => {
    it('sells the earliest-expiring batch first, never sells expired stock, and writes expired stock off', async () => {
      const m = await milk();
      const open = (batchNumber: string, expiryDate: string, quantity: string) =>
        A.post('/inventory/opening-stock', {
          productId: m.id,
          unitId: U.PCS,
          quantity,
          unitCost: '25',
          batchNumber,
          expiryDate,
        }).expect(201);
      await open('LATE', addDays(60), '10');
      await open('SOON', addDays(20), '5');
      const old = await open('OLD', addDays(5), '4');
      // time passes: the OLD batch expires (simulated by moving its date into the past)
      await ctx.prisma.inventoryBatch.update({
        where: { id: old.body.data.movements[0].batchId },
        data: { expiryDate: new Date(`${addDays(-1)}T00:00:00Z`) },
      });

      const sale = await engineIssue(shop, m.id, '8');
      const byBatch = await ctx.prisma.inventoryBatch.findMany({ where: { productId: m.id } });
      const num = (id: string | null) => byBatch.find((b) => b.id === id)!.batchNumber;
      expect(sale.movements.map((x) => [num(x.batchId), x.quantity])).toEqual([
        ['SOON', '-5.000'],
        ['LATE', '-3.000'],
      ]);
      const left = Object.fromEntries(
        (await ctx.prisma.inventoryBatch.findMany({ where: { productId: m.id } })).map((b) => [
          b.batchNumber,
          [b.quantityOnHand.toFixed(3), b.status],
        ]),
      );
      expect(left).toEqual({
        LATE: ['7.000', 'ACTIVE'],
        SOON: ['0.000', 'DEPLETED'],
        OLD: ['4.000', 'ACTIVE'],
      });

      // 11 on hand, but 4 are expired: a sale of 10 is refused and says why
      await expect(engineIssue(shop, m.id, '10')).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK',
      });
      const err = await engineIssue(shop, m.id, '10').catch(
        (e: { getResponse(): { details: Record<string, string> } }) => e.getResponse().details,
      );
      expect(err).toMatchObject({ available: '7.000', expired: '4.000' });

      // write the expired batch off
      const oldId = old.body.data.movements[0].batchId as string;
      const wo = await A.post('/inventory/adjustments', {
        productId: m.id,
        unitId: U.PCS,
        quantity: '-4',
        reason: 'EXPIRY',
        batchId: oldId,
      }).expect(201);
      expect(wo.body.data.movements[0]).toMatchObject({ batchId: oldId, quantity: '-4.000' });
      expect(
        (await ctx.prisma.inventoryBatch.findUniqueOrThrow({ where: { id: oldId } })).status,
      ).toBe('EXPIRED');
      const detail = await balanceOf(shop, m.id);
      expect(detail.quantityOnHand).toBe('7.000');
      expect(
        detail.batches.map((b: { batchNumber: string; expiryStatus: string }) => [
          b.batchNumber,
          b.expiryStatus,
        ]),
      ).toEqual([['LATE', 'OK']]);
      expect((await reconcile(shop)).consistent).toBe(true);
    });

    it('refuses expired or inconsistent batch input', async () => {
      const m = await milk(undefined, 'Milk rules');
      const open = (body: object) =>
        A.post('/inventory/opening-stock', {
          productId: m.id,
          unitId: U.PCS,
          quantity: '2',
          unitCost: '25',
          ...body,
        });
      expect(errCode(await open({}).expect(422))).toBe('EXPIRY_REQUIRED');
      expect(errCode(await open({ expiryDate: addDays(-2) }).expect(422))).toBe(
        'BATCH_ALREADY_EXPIRED',
      );
      await open({ batchNumber: 'B1', expiryDate: addDays(30) }).expect(201);
      expect(errCode(await open({ batchNumber: 'B1', expiryDate: addDays(31) }).expect(422))).toBe(
        'BATCH_EXPIRY_MISMATCH',
      );
      await open({ expiryDate: addDays(40) }).expect(201); // batch number auto-derived from the expiry date
      expect(
        errCode(
          await A.post('/inventory/adjustments', {
            productId: m.id,
            unitId: U.PCS,
            quantity: '-1',
            reason: 'DAMAGE',
          }).expect(422),
        ),
      ).toBe('BATCH_REQUIRED');

      const batchOnly = await product({
        name: 'Biscuits',
        type: 'COUNT',
        baseUnitId: U.PCS,
        trackBatch: true,
      });
      expect(
        errCode(
          await A.post('/inventory/opening-stock', {
            productId: batchOnly.id,
            unitId: U.PCS,
            quantity: '2',
            unitCost: '5',
          }).expect(422),
        ),
      ).toBe('BATCH_REQUIRED');
      const rice = await looseRice(undefined, 'No batches');
      expect(
        errCode(
          await A.post('/inventory/opening-stock', {
            productId: rice.id,
            unitId: U.KG,
            quantity: '2',
            unitCost: '5',
            batchNumber: 'X1',
          }).expect(422),
        ),
      ).toBe('BATCH_NOT_TRACKED');
    });

    it('concurrent sales of a batch-tracked product never oversell any batch', async () => {
      const m = await milk(undefined, 'Milk rush');
      for (const [n, days] of [
        ['R1', 10],
        ['R2', 20],
        ['R3', 30],
      ] as const) {
        await A.post('/inventory/opening-stock', {
          productId: m.id,
          unitId: U.PCS,
          quantity: '3',
          unitCost: '25',
          batchNumber: n,
          expiryDate: addDays(days),
        }).expect(201);
      }
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => engineIssue(shop, m.id, '1')),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(9);
      const batches = await ctx.prisma.inventoryBatch.findMany({ where: { productId: m.id } });
      expect(batches.every((b) => b.quantityOnHand.toNumber() === 0)).toBe(true);
      expect((await reconcile(shop)).consistent).toBe(true);
    });
  });

  // ---------- E. idempotency ----------
  describe('idempotent stock commands', () => {
    it('a retried request with the same key is applied once and replays the same answer', async () => {
      const rice = await looseRice(undefined, 'Retry Rice');
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '50',
        unitCost: '40',
      }).expect(201);
      const key = randomUUID();
      const body = {
        productId: rice.id,
        unitId: U.KG,
        quantity: '-2',
        reason: 'LOSS',
        notes: 'rats',
      };
      const first = await A.post('/inventory/adjustments', body, key).expect(201);
      const again = await A.post('/inventory/adjustments', body, key).expect(201);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.data).toEqual(first.body.data);
      expect((await balanceOf(shop, rice.id)).quantityOnHand).toBe('48.000');
      expect(await ctx.prisma.stockAdjustment.count({ where: { productId: rice.id } })).toBe(1);

      expect(
        errCode(
          await A.post('/inventory/adjustments', { ...body, quantity: '-3' }, key).expect(422),
        ),
      ).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(errCode(await A.post('/inventory/adjustments', body, null).expect(400))).toBe(
        'IDEMPOTENCY_KEY_REQUIRED',
      );
      expect(errCode(await A.post('/inventory/adjustments', body, 'not-a-uuid').expect(400))).toBe(
        'IDEMPOTENCY_KEY_INVALID',
      );
    });

    it('five simultaneous copies of one request (double taps) change stock exactly once', async () => {
      const rice = await looseRice(undefined, 'Double Tap Rice');
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '50',
        unitCost: '40',
      }).expect(201);
      const key = randomUUID();
      const body = { productId: rice.id, unitId: U.KG, quantity: '-1', reason: 'DAMAGE' };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => A.post('/inventory/adjustments', body, key)),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(4);
      expect((await balanceOf(shop, rice.id)).quantityOnHand).toBe('49.000');
      expect(
        await ctx.prisma.stockMovement.count({ where: { productId: rice.id, type: 'DAMAGE' } }),
      ).toBe(1);
    });

    it('a request that failed can be retried with the same key once the problem is fixed', async () => {
      const rice = await looseRice(undefined, 'Fixable Rice');
      const key = randomUUID();
      const body = { productId: rice.id, unitId: U.KG, quantity: '-2', reason: 'LOSS' };
      expect(errCode(await A.post('/inventory/adjustments', body, key).expect(409))).toBe(
        'INSUFFICIENT_STOCK',
      );
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '10',
        unitCost: '40',
      }).expect(201);
      const ok = await A.post('/inventory/adjustments', body, key).expect(201);
      expect(ok.headers['idempotent-replayed']).toBeUndefined();
      expect(ok.body.data.quantityOnHand).toBe('8.000');
    });
  });

  // ---------- F. validation ----------
  describe('validation', () => {
    it('rejects bad quantities, directions, units and missing costs', async () => {
      const rice = await looseRice(undefined, 'Validated Rice');
      const pcs = await product({ name: 'Soap', type: 'COUNT', baseUnitId: U.PCS });
      const adj = (body: object) =>
        A.post('/inventory/adjustments', {
          productId: rice.id,
          unitId: U.KG,
          reason: 'COUNT_CORRECTION',
          ...body,
        });
      expect(errCode(await adj({ quantity: '1.2345' }).expect(400))).toBe('VALIDATION_ERROR');
      expect(errCode(await adj({ quantity: 5 }).expect(400))).toBe('VALIDATION_ERROR'); // numbers are refused, strings only
      expect(errCode(await adj({ quantity: '0' }).expect(422))).toBe('QUANTITY_INVALID');
      expect(errCode(await adj({ quantity: '2', reason: 'DAMAGE' }).expect(422))).toBe(
        'ADJUSTMENT_DIRECTION',
      );
      expect(errCode(await adj({ quantity: '-2', reason: 'FOUND' }).expect(422))).toBe(
        'ADJUSTMENT_DIRECTION',
      );
      expect(errCode(await adj({ quantity: '2', unitId: U.L }).expect(422))).toBe(
        'UNIT_NOT_CONFIGURED',
      );
      expect(errCode(await adj({ quantity: '2', reason: 'FOUND' }).expect(422))).toBe(
        'UNIT_COST_REQUIRED',
      ); // no cost history yet
      expect(errCode(await adj({ quantity: '2', productId: randomUUID() }).expect(404))).toBe(
        'NOT_FOUND',
      );
      expect(
        errCode(
          await A.post('/inventory/opening-stock', {
            productId: pcs.id,
            unitId: U.PCS,
            quantity: '1.5',
            unitCost: '30',
          }).expect(422),
        ),
      ).toBe('FRACTIONAL_NOT_ALLOWED');
      expect(
        errCode(
          await A.post('/inventory/adjustments', {
            productId: rice.id,
            unitId: U.G,
            quantity: '-0.5',
            reason: 'LOSS',
          }).expect(422),
        ),
      ).toBe('QUANTITY_PRECISION');
    });

    it('found stock without a cost is valued at the current average', async () => {
      const rice = await looseRice(undefined, 'Found Rice');
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '10',
        unitCost: '40',
      }).expect(201);
      const res = await A.post('/inventory/adjustments', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '2',
        reason: 'FOUND',
        notes: 'behind the shelf',
      }).expect(201);
      expect(res.body.data).toMatchObject({ quantityOnHand: '12.000', averageCost: '40.0000' });
    });
  });

  // ---------- G. reporting views ----------
  describe('stock views', () => {
    let s: Shop;
    let S: ReturnType<typeof api>;
    let low: { id: string };
    let fine: { id: string };
    let dairy: { id: string };
    beforeAll(async () => {
      s = await newShop();
      S = api(s.token, s.branchId);
      low = await looseRice(s, 'Aaa Low Rice'); // min stock 20
      fine = await looseRice(s, 'Bbb Plenty Rice');
      dairy = await milk(s, 'Ccc Curd');
      await S.post('/inventory/opening-stock', {
        productId: low.id,
        unitId: U.KG,
        quantity: '5',
        unitCost: '40',
      }).expect(201);
      await S.post('/inventory/opening-stock', {
        productId: fine.id,
        unitId: U.BAG,
        quantity: '4',
        unitCost: '1000',
      }).expect(201);
      await S.post('/inventory/opening-stock', {
        productId: dairy.id,
        unitId: U.PCS,
        quantity: '6',
        unitCost: '20',
        expiryDate: addDays(3),
      }).expect(201);
    });

    it('lists balances with low-stock and in-stock filters', async () => {
      const all = (await S.get('/inventory/balances').expect(200)).body;
      expect(all.meta.total).toBe(3);
      const lowList = (await S.get('/inventory/balances?lowStock=true').expect(200)).body.data;
      expect(lowList.map((x: { name: string }) => x.name)).toEqual(['Aaa Low Rice']);
      expect(lowList[0]).toMatchObject({
        quantityOnHand: '5.000',
        minStockLevel: '20.000',
        isLowStock: true,
      });
      expect((await S.get('/inventory/balances?q=plenty').expect(200)).body.data[0]).toMatchObject({
        quantityOnHand: '100.000',
        stockValue: '4000.00',
      });
    });

    it('values stock at weighted-average cost', async () => {
      const v = (await S.get('/inventory/valuation').expect(200)).body.data;
      expect(v).toMatchObject({
        method: 'MOVING_WEIGHTED_AVERAGE',
        totalValue: '4320.00',
        productsInStock: 3,
        productsBelowZero: 0,
      }); // 200 + 4000 + 120
    });

    it('shows expiring batches and the movement history', async () => {
      const exp = (await S.get('/inventory/expiring?withinDays=7').expect(200)).body.data;
      expect(exp).toHaveLength(1);
      expect(exp[0]).toMatchObject({ daysToExpiry: 3, isExpired: false, quantity: '6.000' });
      expect((await S.get('/inventory/expiring?withinDays=1').expect(200)).body.data).toHaveLength(
        0,
      );
      const moves = (await S.get(`/inventory/movements?productId=${fine.id}`).expect(200)).body;
      expect(moves.meta.total).toBe(1);
      expect(moves.data[0]).toMatchObject({
        type: 'OPENING',
        quantity: '100.000',
        unitCost: '40.0000',
      });
      expect((await S.get('/inventory/movements?type=OPENING').expect(200)).body.meta.total).toBe(
        3,
      );
    });

    it('hides costs from roles that may not see inventory reports', async () => {
      const cashier = api(await hire(s, 'Cashier'), s.branchId);
      const row = (await cashier.get('/inventory/balances?q=plenty').expect(200)).body.data[0];
      expect(row.quantityOnHand).toBe('100.000');
      expect(row).not.toHaveProperty('averageCost');
      expect(row).not.toHaveProperty('stockValue');
      const detail = (await cashier.get(`/inventory/balances/${fine.id}`).expect(200)).body.data;
      expect(detail).not.toHaveProperty('averageCost');
      expect(detail.recentMovements[0]).not.toHaveProperty('unitCost');
      await cashier.get('/inventory/valuation').expect(403);
    });

    it('reconciliation detects a balance that no longer matches its movements', async () => {
      expect((await reconcile(s)).consistent).toBe(true);
      // simulate a bug or tampering that bypasses the engine
      await ctx.prisma.inventoryBalance.update({
        where: { branchId_productId: { branchId: s.branchId, productId: low.id } },
        data: { quantityOnHand: '999' },
      });
      const r = await reconcile(s);
      expect(r.consistent).toBe(false);
      expect(r.balanceMismatches).toEqual([
        { productId: low.id, balance: '999.000', sumOfMovements: '5.000' },
      ]);
    });
  });

  // ---------- H. permissions, branches, tenants ----------
  describe('access control and isolation', () => {
    it('cashiers read stock but cannot change it; collection agents cannot see stock', async () => {
      const s = await newShop();
      const rice = await looseRice(s, 'RBAC rice');
      const cashier = api(await hire(s, 'Cashier'), s.branchId);
      const agent = api(await hire(s, 'Collection Agent'), s.branchId);
      await cashier.get('/inventory/balances').expect(200);
      await cashier.get(`/inventory/balances/${rice.id}`).expect(200);
      await cashier
        .post('/inventory/adjustments', {
          productId: rice.id,
          unitId: U.KG,
          quantity: '5',
          reason: 'FOUND',
          unitCost: '1',
        })
        .expect(403);
      await cashier
        .post('/inventory/opening-stock', {
          productId: rice.id,
          unitId: U.KG,
          quantity: '5',
          unitCost: '1',
        })
        .expect(403);
      await cashier.get('/inventory/reconciliation').expect(403);
      await agent.get('/inventory/balances').expect(403);
    });

    it('stock is per branch, and the branch header is required and checked', async () => {
      const s = await newShop();
      const rice = await looseRice(s, 'Branch rice');
      const godown = (
        await api(s.token).post('/branches', { code: 'GODOWN', name: 'Godown' }, null).expect(201)
      ).body.data;
      await api(s.token, s.branchId)
        .post('/inventory/opening-stock', {
          productId: rice.id,
          unitId: U.KG,
          quantity: '30',
          unitCost: '40',
        })
        .expect(201);
      expect(
        (await api(s.token, godown.id).get(`/inventory/balances/${rice.id}`).expect(200)).body.data
          .quantityOnHand,
      ).toBe('0.000');
      expect(
        (await api(s.token, s.branchId).get(`/inventory/balances/${rice.id}`).expect(200)).body.data
          .quantityOnHand,
      ).toBe('30.000');
      expect(errCode(await api(s.token).get('/inventory/balances').expect(400))).toBe(
        'BRANCH_REQUIRED',
      );
      const cashier = api(await hire(s, 'Cashier', [s.branchId]), godown.id);
      expect(errCode(await cashier.get('/inventory/balances').expect(403))).toBe(
        'BRANCH_FORBIDDEN',
      );
    });

    it("another shop can never see or move this shop's stock", async () => {
      const a = await newShop();
      const b = await newShop();
      const rice = await looseRice(a, 'A private rice');
      await api(a.token, a.branchId)
        .post('/inventory/opening-stock', {
          productId: rice.id,
          unitId: U.KG,
          quantity: '40',
          unitCost: '40',
        })
        .expect(201);
      const B = api(b.token, b.branchId);
      await B.get(`/inventory/balances/${rice.id}`).expect(404);
      expect((await B.get('/inventory/balances').expect(200)).body.meta.total).toBe(0);
      expect((await B.get('/inventory/movements').expect(200)).body.meta.total).toBe(0);
      expect((await B.get('/inventory/valuation').expect(200)).body.data.totalValue).toBe('0.00');
      await B.post('/inventory/adjustments', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '-40',
        reason: 'LOSS',
      }).expect(404);
      await B.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '1',
        unitCost: '1',
      }).expect(404);
      await api(b.token, a.branchId).get('/inventory/balances').expect(403); // A's branch id with B's token
      // the engine itself also refuses a product of another organization
      await expect(engineIssue(b, rice.id, '1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(
        (await api(a.token, a.branchId).get(`/inventory/balances/${rice.id}`).expect(200)).body.data
          .quantityOnHand,
      ).toBe('40.000');
    });
  });

  // ---------- I. history is permanent ----------
  describe('audit and immutability', () => {
    it('stock movements cannot be edited or deleted, and adjustments are audited', async () => {
      const rice = await looseRice(undefined, 'Permanent rice');
      await A.post('/inventory/opening-stock', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '9',
        unitCost: '40',
      }).expect(201);
      await A.post('/inventory/adjustments', {
        productId: rice.id,
        unitId: U.KG,
        quantity: '-1',
        reason: 'DAMAGE',
        notes: 'wet',
      }).expect(201);
      await expect(
        ctx.prisma.stockMovement.updateMany({
          where: { productId: rice.id },
          data: { quantity: '1000' },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.prisma.stockMovement.deleteMany({ where: { productId: rice.id } }),
      ).rejects.toThrow(/append-only/);
      const actions = (
        await ctx.prisma.auditLog.findMany({
          where: { organizationId: shop.organizationId, entityId: { not: null } },
          select: { action: true },
        })
      ).map((x) => x.action);
      expect(actions).toEqual(expect.arrayContaining(['stock.opening', 'stock.adjust']));
    });
  });
});
