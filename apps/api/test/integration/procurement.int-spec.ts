import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { todayInIndia } from '../../src/modules/inventory/domain/stock';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/**
 * Procurement: suppliers, purchases (draft -> confirm -> partial/full receipt), purchase returns, supplier payments,
 * the supplier ledger, and the proof that stock and money always agree. Real PostgreSQL.
 */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const d = (v: string | number) => new Decimal(v);
const addDays = (days: number) => {
  const t = new Date(`${todayInIndia()}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

suite('Procurement (real database)', () => {
  jest.setTimeout(900_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let U: Record<'KG' | 'G' | 'L' | 'PCS' | 'BAG' | 'CAN' | 'CARTON', string>;

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
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
  type Api = ReturnType<typeof api>;
  const api = (token: string, branchId?: string) => {
    const a = <T extends { set(k: string, v: string): T }>(r: T) => {
      r.set('Authorization', `Bearer ${token}`);
      if (branchId) r.set('x-branch-id', branchId);
      return r;
    };
    const b = '/api/v1';
    return {
      get: (p: string) => a(ctx.http().get(b + p)),
      post: (p: string, body: object = {}, key: string | null = randomUUID()) => {
        const r = a(ctx.http().post(b + p));
        if (key) r.set('idempotency-key', key);
        return r.send(body);
      },
      patch: (p: string, body: object) => a(ctx.http().patch(b + p)).send(body),
    };
  };
  const newShop = async (gst = false): Promise<Shop> => {
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
    if (gst)
      await ctx.prisma.organization.update({
        where: { id: x.organization.id },
        data: { gstEnabled: true },
      });
    return {
      token: x.accessToken,
      organizationId: x.organization.id,
      userId: x.user.id,
      branchId: x.branches[0].id,
    };
  };
  const hire = async (shop: Shop, roleName: string): Promise<string> => {
    const roles = (await api(shop.token).get('/roles').expect(200)).body.data as {
      id: string;
      name: string;
    }[];
    const phone = uniquePhone();
    const inv = await api(shop.token)
      .post(
        '/invitations',
        { phone, roleId: roles.find((r) => r.name === roleName)!.id, branchIds: [shop.branchId] },
        null,
      )
      .expect(201);
    const res = await ctx
      .http()
      .post('/api/v1/auth/accept-invitation')
      .send({
        code: inv.body.data.code,
        fullName: `${roleName} X`,
        password: PW,
        deviceUid: `device-${phone}`,
      })
      .expect(201);
    return res.body.data.accessToken;
  };
  const errCode = (res: { body: { error: { code: string } } }) => res.body.error.code;

  let shop: Shop;
  let A: Api;
  let n = 0;
  const product = async (body: object, s: Shop = shop) =>
    (await api(s.token).post('/products', body, null).expect(201)).body.data as { id: string };
  const rice = (name = `Rice ${++n}`, s?: Shop) =>
    product(
      {
        name,
        type: 'WEIGHT',
        baseUnitId: U.KG,
        conversions: [{ unitId: U.G }, { unitId: U.BAG, factorToBase: '25' }],
      },
      s,
    );
  const oil = (name = `Oil ${++n}`) =>
    product({
      name,
      type: 'VOLUME',
      baseUnitId: U.L,
      conversions: [{ unitId: U.CAN, factorToBase: '15' }],
    });
  const soap = (name = `Soap ${++n}`) =>
    product({
      name,
      type: 'COUNT',
      baseUnitId: U.PCS,
      conversions: [{ unitId: U.CARTON, factorToBase: '12' }],
    });
  const milk = (name = `Milk ${++n}`) =>
    product({ name, type: 'COUNT', baseUnitId: U.PCS, trackExpiry: true });
  const supplier = async (extra: object = {}, s: Shop = shop) =>
    (
      await api(s.token)
        .post('/suppliers', { name: `Supplier ${++n}`, ...extra }, null)
        .expect(201)
    ).body.data as {
      id: string;
      balance: string;
    };
  const item = (
    productId: string,
    unitId: string,
    quantity: string,
    unitCost: string,
    extra: object = {},
  ) => ({
    productId,
    unitId,
    quantity,
    unitCost,
    ...extra,
  });
  const buy = async (supplierId: string, items: object[], extra: object = {}, a: Api = A) =>
    (await a.post('/purchases', { supplierId, items, ...extra }).expect(201)).body.data;
  const balanceOf = async (productId: string) =>
    (await A.get(`/inventory/balances/${productId}`).expect(200)).body.data;
  const supplierBalance = async (id: string) =>
    (await api(shop.token).get(`/suppliers/${id}`).expect(200)).body.data.balance as string;
  const purchase = async (id: string) => (await A.get(`/purchases/${id}`).expect(200)).body.data;
  const reconcile = async (s: Shop = shop) =>
    (await api(s.token).get('/procurement/reconciliation').expect(200)).body.data;
  const inventoryReconcile = async () =>
    (await A.get('/inventory/reconciliation').expect(200)).body.data;
  const expectBooksAgree = async () => {
    expect(await reconcile()).toMatchObject({ consistent: true });
    expect(await inventoryReconcile()).toMatchObject({ consistent: true });
  };

  beforeAll(async () => {
    shop = await newShop();
    A = api(shop.token, shop.branchId);
    const units = (await api(shop.token).get('/units').expect(200)).body.data as {
      id: string;
      code: string;
    }[];
    U = Object.fromEntries(units.map((u) => [u.code, u.id])) as typeof U;
  });

  // ---------- S. suppliers ----------
  describe('suppliers', () => {
    it('creates, searches, edits with version protection, and switches suppliers off and on', async () => {
      const s = (
        await api(shop.token)
          .post(
            '/suppliers',
            {
              name: 'Sri Ganesh Traders',
              phone: '+91 98765 43210',
              gstin: '36AABCU9603R1ZM',
              paymentTermsDays: 15,
            },
            null,
          )
          .expect(201)
      ).body.data;
      expect(s).toMatchObject({
        name: 'Sri Ganesh Traders',
        phone: '9876543210',
        balance: '0.00',
        isActive: true,
        version: 1,
      });

      // names are unique ignoring case
      expect(
        errCode(
          await api(shop.token)
            .post('/suppliers', { name: 'sri ganesh TRADERS' }, null)
            .expect(409),
        ),
      ).toBe('SUPPLIER_NAME_IN_USE');
      // bad GSTIN and phone are refused
      await api(shop.token)
        .post('/suppliers', { name: 'Bad Gst', gstin: '12345' }, null)
        .expect(400);
      await api(shop.token)
        .post('/suppliers', { name: 'Bad Phone', phone: '12345' }, null)
        .expect(400);

      // search by name, phone and GSTIN
      for (const q of ['ganesh', '98765', '36AABCU']) {
        const r = (await api(shop.token).get(`/suppliers?q=${q}`).expect(200)).body;
        expect(r.data.map((x: { id: string }) => x.id)).toContain(s.id);
      }

      // edit; a stale version is refused
      const edited = (
        await api(shop.token)
          .patch(`/suppliers/${s.id}`, { contactPerson: 'Ganesh', version: 1 })
          .expect(200)
      ).body.data;
      expect(edited).toMatchObject({ contactPerson: 'Ganesh', version: 2 });
      expect(
        errCode(
          await api(shop.token)
            .patch(`/suppliers/${s.id}`, { contactPerson: 'X', version: 1 })
            .expect(409),
        ),
      ).toBe('VERSION_CONFLICT');

      // switch off: no new purchases; switch on again
      await api(shop.token).post(`/suppliers/${s.id}/deactivate`, {}, null).expect(200);
      const p = await product({ name: `P${++n}`, type: 'COUNT', baseUnitId: U.PCS });
      expect(
        errCode(
          await A.post('/purchases', {
            supplierId: s.id,
            items: [item(p.id, U.PCS, '1', '5')],
          }).expect(422),
        ),
      ).toBe('SUPPLIER_INACTIVE');
      expect(
        (await api(shop.token).get('/suppliers?isActive=false').expect(200)).body.data.map(
          (x: { id: string }) => x.id,
        ),
      ).toContain(s.id);
      await api(shop.token).post(`/suppliers/${s.id}/reactivate`, {}, null).expect(200);
      await buy(s.id, [item(p.id, U.PCS, '1', '5')]);
    });

    it('records an opening balance (needs the branch) and shows it on the statement', async () => {
      const noBranch = await api(shop.token)
        .post('/suppliers', { name: `Opening ${++n}`, openingBalance: '2500.50' }, null)
        .expect(400);
      expect(errCode(noBranch)).toBe('BRANCH_REQUIRED');
      const s = (
        await A.post(
          '/suppliers',
          { name: `Opening ${++n}`, openingBalance: '2500.50' },
          null,
        ).expect(201)
      ).body.data;
      expect(s.balance).toBe('2500.50');
      const st = (await api(shop.token).get(`/suppliers/${s.id}/ledger`).expect(200)).body;
      expect(st.data).toHaveLength(1);
      expect(st.data[0]).toMatchObject({
        type: 'OPENING_BALANCE',
        amount: '2500.50',
        balanceAfter: '2500.50',
      });
      expect(st.meta.supplier).toMatchObject({ id: s.id, balance: '2500.50' });
      await expectBooksAgree();
    });
  });

  // ---------- P. purchases and receipts ----------
  describe('purchases', () => {
    it('SPEC: 5 bags (25 kg) at 1400 -> 125 kg in stock at 56.00/kg, 7000.00 owed to the supplier', async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '5', '1400')], {
        supplierInvoiceNo: 'INV-1',
        receiveNow: true,
      });

      expect(p).toMatchObject({
        status: 'RECEIVED',
        subtotal: '7000.00',
        total: '7000.00',
        billedTotal: '7000.00',
        outstanding: '7000.00',
      });
      expect(p.purchaseNumber).toMatch(/^PUR\/\d{4}-\d{2}\/\d{6}$/);
      expect(p.items[0]).toMatchObject({
        quantity: '5.000',
        baseQuantity: '125.000',
        receivedBaseQuantity: '125.000',
        remainingBaseQuantity: '0.000',
        unitCost: '1400.0000',
        baseUnitCost: '56.0000',
        unitCode: 'BAG',
      });

      const stock = await balanceOf(r.id);
      expect(stock).toMatchObject({ quantityOnHand: '125.000', averageCost: '56.0000' });
      expect(await supplierBalance(sup.id)).toBe('7000.00');

      const ledger = (await api(shop.token).get(`/suppliers/${sup.id}/ledger`).expect(200)).body
        .data;
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        type: 'PURCHASE',
        amount: '7000.00',
        balanceAfter: '7000.00',
        referenceId: p.id,
      });

      const moves = (await A.get(`/inventory/movements?productId=${r.id}`).expect(200)).body.data;
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ type: 'PURCHASE_RECEIPT', quantity: '125.000' });
      await expectBooksAgree();
    });

    it('a second purchase at a new price moves the weighted-average cost', async () => {
      const r = await rice();
      const sup = await supplier();
      await buy(sup.id, [item(r.id, U.BAG, '4', '1400')], { receiveNow: true }); // 100 kg at 56
      await buy(sup.id, [item(r.id, U.KG, '100', '62')], { receiveNow: true }); // 100 kg at 62
      expect(await balanceOf(r.id)).toMatchObject({
        quantityOnHand: '200.000',
        averageCost: '59.0000',
      });
      expect(await supplierBalance(sup.id)).toBe((5600 + 6200).toFixed(2));
      await expectBooksAgree();
    });

    it('a draft changes nothing until goods are received; editing is allowed only while a draft', async () => {
      const r = await rice();
      const sup = await supplier();
      const draft = await buy(sup.id, [item(r.id, U.BAG, '2', '1000')]);
      expect(draft.status).toBe('DRAFT');
      expect((await balanceOf(r.id)).quantityOnHand).toBe('0.000');
      expect(await supplierBalance(sup.id)).toBe('0.00');

      // edit lines, then edit only the freight (lines stay)
      const edited = (
        await A.patch(`/purchases/${draft.id}`, {
          items: [item(r.id, U.BAG, '3', '1000')],
          notes: 'revised',
        }).expect(200)
      ).body.data;
      expect(edited).toMatchObject({ total: '3000.00', notes: 'revised' });
      expect(edited.items).toHaveLength(1);
      const withFreight = (
        await A.patch(`/purchases/${draft.id}`, { additionalCosts: '150' }).expect(200)
      ).body.data;
      expect(withFreight).toMatchObject({ total: '3150.00', additionalCosts: '150.00' });
      expect(withFreight.items[0]).toMatchObject({
        allocatedExtra: '150.00',
        baseUnitCost: '42.0000',
      }); // (3000+150)/75

      const confirmed = (await A.post(`/purchases/${draft.id}/confirm`, {}, null).expect(200)).body
        .data;
      expect(confirmed.status).toBe('CONFIRMED');
      expect(
        errCode(await A.patch(`/purchases/${draft.id}`, { notes: 'too late' }).expect(409)),
      ).toBe('PURCHASE_NOT_EDITABLE');
      expect(errCode(await A.post(`/purchases/${draft.id}/confirm`, {}, null).expect(409))).toBe(
        'PURCHASE_NOT_DRAFT',
      );

      await A.post(`/purchases/${draft.id}/receive`, {}).expect(201);
      expect(await balanceOf(r.id)).toMatchObject({
        quantityOnHand: '75.000',
        averageCost: '42.0000',
      });
      expect(await supplierBalance(sup.id)).toBe('3150.00');
      expect(
        errCode(
          await A.post(`/purchases/${draft.id}/cancel`, { reason: 'changed my mind' }, null).expect(
            409,
          ),
        ),
      ).toBe('PURCHASE_HAS_RECEIPTS');
      await expectBooksAgree();
    });

    it('cancelling an order nothing was received for leaves no trace in stock or money', async () => {
      const r = await rice();
      const sup = await supplier();
      const draft = await buy(sup.id, [item(r.id, U.BAG, '2', '1000')]);
      const cancelled = (
        await A.post(
          `/purchases/${draft.id}/cancel`,
          { reason: 'ordered by mistake' },
          null,
        ).expect(200)
      ).body.data;
      expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'ordered by mistake' });
      expect(
        errCode(
          await A.post(`/purchases/${draft.id}/cancel`, { reason: 'again please' }, null).expect(
            409,
          ),
        ),
      ).toBe('PURCHASE_CANCELLED');
      expect(errCode(await A.post(`/purchases/${draft.id}/receive`, {}).expect(409))).toBe(
        'PURCHASE_CANCELLED',
      );
      expect((await balanceOf(r.id)).quantityOnHand).toBe('0.000');
      expect(await supplierBalance(sup.id)).toBe('0.00');
      await api(shop.token)
        .get(`/suppliers/${sup.id}/ledger`)
        .expect(200)
        .expect((res) => expect(res.body.data).toHaveLength(0));
    });

    it('freight is shared across items so each item carries its true cost', async () => {
      const a = await rice();
      const b = await oil();
      const sup = await supplier();
      const p = await buy(
        sup.id,
        [item(a.id, U.BAG, '1', '1000'), item(b.id, U.CAN, '1', '3000')],
        { additionalCosts: '400', receiveNow: true },
      );
      // 400 shared 1000:3000 -> 100 and 300
      expect(p.items.map((i: { allocatedExtra: string }) => i.allocatedExtra)).toEqual([
        '100.00',
        '300.00',
      ]);
      expect(p.total).toBe('4400.00');
      expect((await balanceOf(a.id)).averageCost).toBe('44.0000'); // 1100 / 25 kg
      expect((await balanceOf(b.id)).averageCost).toBe('220.0000'); // 3300 / 15 L
      expect(await supplierBalance(sup.id)).toBe('4400.00');
      await expectBooksAgree();
    });

    it('discounts, tax and round-off: GST shop claims tax back (not in stock cost); a non-GST shop pays it as cost', async () => {
      const line = (productId: string) =>
        item(productId, U.PCS, '10', '100', { discount: '50', taxRatePercent: '5' });

      const p1 = await product({ name: `Tax ${++n}`, type: 'COUNT', baseUnitId: U.PCS });
      const sup1 = await supplier();
      const nonGst = await buy(sup1.id, [line(p1.id)], { roundOff: '0.50', receiveNow: true });
      // 10 x 100 = 1000 - 50 = 950; tax 47.50; line 997.50; +0.50 round-off = 998.00
      expect(nonGst).toMatchObject({
        subtotal: '1000.00',
        discountTotal: '50.00',
        taxTotal: '47.50',
        roundOff: '0.50',
        total: '998.00',
      });
      expect((await balanceOf(p1.id)).averageCost).toBe('99.7500'); // tax is part of the cost: 997.50 / 10
      expect(await supplierBalance(sup1.id)).toBe('998.00');

      const gstShop = await newShop(true);
      const ga = api(gstShop.token, gstShop.branchId);
      const units = (await api(gstShop.token).get('/units').expect(200)).body.data as {
        id: string;
        code: string;
      }[];
      const gPcs = units.find((u) => u.code === 'PCS')!.id;
      const gp = await product({ name: 'Tax GST', type: 'COUNT', baseUnitId: gPcs }, gstShop);
      const gsup = await supplier({}, gstShop);
      await ga
        .post('/purchases', {
          supplierId: gsup.id,
          items: [item(gp.id, gPcs, '10', '100', { discount: '50', taxRatePercent: '5' })],
          receiveNow: true,
        })
        .expect(201);
      const stock = (await ga.get(`/inventory/balances/${gp.id}`).expect(200)).body.data;
      expect(stock.averageCost).toBe('95.0000'); // tax is claimed back: 950 / 10
      expect(
        (await api(gstShop.token).get(`/suppliers/${gsup.id}`).expect(200)).body.data.balance,
      ).toBe('997.50');
    });

    it('partial receipts: payable follows what arrived and adds up to EXACTLY the total (no lost paise)', async () => {
      const r = await rice();
      const sup = await supplier();
      // 7 bags at 1000.01 = 7000.07, awkward on purpose
      const p = await buy(sup.id, [item(r.id, U.BAG, '7', '1000.01')]);
      expect(p.total).toBe('7000.07');
      const itemId = p.items[0].id as string;
      const receive = (qty: string) =>
        A.post(`/purchases/${p.id}/receive`, { lines: [{ itemId, quantity: qty }] });

      const r1 = (await receive('1').expect(201)).body.data;
      expect(r1).toMatchObject({ status: 'PARTIALLY_RECEIVED', billedTotal: '1000.01' });
      expect((await balanceOf(r.id)).quantityOnHand).toBe('25.000');
      expect(await supplierBalance(sup.id)).toBe('1000.01');

      const r2 = (await receive('1').expect(201)).body.data;
      expect(r2.billedTotal).toBe('2000.02');
      const r3 = (await receive('2').expect(201)).body.data;
      expect(r3).toMatchObject({ status: 'PARTIALLY_RECEIVED', billedTotal: '4000.04' });

      // asking for more than is left is refused and changes nothing
      const tooMuch = await receive('4').expect(422);
      expect(errCode(tooMuch)).toBe('RECEIPT_EXCEEDS_ORDER');
      expect(tooMuch.body.error.details).toMatchObject({ remainingBaseQuantity: '75.000' });
      expect((await balanceOf(r.id)).quantityOnHand).toBe('100.000');

      const last = (await receive('3').expect(201)).body.data;
      expect(last).toMatchObject({
        status: 'RECEIVED',
        billedTotal: '7000.07',
        outstanding: '7000.07',
      });
      expect(last.items[0]).toMatchObject({
        receivedBaseQuantity: '175.000',
        remainingBaseQuantity: '0.000',
        billedAmount: '7000.07',
      });
      expect(await supplierBalance(sup.id)).toBe('7000.07');
      expect(errCode(await A.post(`/purchases/${p.id}/receive`, {}).expect(409))).toBe(
        'PURCHASE_ALREADY_RECEIVED',
      );

      const ledger = (await api(shop.token).get(`/suppliers/${sup.id}/ledger`).expect(200)).body
        .data;
      expect(ledger).toHaveLength(4);
      expect(
        ledger.reduce((a: Decimal, e: { amount: string }) => a.plus(e.amount), d(0)).toFixed(2),
      ).toBe('7000.07');
      await expectBooksAgree();
    });

    it('round-off settles with the last receipt, not the first', async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '2', '999.80')], { roundOff: '0.40' });
      expect(p.total).toBe('2000.00');
      const first = (
        await A.post(`/purchases/${p.id}/receive`, {
          lines: [{ itemId: p.items[0].id, quantity: '1' }],
        }).expect(201)
      ).body.data;
      expect(first.billedTotal).toBe('999.80');
      const done = (await A.post(`/purchases/${p.id}/receive`, {}).expect(201)).body.data;
      expect(done.billedTotal).toBe('2000.00');
      expect(await supplierBalance(sup.id)).toBe('2000.00');
      await expectBooksAgree();
    });

    it('a failing line rolls the WHOLE receipt back: no stock, no payable, status unchanged', async () => {
      const r = await rice();
      const m = await milk(); // needs an expiry date
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '2', '1000'), item(m.id, U.PCS, '10', '20')]);
      expect(errCode(await A.post(`/purchases/${p.id}/receive`, {}).expect(422))).toBe(
        'EXPIRY_REQUIRED',
      );
      expect((await balanceOf(r.id)).quantityOnHand).toBe('0.000');
      expect(await supplierBalance(sup.id)).toBe('0.00');
      expect((await purchase(p.id)).status).toBe('DRAFT');

      // giving the expiry at receipt time fixes it
      const ms = p.items.find((i: { productId: string }) => i.productId === m.id).id as string;
      const rs = p.items.find((i: { productId: string }) => i.productId === r.id).id as string;
      const ok = await A.post(`/purchases/${p.id}/receive`, {
        lines: [
          { itemId: rs, quantity: '2' },
          { itemId: ms, quantity: '10', batchNumber: 'M-1', expiryDate: addDays(20) },
        ],
      }).expect(201);
      expect(ok.body.data.status).toBe('RECEIVED');
      const stock = await balanceOf(m.id);
      expect(stock.batches).toHaveLength(1);
      expect(stock.batches[0]).toMatchObject({
        batchNumber: 'M-1',
        expiryDate: addDays(20),
        quantity: '10.000',
      });
      await expectBooksAgree();
    });

    it('batch and expiry details on the order are used by "receive everything"; expired goods are refused', async () => {
      const m = await milk();
      const sup = await supplier();
      const ok = await buy(
        sup.id,
        [item(m.id, U.PCS, '6', '20', { batchNumber: 'OK-1', expiryDate: addDays(15) })],
        { receiveNow: true },
      );
      expect(ok.status).toBe('RECEIVED');
      expect((await balanceOf(m.id)).batches[0]).toMatchObject({
        batchNumber: 'OK-1',
        expiryDate: addDays(15),
      });

      const stale = await buy(sup.id, [
        item(m.id, U.PCS, '6', '20', { batchNumber: 'OLD', expiryDate: addDays(-3) }),
      ]);
      expect(errCode(await A.post(`/purchases/${stale.id}/receive`, {}).expect(422))).toBe(
        'BATCH_ALREADY_EXPIRED',
      );
      expect((await balanceOf(m.id)).quantityOnHand).toBe('6.000');
    });

    it('refuses bad input: units, precision, dates, discounts, duplicate bills, unknown products', async () => {
      const r = await rice();
      const s = await soap();
      const sup = await supplier();
      const post = (items: object[], extra: object = {}) =>
        A.post('/purchases', { supplierId: sup.id, items, ...extra });
      const code = async (items: object[], extra: object = {}, status = 422) =>
        errCode(await post(items, extra).expect(status));

      expect(await code([item(r.id, U.G, '500', '1')])).toBe('UNIT_NOT_PURCHASE_ENABLED'); // grams are sale-only
      expect(await code([item(r.id, U.L, '1', '1')])).toBe('UNIT_NOT_CONFIGURED');
      expect(await code([item(s.id, U.PCS, '2.5', '1')])).toBe('FRACTIONAL_NOT_ALLOWED');
      expect(await code([item(r.id, U.KG, '0', '1')])).toBe('QUANTITY_INVALID');
      expect(await code([item(r.id, U.KG, '1', '10', { discount: '11' })])).toBe(
        'DISCOUNT_EXCEEDS_LINE',
      );
      expect(await code([item(r.id, U.KG, '1', '10')], { purchaseDate: addDays(1) })).toBe(
        'PURCHASE_DATE_FUTURE',
      );
      expect(await code([item(r.id, U.KG, '1', '10')], { purchaseDate: '2026-02-31' })).toBe(
        'PURCHASE_DATE_INVALID',
      );
      expect(await code([item(r.id, U.KG, '1', '10', { batchNumber: 'B' })])).toBe(
        'BATCH_NOT_TRACKED',
      );
      await post([item(r.id, U.KG, '1', '10')], { roundOff: '4.00' }).expect(201);
      expect(await code([item(r.id, U.KG, '1', '10')], { roundOff: '9' }, 422)).toBe(
        'ROUND_OFF_TOO_LARGE',
      );
      expect(await code([item(randomUUID(), U.KG, '1', '10')], {}, 404)).toBe('NOT_FOUND');
      await post([], {}).expect(400);
      await post([item(r.id, U.KG, '1.5555', '10')]).expect(400); // money/quantity shape is validated
      await post([item(r.id, U.KG, '0.0004', '1')]).expect(400); // finer than 0.001 is refused up front
      await post([item(r.id, U.KG, '1', '10.12345')]).expect(400);
      await A.post('/purchases', {
        supplierId: randomUUID(),
        items: [item(r.id, U.KG, '1', '10')],
      }).expect(404);

      // the same supplier bill cannot be entered twice
      await post([item(r.id, U.KG, '1', '10')], { supplierInvoiceNo: 'BILL-77' }).expect(201);
      expect(
        errCode(
          await post([item(r.id, U.KG, '1', '10')], { supplierInvoiceNo: 'bill-77' }).expect(409),
        ),
      ).toBe('SUPPLIER_INVOICE_DUPLICATE');

      // an inactive product cannot be bought
      await api(shop.token).patch(`/products/${r.id}`, { status: 'INACTIVE' }).expect(200);
      expect(await code([item(r.id, U.KG, '1', '10')])).toBe('PRODUCT_NOT_ACTIVE');
    });

    it('impossible calendar dates no longer crash the stock endpoints either', async () => {
      const m = await milk();
      const res = await A.post('/inventory/opening-stock', {
        productId: m.id,
        unitId: U.PCS,
        quantity: '2',
        unitCost: '25',
        batchNumber: 'X',
        expiryDate: '2026-02-31',
      });
      expect(res.status).toBe(422);
      expect(errCode(res)).toBe('EXPIRY_INVALID');
    });

    it('lists and filters purchases; numbers are consecutive per branch and never reused', async () => {
      const r = await rice();
      const sup = await supplier();
      const made = [];
      for (let i = 0; i < 3; i++)
        made.push(
          await buy(sup.id, [item(r.id, U.KG, '1', '10')], { supplierInvoiceNo: `LIST-${n}-${i}` }),
        );
      const seq = made.map((p) => Number(p.purchaseNumber.split('/')[2]));
      expect(seq[1]).toBe(seq[0]! + 1);
      expect(seq[2]).toBe(seq[0]! + 2);

      const bySupplier = (await A.get(`/purchases?supplierId=${sup.id}`).expect(200)).body;
      expect(bySupplier.meta.total).toBe(3);
      const search = (await A.get(`/purchases?q=${made[1].supplierInvoiceNo}`).expect(200)).body
        .data;
      expect(search.map((p: { id: string }) => p.id)).toEqual([made[1].id]);
      const drafts = (await A.get(`/purchases?supplierId=${sup.id}&status=DRAFT`).expect(200)).body;
      expect(drafts.meta.total).toBe(3);
      const received = (await A.get(`/purchases?supplierId=${sup.id}&status=RECEIVED`).expect(200))
        .body;
      expect(received.meta.total).toBe(0);
    });
  });

  // ---------- R. purchase returns ----------
  describe('purchase returns', () => {
    it('sends goods back: stock leaves, the supplier credit reduces what is owed, partial returns add up exactly', async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '7', '1000.01')], { receiveNow: true });
      expect(await supplierBalance(sup.id)).toBe('7000.07');
      const itemId = p.items[0].id as string;
      const ret = (qty: string, extra: object = {}) =>
        A.post('/purchase-returns', {
          purchaseId: p.id,
          reason: 'damaged bags',
          items: [{ purchaseItemId: itemId, quantity: qty }],
          ...extra,
        });

      const one = (await ret('2').expect(201)).body.data;
      expect(one.returnNumber).toMatch(/^PRT\/\d{4}-\d{2}\/\d{6}$/);
      expect(one.total).toBe('2000.02'); // 2/7 of 7000.07
      expect(one.items[0]).toMatchObject({
        quantity: '2.000',
        baseQuantity: '50.000',
        lineTotal: '2000.02',
      });
      expect((await balanceOf(r.id)).quantityOnHand).toBe('125.000');
      expect(await supplierBalance(sup.id)).toBe('5000.05');
      expect(await purchase(p.id)).toMatchObject({
        returnedTotal: '2000.02',
        outstanding: '5000.05',
      });
      expect(
        (await A.get(`/inventory/movements?productId=${r.id}&type=PURCHASE_RETURN`).expect(200))
          .body.data[0],
      ).toMatchObject({ quantity: '-50.000' });

      // over-returning is refused and changes nothing
      const over = await ret('6').expect(422);
      expect(errCode(over)).toBe('RETURN_EXCEEDS_RECEIVED');
      expect(over.body.error.details).toMatchObject({ returnableBaseQuantity: '125.000' });
      expect(await supplierBalance(sup.id)).toBe('5000.05');

      // return the rest in pieces: credits add up to EXACTLY the purchase value
      await ret('3').expect(201);
      await ret('2').expect(201);
      expect(await supplierBalance(sup.id)).toBe('0.00');
      expect(await purchase(p.id)).toMatchObject({ returnedTotal: '7000.07', outstanding: '0.00' });
      expect((await purchase(p.id)).items[0]).toMatchObject({
        returnedBaseQuantity: '175.000',
        returnedAmount: '7000.07',
      });
      expect((await balanceOf(r.id)).quantityOnHand).toBe('0.000');
      expect(errCode(await ret('1').expect(422))).toBe('RETURN_EXCEEDS_RECEIVED');

      const list = (await A.get(`/purchase-returns?purchaseId=${p.id}`).expect(200)).body;
      expect(list.meta.total).toBe(3);
      await A.get(`/purchase-returns/${one.id}`).expect(200);
      await expectBooksAgree();
    });

    it('cannot return goods that were already sold; nothing changes when refused', async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '2', '1000')], { receiveNow: true }); // 50 kg
      // sell 30 kg through the stock engine so only 20 kg remain
      await ctx.prisma.$transaction((tx) =>
        ctx.app.get(InventoryService).issue(
          tx,
          { organizationId: shop.organizationId, branchId: shop.branchId, actorId: shop.userId },
          {
            productId: r.id,
            type: 'SALE',
            baseQuantity: d('30'),
            reference: { type: 'TEST', id: randomUUID() },
          },
        ),
      );
      const res = await A.post('/purchase-returns', {
        purchaseId: p.id,
        reason: 'wrong grade',
        items: [{ purchaseItemId: p.items[0].id, quantity: '2' }],
      }).expect(409);
      expect(errCode(res)).toBe('INSUFFICIENT_STOCK');
      expect(await supplierBalance(sup.id)).toBe('2000.00');
      expect((await purchase(p.id)).returnedTotal).toBe('0.00');
      // the 20 kg that are left CAN go back: 0.8 bag = 20 kg, worth 0.8 x 1000
      await A.post('/purchase-returns', {
        purchaseId: p.id,
        reason: 'wrong grade',
        items: [{ purchaseItemId: p.items[0].id, quantity: '0.8' }],
      }).expect(201);
      expect((await balanceOf(r.id)).quantityOnHand).toBe('0.000');
      expect(await supplierBalance(sup.id)).toBe('1200.00');
      await expectBooksAgree();
    });

    it('batch-tracked goods must name the batch; unreceived purchases cannot be returned', async () => {
      const m = await milk();
      const sup = await supplier();
      const p = await buy(
        sup.id,
        [item(m.id, U.PCS, '10', '20', { batchNumber: 'R-1', expiryDate: addDays(30) })],
        { receiveNow: true },
      );
      const body = (extra: object) => ({
        purchaseId: p.id,
        reason: 'spoiled',
        items: [{ purchaseItemId: p.items[0].id, quantity: '4', ...extra }],
      });
      expect(errCode(await A.post('/purchase-returns', body({})).expect(422))).toBe(
        'BATCH_REQUIRED',
      );
      const batchId = (await balanceOf(m.id)).batches[0].id as string;
      const ok = await A.post('/purchase-returns', body({ batchId })).expect(201);
      expect(ok.body.data.items[0]).toMatchObject({ batchId, baseQuantity: '4.000' });
      expect((await balanceOf(m.id)).batches[0].quantity).toBe('6.000');
      expect(await supplierBalance(sup.id)).toBe('120.00'); // 200 - 4 x 20

      const draft = await buy(sup.id, [
        item(m.id, U.PCS, '1', '20', { batchNumber: 'R-2', expiryDate: addDays(30) }),
      ]);
      expect(
        errCode(
          await A.post('/purchase-returns', {
            purchaseId: draft.id,
            reason: 'nothing came',
            items: [{ purchaseItemId: draft.items[0].id, quantity: '1' }],
          }).expect(409),
        ),
      ).toBe('PURCHASE_NOT_RETURNABLE');
      await expectBooksAgree();
    });
  });

  // ---------- Y. supplier payments ----------
  describe('supplier payments', () => {
    it('pays the oldest purchases first, writes a cashbook line, and the balance falls by the amount', async () => {
      const r = await rice();
      const sup = await supplier();
      const older = await buy(sup.id, [item(r.id, U.BAG, '7', '1000')], {
        purchaseDate: addDays(-10),
        receiveNow: true,
      }); // 7000
      const newer = await buy(sup.id, [item(r.id, U.BAG, '3', '1000')], {
        purchaseDate: addDays(-2),
        receiveNow: true,
      }); // 3000
      expect(await supplierBalance(sup.id)).toBe('10000.00');

      const res = await A.post(`/suppliers/${sup.id}/payments`, {
        amount: '8000',
        method: 'UPI',
        referenceNo: 'UTR123',
      }).expect(201);
      const pay = res.body.data;
      expect(pay).toMatchObject({
        amount: '8000.00',
        advance: '0.00',
        supplierBalance: '2000.00',
        method: 'UPI',
      });
      expect(pay.receiptNumber).toMatch(/^PV\/\d{4}-\d{2}\/\d{6}$/);
      expect(
        pay.allocations.map((a: { purchaseNumber: string; amount: string }) => [
          a.purchaseNumber,
          a.amount,
        ]),
      ).toEqual([
        [older.purchaseNumber, '7000.00'],
        [newer.purchaseNumber, '1000.00'],
      ]);
      expect(await purchase(older.id)).toMatchObject({ paidTotal: '7000.00', outstanding: '0.00' });
      expect(await purchase(newer.id)).toMatchObject({
        paidTotal: '1000.00',
        outstanding: '2000.00',
      });

      const cash = await ctx.prisma.cashbookEntry.findMany({ where: { paymentId: pay.id } });
      expect(cash).toHaveLength(1);
      expect(cash[0]).toMatchObject({
        kind: 'SUPPLIER_PAYMENT',
        method: 'UPI',
        branchId: shop.branchId,
      });
      expect(cash[0]!.amount.toFixed(2)).toBe('-8000.00');

      const unpaid = (await A.get(`/purchases?supplierId=${sup.id}&unpaid=true`).expect(200)).body
        .data;
      expect(unpaid.map((p: { id: string }) => p.id)).toEqual([newer.id]);
      expect(
        (await api(shop.token).get(`/suppliers/${sup.id}`).expect(200)).body.data,
      ).toMatchObject({
        unpaidPurchaseCount: 1,
        unpaidPurchasesTotal: '2000.00',
      });
      await expectBooksAgree();
    });

    it('lets you choose which purchases a payment settles, and refuses impossible allocations', async () => {
      const r = await rice();
      const sup = await supplier();
      const a = await buy(sup.id, [item(r.id, U.BAG, '2', '1000')], {
        purchaseDate: addDays(-5),
        receiveNow: true,
      });
      const b = await buy(sup.id, [item(r.id, U.BAG, '3', '1000')], {
        purchaseDate: addDays(-1),
        receiveNow: true,
      });
      const draft = await buy(sup.id, [item(r.id, U.BAG, '1', '1000')]); // not received: nothing owed yet
      const pay = (body: object) =>
        A.post(`/suppliers/${sup.id}/payments`, { method: 'CASH', ...body });

      expect(
        errCode(
          await pay({ amount: '500', allocations: [{ purchaseId: b.id, amount: '3001' }] }).expect(
            422,
          ),
        ),
      ).toBe('ALLOCATION_EXCEEDS_OUTSTANDING');
      expect(
        errCode(
          await pay({
            amount: '500',
            allocations: [{ purchaseId: draft.id, amount: '100' }],
          }).expect(422),
        ),
      ).toBe('ALLOCATION_NOT_PAYABLE');
      expect(
        errCode(
          await pay({
            amount: '500',
            allocations: [
              { purchaseId: a.id, amount: '300' },
              { purchaseId: b.id, amount: '300' },
            ],
          }).expect(422),
        ),
      ).toBe('ALLOCATION_EXCEEDS_PAYMENT');
      expect(
        errCode(
          await pay({
            amount: '500',
            allocations: [
              { purchaseId: a.id, amount: '100' },
              { purchaseId: a.id, amount: '100' },
            ],
          }).expect(422),
        ),
      ).toBe('ALLOCATION_DUPLICATE');
      expect(errCode(await pay({ amount: '0' }).expect(422))).toBe('PAYMENT_AMOUNT_INVALID');
      await pay({ amount: '12.345' }).expect(400);
      await pay({ amount: '10', method: 'BARTER' }).expect(400);
      expect(await supplierBalance(sup.id)).toBe('5000.00'); // every refusal left it untouched

      const ok = (
        await pay({ amount: '1000', allocations: [{ purchaseId: b.id, amount: '700' }] }).expect(
          201,
        )
      ).body.data;
      expect(ok.allocations).toHaveLength(1);
      expect(ok).toMatchObject({ advance: '300.00', supplierBalance: '4000.00' }); // 300 not matched to any purchase
      expect(await purchase(b.id)).toMatchObject({ outstanding: '2300.00' });
      expect(await purchase(a.id)).toMatchObject({ outstanding: '2000.00' });
      await expectBooksAgree();
    });

    it('overpaying leaves an advance: the balance goes negative and the next purchase uses it up', async () => {
      const r = await rice();
      const sup = await supplier();
      await buy(sup.id, [item(r.id, U.BAG, '2', '1000')], { receiveNow: true });
      const res = (
        await A.post(`/suppliers/${sup.id}/payments`, { amount: '2500', method: 'CASH' }).expect(
          201,
        )
      ).body.data;
      expect(res).toMatchObject({ advance: '500.00', supplierBalance: '-500.00' });
      await buy(sup.id, [item(r.id, U.BAG, '1', '1000')], { receiveNow: true });
      expect(await supplierBalance(sup.id)).toBe('500.00');
      await expectBooksAgree();
    });

    it('reverses a mistaken payment: money, purchases and cashbook are restored; nothing is deleted', async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '4', '1000')], { receiveNow: true });
      const pay = (
        await A.post(`/suppliers/${sup.id}/payments`, { amount: '3000', method: 'CASH' }).expect(
          201,
        )
      ).body.data;
      expect(await supplierBalance(sup.id)).toBe('1000.00');

      expect(
        errCode(
          await api(shop.token)
            .post(`/supplier-payments/${pay.id}/reverse`, { reason: 'x' })
            .expect(400),
        ),
      ).toBe('VALIDATION_ERROR');
      const rev = (
        await api(shop.token)
          .post(`/supplier-payments/${pay.id}/reverse`, { reason: 'entered twice by mistake' })
          .expect(201)
      ).body.data;
      expect(rev).toMatchObject({
        reversedPaymentId: pay.id,
        amount: '3000.00',
        supplierBalance: '4000.00',
      });
      expect(await purchase(p.id)).toMatchObject({ paidTotal: '0.00', outstanding: '4000.00' });

      const original = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
      expect(original.status).toBe('REVERSED');
      const cash = await ctx.prisma.cashbookEntry.findMany({
        where: { OR: [{ paymentId: pay.id }, { paymentId: rev.reversalPaymentId }] },
        orderBy: { createdAt: 'asc' },
      });
      expect(cash.map((c) => [c.kind, c.amount.toFixed(2)])).toEqual([
        ['SUPPLIER_PAYMENT', '-3000.00'],
        ['REVERSAL', '3000.00'],
      ]);

      // cannot be reversed twice, and a reversal cannot itself be reversed
      expect(
        errCode(
          await api(shop.token)
            .post(`/supplier-payments/${pay.id}/reverse`, { reason: 'again please' })
            .expect(409),
        ),
      ).toBe('PAYMENT_ALREADY_REVERSED');
      expect(
        errCode(
          await api(shop.token)
            .post(`/supplier-payments/${rev.reversalPaymentId}/reverse`, {
              reason: 'reverse a reversal',
            })
            .expect(404),
        ),
      ).toBe('PAYMENT_NOT_FOUND');

      // the purchase can be paid again after the reversal
      await A.post(`/suppliers/${sup.id}/payments`, { amount: '4000', method: 'CASH' }).expect(201);
      expect(await supplierBalance(sup.id)).toBe('0.00');
      const list = (
        await api(shop.token).get(`/supplier-payments?supplierId=${sup.id}`).expect(200)
      ).body;
      expect(list.meta.total).toBe(3);
      await expectBooksAgree();
    });
  });

  // ---------- I. idempotency ----------
  describe('retries never double-apply', () => {
    it('a repeated create / receive / payment / return with the same key does the work once', async () => {
      const r = await rice();
      const sup = await supplier();
      const key = randomUUID();
      const body = { supplierId: sup.id, items: [item(r.id, U.BAG, '2', '1000')] };
      const first = await A.post('/purchases', body, key).expect(201);
      const again = await A.post('/purchases', body, key).expect(201);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.data.id).toBe(first.body.data.id);
      expect((await A.get(`/purchases?supplierId=${sup.id}`).expect(200)).body.meta.total).toBe(1);
      // same key, different content: refused
      expect(
        errCode(await A.post('/purchases', { ...body, notes: 'different' }, key).expect(422)),
      ).toBe('IDEMPOTENCY_KEY_REUSED');

      const pid = first.body.data.id as string;
      const rk = randomUUID();
      await A.post(`/purchases/${pid}/receive`, {}, rk).expect(201);
      const rr = await A.post(`/purchases/${pid}/receive`, {}, rk).expect(201);
      expect(rr.headers['idempotent-replayed']).toBe('true');
      expect((await balanceOf(r.id)).quantityOnHand).toBe('50.000');
      expect(await supplierBalance(sup.id)).toBe('2000.00');

      const pk = randomUUID();
      await A.post(`/suppliers/${sup.id}/payments`, { amount: '500', method: 'CASH' }, pk).expect(
        201,
      );
      await A.post(`/suppliers/${sup.id}/payments`, { amount: '500', method: 'CASH' }, pk).expect(
        201,
      );
      expect(await supplierBalance(sup.id)).toBe('1500.00');

      const ik = randomUUID();
      const rb = {
        purchaseId: pid,
        reason: 'wrong grade',
        items: [{ purchaseItemId: first.body.data.items[0].id, quantity: '1' }],
      };
      await A.post('/purchase-returns', rb, ik).expect(201);
      await A.post('/purchase-returns', rb, ik).expect(201);
      expect((await balanceOf(r.id)).quantityOnHand).toBe('25.000');
      expect(await supplierBalance(sup.id)).toBe('500.00');

      // a missing key is refused
      expect(errCode(await A.post('/purchases', body, null).expect(400))).toBe(
        'IDEMPOTENCY_KEY_REQUIRED',
      );
      await expectBooksAgree();
    });
  });

  // ---------- C. concurrency ----------
  describe('concurrency (real row locks)', () => {
    it('10 simultaneous payments never settle the same money twice', async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '5', '1000')], { receiveNow: true }); // 5000 owed
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          A.post(`/suppliers/${sup.id}/payments`, { amount: '600', method: 'CASH' }),
        ),
      );
      expect(results.every((x) => x.status === 201)).toBe(true);
      // 6000 paid against 5000: exactly 5000 allocated, 1000 advance
      const allocated = await ctx.prisma.purchasePayment.aggregate({
        where: { purchaseId: p.id },
        _sum: { amount: true },
      });
      expect(allocated._sum.amount!.toFixed(2)).toBe('5000.00');
      expect(await supplierBalance(sup.id)).toBe('-1000.00');
      expect(await purchase(p.id)).toMatchObject({ paidTotal: '5000.00', outstanding: '0.00' });
      await expectBooksAgree();
    });

    it('two people receiving the same purchase at once: stock and payable are added exactly once', async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '4', '1000')]);
      const attempts = await Promise.all([
        A.post(`/purchases/${p.id}/receive`, {}),
        A.post(`/purchases/${p.id}/receive`, {}),
        A.post(`/purchases/${p.id}/receive`, {}),
      ]);
      expect(attempts.filter((x) => x.status === 201)).toHaveLength(1);
      expect(
        attempts
          .filter((x) => x.status === 409)
          .every((x) => errCode(x) === 'PURCHASE_ALREADY_RECEIVED'),
      ).toBe(true);
      expect((await balanceOf(r.id)).quantityOnHand).toBe('100.000');
      expect(await supplierBalance(sup.id)).toBe('4000.00');
      await expectBooksAgree();
    });

    it('five simultaneous copies of one request (double taps) create one purchase', async () => {
      const r = await rice();
      const sup = await supplier();
      const key = randomUUID();
      const body = {
        supplierId: sup.id,
        items: [item(r.id, U.BAG, '1', '1000')],
        receiveNow: true,
      };
      const all = await Promise.all(
        Array.from({ length: 5 }, () => A.post('/purchases', body, key)),
      );
      expect(all.every((x) => x.status === 201)).toBe(true);
      expect(new Set(all.map((x) => x.body.data.id)).size).toBe(1);
      expect((await balanceOf(r.id)).quantityOnHand).toBe('25.000');
      expect(await supplierBalance(sup.id)).toBe('1000.00');
    });

    it('purchase numbers stay unique and gap-free when many are created at once', async () => {
      const fresh = await newShop();
      const fa = api(fresh.token, fresh.branchId);
      const units = (await api(fresh.token).get('/units').expect(200)).body.data as {
        id: string;
        code: string;
      }[];
      const pcs = units.find((u) => u.code === 'PCS')!.id;
      const fp = await product({ name: 'Numbered', type: 'COUNT', baseUnitId: pcs }, fresh);
      const fs = await supplier({}, fresh);
      const made = await Promise.all(
        Array.from({ length: 12 }, () =>
          fa.post('/purchases', { supplierId: fs.id, items: [item(fp.id, pcs, '1', '5')] }),
        ),
      );
      expect(made.every((x) => x.status === 201)).toBe(true);
      const seq = made
        .map((x) => Number(x.body.data.purchaseNumber.split('/')[2]))
        .sort((a, b) => a - b);
      expect(seq).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    });

    it('receipts, returns and payments racing together leave every book in agreement', async () => {
      const r = await rice();
      const sup = await supplier();
      const p1 = await buy(sup.id, [item(r.id, U.BAG, '6', '1000')]);
      const p2 = await buy(sup.id, [item(r.id, U.BAG, '4', '1000')], { receiveNow: true });
      await Promise.all([
        A.post(`/purchases/${p1.id}/receive`, {
          lines: [{ itemId: p1.items[0].id, quantity: '3' }],
        }),
        A.post(`/purchases/${p1.id}/receive`, {
          lines: [{ itemId: p1.items[0].id, quantity: '3' }],
        }),
        A.post('/purchase-returns', {
          purchaseId: p2.id,
          reason: 'wrong grade',
          items: [{ purchaseItemId: p2.items[0].id, quantity: '1' }],
        }),
        A.post('/purchase-returns', {
          purchaseId: p2.id,
          reason: 'wrong grade',
          items: [{ purchaseItemId: p2.items[0].id, quantity: '1' }],
        }),
        A.post(`/suppliers/${sup.id}/payments`, { amount: '1500', method: 'CASH' }),
        A.post(`/suppliers/${sup.id}/payments`, { amount: '700', method: 'UPI' }),
      ]);
      expect((await purchase(p1.id)).status).toBe('RECEIVED');
      expect((await purchase(p2.id)).returnedTotal).toBe('2000.00');
      expect((await balanceOf(r.id)).quantityOnHand).toBe((250 - 50).toFixed(3)); // 6+4 bags = 250 kg, 2 bags returned
      expect(await supplierBalance(sup.id)).toBe((10000 - 2000 - 2200).toFixed(2));
      await expectBooksAgree();
    });
  });

  // ---------- A. access control and isolation ----------
  describe('access control and isolation', () => {
    it('cashiers cannot touch suppliers or purchases; managers can', async () => {
      const cashier = api(await hire(shop, 'Cashier'), shop.branchId);
      const manager = api(await hire(shop, 'Manager'), shop.branchId);
      const sup = await supplier();
      await cashier.get('/suppliers').expect(403);
      await cashier.post('/suppliers', { name: 'Nope' }, null).expect(403);
      await cashier.get('/purchases').expect(403);
      await cashier.post('/purchases', { supplierId: sup.id, items: [] }).expect(403);
      await cashier
        .post(`/suppliers/${sup.id}/payments`, { amount: '1', method: 'CASH' })
        .expect(403);
      await cashier.get('/procurement/reconciliation').expect(403);

      const r = await rice();
      const p = (
        await manager
          .post('/purchases', {
            supplierId: sup.id,
            items: [item(r.id, U.KG, '1', '10')],
            receiveNow: true,
          })
          .expect(201)
      ).body.data;
      await manager
        .post(`/suppliers/${sup.id}/payments`, { amount: '5', method: 'CASH' })
        .expect(201);
      await manager.get(`/purchases/${p.id}`).expect(200);
    });

    it("another shop can never see or change this shop's suppliers, purchases, returns or payments", async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '2', '1000')], { receiveNow: true });
      const pay = (
        await A.post(`/suppliers/${sup.id}/payments`, { amount: '100', method: 'CASH' }).expect(201)
      ).body.data;
      const ret = (
        await A.post('/purchase-returns', {
          purchaseId: p.id,
          reason: 'spoiled',
          items: [{ purchaseItemId: p.items[0].id, quantity: '1' }],
        }).expect(201)
      ).body.data;

      const other = await newShop();
      const O = api(other.token, other.branchId);
      const oUnits = (await api(other.token).get('/units').expect(200)).body.data as {
        id: string;
        code: string;
      }[];
      const oKg = oUnits.find((u) => u.code === 'KG')!.id;
      const oProduct = await product(
        { name: 'Other rice', type: 'WEIGHT', baseUnitId: oKg },
        other,
      );
      const oSup = await supplier({}, other);

      await api(other.token).get(`/suppliers/${sup.id}`).expect(404);
      await api(other.token).patch(`/suppliers/${sup.id}`, { name: 'Hacked' }).expect(404);
      await api(other.token).post(`/suppliers/${sup.id}/deactivate`, {}, null).expect(404);
      await api(other.token).get(`/suppliers/${sup.id}/ledger`).expect(404);
      await O.post(`/suppliers/${sup.id}/payments`, { amount: '1', method: 'CASH' }).expect(404);
      await O.get(`/purchases/${p.id}`).expect(404);
      await O.post(`/purchases/${p.id}/receive`, {}).expect(404);
      await O.post(`/purchases/${p.id}/cancel`, { reason: 'not yours to cancel' }, null).expect(
        404,
      );
      await O.get(`/purchase-returns/${ret.id}`).expect(404);
      await O.post('/purchase-returns', {
        purchaseId: p.id,
        reason: 'not mine',
        items: [{ purchaseItemId: p.items[0].id, quantity: '1' }],
      }).expect(404);
      await api(other.token)
        .post(`/supplier-payments/${pay.id}/reverse`, { reason: 'not yours' })
        .expect(404);
      // buying from this shop's supplier, or buying this shop's product, is refused
      await O.post('/purchases', {
        supplierId: sup.id,
        items: [item(oProduct.id, oKg, '1', '1')],
      }).expect(404);
      await O.post('/purchases', {
        supplierId: oSup.id,
        items: [item(r.id, U.KG, '1', '1')],
      }).expect(404);
      // lists and the reconciliation never include this shop's records
      expect(
        (await api(other.token).get('/suppliers').expect(200)).body.data.map(
          (s: { id: string }) => s.id,
        ),
      ).toEqual([oSup.id]);
      expect((await O.get('/purchases').expect(200)).body.meta.total).toBe(0);
      expect((await api(other.token).get('/supplier-payments').expect(200)).body.meta.total).toBe(
        0,
      );
      expect(await reconcile(other)).toMatchObject({ consistent: true });

      // and nothing of this shop's changed
      expect(await supplierBalance(sup.id)).toBe('900.00'); // 2000 bought - 100 paid - 1000 returned
      expect(
        (await api(shop.token).get(`/suppliers/${sup.id}`).expect(200)).body.data.name,
      ).not.toBe('Hacked');
    });

    it('purchases belong to a branch: another branch of the same shop does not see them', async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '1', '1000')], { receiveNow: true });
      const second = (
        await api(shop.token)
          .post('/branches', { code: `B${++n}`, name: 'Second branch' }, null)
          .expect(201)
      ).body.data;
      const B = api(shop.token, second.id);
      await B.get(`/purchases/${p.id}`).expect(404);
      await B.post(`/purchases/${p.id}/receive`, {}).expect(404);
      expect((await B.get('/purchases').expect(200)).body.meta.total).toBe(0);
      expect(
        (await B.get(`/inventory/balances/${r.id}`).expect(200)).body.data.quantityOnHand,
      ).toBe('0.000');
      // each branch numbers its own purchases from 1
      const bp = await B.post('/purchases', {
        supplierId: sup.id,
        items: [item(r.id, U.BAG, '1', '1000')],
        receiveNow: true,
      }).expect(201);
      expect(bp.body.data.purchaseNumber.endsWith('/000001')).toBe(true);
      expect(await reconcile()).toMatchObject({ consistent: true });
    });

    it('routes that need a branch say so', async () => {
      const sup = await supplier();
      expect(errCode(await api(shop.token).get('/purchases').expect(400))).toBe('BRANCH_REQUIRED');
      expect(
        errCode(
          await api(shop.token)
            .post(`/suppliers/${sup.id}/payments`, { amount: '1', method: 'CASH' })
            .expect(400),
        ),
      ).toBe('BRANCH_REQUIRED');
    });
  });

  // ---------- H. history is permanent and audited ----------
  describe('immutability and audit', () => {
    it("ledger, purchases, returns and payments cannot be edited or deleted behind the application's back", async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '2', '1000')], { receiveNow: true });
      const pay = (
        await A.post(`/suppliers/${sup.id}/payments`, { amount: '100', method: 'CASH' }).expect(201)
      ).body.data;
      const ret = (
        await A.post('/purchase-returns', {
          purchaseId: p.id,
          reason: 'spoiled',
          items: [{ purchaseItemId: p.items[0].id, quantity: '1' }],
        }).expect(201)
      ).body.data;

      const attempt = (sql: string) => ctx.prisma.$executeRawUnsafe(sql);
      await expect(
        attempt(`UPDATE supplier_ledger_entries SET amount = 1 WHERE supplier_id = '${sup.id}'`),
      ).rejects.toThrow(/append-only/);
      await expect(
        attempt(`DELETE FROM supplier_ledger_entries WHERE supplier_id = '${sup.id}'`),
      ).rejects.toThrow(/append-only/);
      await expect(
        attempt(`DELETE FROM cashbook_entries WHERE payment_id = '${pay.id}'`),
      ).rejects.toThrow(/append-only/);
      await expect(attempt(`DELETE FROM purchases WHERE id = '${p.id}'`)).rejects.toThrow();
      await expect(
        attempt(`DELETE FROM purchase_items WHERE purchase_id = '${p.id}'`),
      ).rejects.toThrow(/no longer a draft/);
      await expect(
        attempt(`DELETE FROM purchase_returns WHERE id = '${ret.id}'`),
      ).rejects.toThrow();
      await expect(
        attempt(`DELETE FROM purchase_return_items WHERE return_id = '${ret.id}'`),
      ).rejects.toThrow();
      await expect(attempt(`DELETE FROM payments WHERE id = '${pay.id}'`)).rejects.toThrow();
      await expect(
        attempt(`DELETE FROM purchase_payments WHERE payment_id = '${pay.id}'`),
      ).rejects.toThrow();
      await expect(attempt(`DELETE FROM suppliers WHERE id = '${sup.id}'`)).rejects.toThrow();
      // database rules back up the application's own checks
      await expect(
        attempt(
          `UPDATE purchase_items SET received_base_quantity = base_quantity + 1 WHERE purchase_id = '${p.id}'`,
        ),
      ).rejects.toThrow();
      await expect(
        attempt(
          `UPDATE purchase_items SET returned_base_quantity = received_base_quantity + 1 WHERE purchase_id = '${p.id}'`,
        ),
      ).rejects.toThrow();
      await expect(
        attempt(`UPDATE purchases SET returned_total = billed_total + 1 WHERE id = '${p.id}'`),
      ).rejects.toThrow();
    });

    it('every money or stock action leaves an audit trail', async () => {
      const r = await rice();
      const sup = await supplier();
      const p = await buy(sup.id, [item(r.id, U.BAG, '2', '1000')], { receiveNow: true });
      const pay = (
        await A.post(`/suppliers/${sup.id}/payments`, { amount: '100', method: 'CASH' }).expect(201)
      ).body.data;
      await A.post('/purchase-returns', {
        purchaseId: p.id,
        reason: 'spoiled',
        items: [{ purchaseItemId: p.items[0].id, quantity: '1' }],
      }).expect(201);
      await api(shop.token)
        .post(`/supplier-payments/${pay.id}/reverse`, { reason: 'entered by mistake' })
        .expect(201);
      await api(shop.token).post(`/suppliers/${sup.id}/deactivate`, {}, null).expect(200);
      const actions = (
        await ctx.prisma.auditLog.findMany({
          where: {
            organizationId: shop.organizationId,
            OR: [
              { entityId: sup.id },
              { entityId: p.id },
              { entityId: pay.id },
              { action: 'purchase_return.create' },
            ],
          },
        })
      ).map((a) => a.action);
      for (const expected of [
        'supplier.create',
        'purchase.create',
        'purchase.receive',
        'supplier.payment',
        'purchase_return.create',
        'supplier.payment.reverse',
        'supplier.deactivate',
      ]) {
        expect(actions).toContain(expected);
      }
    });
  });
});
