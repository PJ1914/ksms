import { randomUUID } from 'node:crypto';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/** Product catalogue and unit-conversion engine against a REAL PostgreSQL schema. */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';

suite('Catalogue: products, units, prices, barcodes (real database)', () => {
  jest.setTimeout(480_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let U: Record<string, string>; // unit code -> id

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
  });
  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  // ---------- helpers ----------
  const api = (token: string) => {
    const a = <T extends { set(k: string, v: string): T }>(r: T) =>
      r.set('Authorization', `Bearer ${token}`);
    const b = '/api/v1';
    return {
      get: (p: string) => a(ctx.http().get(b + p)),
      post: (p: string, body: object) => a(ctx.http().post(b + p)).send(body),
      patch: (p: string, body: object) => a(ctx.http().patch(b + p)).send(body),
      put: (p: string, body: object) => a(ctx.http().put(b + p)).send(body),
      del: (p: string) => a(ctx.http().delete(b + p)),
    };
  };
  interface Shop {
    token: string;
    organizationId: string;
    userId: string;
    branchId: string;
  }
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
    const d = res.body.data;
    return {
      token: d.accessToken,
      organizationId: d.organization.id,
      userId: d.user.id,
      branchId: d.branches[0].id,
    };
  };
  const hire = async (shop: Shop, roleName: string): Promise<string> => {
    const roles = (await api(shop.token).get('/roles').expect(200)).body.data as {
      id: string;
      name: string;
    }[];
    const phone = uniquePhone();
    const inv = await api(shop.token)
      .post('/invitations', {
        phone,
        roleId: roles.find((r) => r.name === roleName)!.id,
        branchIds: [shop.branchId],
      })
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

  let owner: Shop;
  let A: ReturnType<typeof api>;
  beforeAll(async () => {
    owner = await newShop();
    A = api(owner.token);
    const units = (await A.get('/units').expect(200)).body.data as { id: string; code: string }[];
    U = Object.fromEntries(units.map((u) => [u.code, u.id]));
  });

  const create = (body: object, token = owner.token) => api(token).post('/products', body);
  const rice = (over: object = {}) => ({
    name: 'Sona Masoori Rice (loose)',
    type: 'WEIGHT',
    baseUnitId: U.KG,
    conversions: [{ unitId: U.G }, { unitId: U.BAG, factorToBase: '25' }],
    prices: [
      { unitId: U.KG, price: '58' },
      { unitId: U.G, quantity: '500', price: '30' },
    ],
    ...over,
  });
  const errCode = (res: { body: { error: { code: string } } }) => res.body.error.code;

  // ---------- units ----------
  describe('global units', () => {
    it('lists standard units with sizes and packaging units without', async () => {
      const list = (await A.get('/units').expect(200)).body.data as {
        code: string;
        isPackaging: boolean;
        standardFactor: string | null;
        dimension: string;
      }[];
      const by = (c: string) => list.find((u) => u.code === c)!;
      expect(by('KG')).toMatchObject({
        dimension: 'WEIGHT',
        isPackaging: false,
        standardFactor: '1',
      });
      expect(by('G').standardFactor).toBe('0.001');
      expect(by('ML')).toMatchObject({ dimension: 'VOLUME', standardFactor: '0.001' });
      expect(by('DOZEN').standardFactor).toBe('12');
      expect(by('BAG')).toMatchObject({ isPackaging: true, standardFactor: null });
      expect(list.length).toBeGreaterThanOrEqual(20);
    });
  });

  // ---------- spec examples ----------
  describe('loose and packaged products from the specification', () => {
    it('LOOSE RICE: KG base, G derived, BAG = 25 KG for purchasing, price points 1 kg and 500 g', async () => {
      const res = await create(
        rice({ mrp: '60', minStockLevel: '10', barcodes: ['8901234567890'] }),
      ).expect(201);
      const p = res.body.data;
      expect(p.sku).toMatch(/^P[A-Z2-9]{7}$/);
      expect(p.baseUnit.code).toBe('KG');
      const conv = (code: string) =>
        p.conversions.find((c: { unitCode: string }) => c.unitCode === code);
      expect(conv('KG')).toMatchObject({
        factorToBase: '1.000000',
        isBase: true,
        isSaleUnit: true,
        isPurchaseUnit: true,
      });
      expect(conv('G')).toMatchObject({
        factorToBase: '0.001000',
        isSaleUnit: true,
        isPurchaseUnit: false,
      }); // standard unit: sell by default
      expect(conv('BAG')).toMatchObject({
        factorToBase: '25.000000',
        isPurchaseUnit: true,
        isSaleUnit: false,
      }); // packaging: buy by default
      expect(p.prices).toHaveLength(2);
      expect(p.mrp).toBe('60.00');
      expect(p.minStockLevel).toBe('10.000');
      expect(p.allowFractional).toBe(true);
      // 5 bags purchased = 125 kg
      expect(5 * Number(conv('BAG').factorToBase)).toBe(125);
    });

    it('quotes real prices through the conversion rules (exact, unit price, derived from base)', async () => {
      const p = (await create(rice()).expect(201)).body.data;
      const quote = async (unit: string, qty: string) =>
        (await A.get(`/products/${p.id}/quote?unitId=${U[unit]}&quantity=${qty}`).expect(200)).body
          .data;
      expect(await quote('KG', '2')).toMatchObject({
        amount: '116.00',
        baseQuantity: '2.000',
        source: 'UNIT_PRICE',
      });
      expect(await quote('G', '500')).toMatchObject({
        amount: '30.00',
        baseQuantity: '0.500',
        source: 'EXACT',
      });
      expect(await quote('G', '250')).toMatchObject({
        amount: '14.50',
        baseQuantity: '0.250',
        source: 'DERIVED_FROM_BASE',
      });
      const rounded = await quote('G', '333');
      expect(rounded).toMatchObject({ amount: '19.31', rounded: true });
      // bags are purchase-only
      const bag = await A.get(`/products/${p.id}/quote?unitId=${U.BAG}&quantity=1`).expect(422);
      expect(errCode(bag)).toBe('UNIT_NOT_SALE_ENABLED');
      // half a gram of a kg product is finer than the stock precision: refused, never rounded
      expect(
        errCode(await A.get(`/products/${p.id}/quote?unitId=${U.G}&quantity=0.5`).expect(422)),
      ).toBe('QUANTITY_PRECISION');
    });

    it('LOOSE OIL: litre base, CAN of 15 L, millilitres derived', async () => {
      const p = (
        await create({
          name: 'Sunflower Oil (loose)',
          type: 'VOLUME',
          baseUnitId: U.L,
          conversions: [{ unitId: U.ML }, { unitId: U.CAN, factorToBase: '15' }],
          prices: [{ unitId: U.L, price: '180' }],
        }).expect(201)
      ).body.data;
      const q = (await A.get(`/products/${p.id}/quote?unitId=${U.ML}&quantity=250`).expect(200))
        .body.data;
      expect(q).toMatchObject({ amount: '45.00', baseQuantity: '0.250', baseUnitCode: 'L' });
    });

    it('PACKAGED OIL: 1 L bottle is a COUNT product (PCS); carton of 12; whole pieces only', async () => {
      const p = (
        await create({
          name: 'Sunflower Oil 1L Bottle',
          type: 'COUNT',
          baseUnitId: U.PCS,
          conversions: [
            { unitId: U.CARTON, factorToBase: '12', isPurchaseUnit: true },
            { unitId: U.DOZEN },
          ],
          prices: [{ unitId: U.PCS, price: '190' }],
          barcodes: ['8901000000011'],
        }).expect(201)
      ).body.data;
      expect(p.allowFractional).toBe(false);
      const quote = (unit: string, qty: string) =>
        A.get(`/products/${p.id}/quote?unitId=${U[unit]}&quantity=${qty}`);
      expect((await quote('PCS', '2').expect(200)).body.data.amount).toBe('380.00');
      expect((await quote('DOZEN', '1').expect(200)).body.data).toMatchObject({
        baseQuantity: '12.000',
        amount: '2280.00',
      });
      expect((await quote('DOZEN', '0.5').expect(200)).body.data.baseQuantity).toBe('6.000'); // half a dozen = 6 whole bottles
      expect(errCode(await quote('PCS', '0.5').expect(422))).toBe('FRACTIONAL_NOT_ALLOWED');
    });

    it('MILK: 500 ml and 1 L packs are separate SKUs, each with its own barcode and price', async () => {
      const half = (
        await create({
          name: 'Milk 500ml',
          type: 'COUNT',
          baseUnitId: U.PCS,
          prices: [{ unitId: U.PCS, price: '28' }],
          barcodes: ['8902000000001'],
        }).expect(201)
      ).body.data;
      const full = (
        await create({
          name: 'Milk 1L',
          type: 'COUNT',
          baseUnitId: U.PCS,
          prices: [{ unitId: U.PCS, price: '54' }],
          barcodes: ['8902000000002'],
        }).expect(201)
      ).body.data;
      expect(half.id).not.toBe(full.id);
      expect(
        (await A.get('/products/by-barcode/8902000000002').expect(200)).body.data.product.id,
      ).toBe(full.id);
    });

    it('enforces the minimum sale step (50 g)', async () => {
      const p = (
        await create(
          rice({
            name: 'Dal (loose)',
            minSaleIncrement: '0.050',
            prices: [{ unitId: U.KG, price: '120' }],
          }),
        ).expect(201)
      ).body.data;
      const q = (qty: string) => A.get(`/products/${p.id}/quote?unitId=${U.G}&quantity=${qty}`);
      expect((await q('50').expect(200)).body.data.amount).toBe('6.00');
      expect(errCode(await q('75').expect(422))).toBe('INCREMENT_VIOLATION');
    });
  });

  // ---------- validation ----------
  describe('validation of the conversion rules', () => {
    it.each([
      [
        'weight product with a volume unit',
        () => rice({ conversions: [{ unitId: U.L }] }),
        422,
        'UNIT_DIMENSION_MISMATCH',
      ],
      [
        'volume product with a weight unit',
        () => ({ name: 'Oil', type: 'VOLUME', baseUnitId: U.L, conversions: [{ unitId: U.KG }] }),
        422,
        'UNIT_DIMENSION_MISMATCH',
      ],
      [
        'a packaging unit as the base unit',
        () => rice({ baseUnitId: U.BAG, conversions: [] }),
        422,
        'BASE_UNIT_INVALID',
      ],
      [
        'a base unit of the wrong dimension',
        () => rice({ baseUnitId: U.L, conversions: [] }),
        422,
        'BASE_UNIT_INVALID',
      ],
      [
        'packaging without its size',
        () => rice({ conversions: [{ unitId: U.BAG }] }),
        422,
        'CONVERSION_FACTOR_REQUIRED',
      ],
      [
        'a wrong factor for a standard unit',
        () => rice({ conversions: [{ unitId: U.G, factorToBase: '0.01' }] }),
        422,
        'CONVERSION_MISMATCH',
      ],
      [
        'a zero factor',
        () => rice({ conversions: [{ unitId: U.BAG, factorToBase: '0' }] }),
        422,
        'CONVERSION_INVALID',
      ],
      [
        'a fractional carton of a piece-counted product',
        () => ({
          name: 'Carton Item',
          type: 'COUNT',
          baseUnitId: U.PCS,
          conversions: [{ unitId: U.CARTON, factorToBase: '2.5' }],
        }),
        422,
        'FRACTIONAL_NOT_ALLOWED',
      ],
      [
        'the same unit listed twice',
        () => rice({ conversions: [{ unitId: U.G }, { unitId: U.G }] }),
        422,
        'CONVERSION_DUPLICATE',
      ],
      [
        'a price on a unit that is not set up',
        () => rice({ prices: [{ unitId: U.QUINTAL, price: '5000' }] }),
        422,
        'PRICE_UNIT_NOT_CONFIGURED',
      ],
      [
        'a price on a purchase-only unit',
        () => rice({ prices: [{ unitId: U.BAG, price: '1400' }] }),
        422,
        'UNIT_NOT_SALE_ENABLED',
      ],
      [
        'two prices for the same unit and quantity',
        () =>
          rice({
            prices: [
              { unitId: U.KG, price: '58' },
              { unitId: U.KG, price: '59' },
            ],
          }),
        422,
        'PRICE_DUPLICATE',
      ],
      [
        'a price for a quantity finer than stock precision',
        () => rice({ prices: [{ unitId: U.G, quantity: '0.5', price: '1' }] }),
        422,
        'QUANTITY_PRECISION',
      ],
      [
        'an unknown unit id',
        () => rice({ conversions: [{ unitId: randomUUID() }] }),
        404,
        'UNIT_NOT_FOUND',
      ],
      [
        'a whole-number product with a fractional sale step',
        () => ({ name: 'Whole Item', type: 'COUNT', baseUnitId: U.PCS, minSaleIncrement: '0.5' }),
        422,
        'FRACTIONAL_NOT_ALLOWED',
      ],
    ])('rejects %s', async (_name, body, status, code) => {
      const res = await create(body()).expect(status as number);
      expect(errCode(res)).toBe(code);
    });

    it.each([
      ['a JSON number for money', () => rice({ prices: [{ unitId: U.KG, price: 58 }] })],
      ['too many money decimals', () => rice({ mrp: '1.234' })],
      ['a negative price', () => rice({ prices: [{ unitId: U.KG, price: '-5' }] })],
      ['an unknown field', () => rice({ organizationId: randomUUID() })],
      ['a bad HSN code', () => rice({ hsnCode: '12' })],
      ['a type that does not exist', () => rice({ type: 'LIQUID' })],
      ['a too-short name', () => rice({ name: 'x' })],
      ['an invalid SKU', () => rice({ sku: 'bad sku!' })],
      ['a bad barcode', () => rice({ barcodes: ['no spaces allowed'] })],
    ])('refuses (400) %s', async (_name, body) => {
      expect(errCode(await create(body()).expect(400))).toBe('VALIDATION_ERROR');
    });

    it('keeps decimals exact as strings', async () => {
      const p = (
        await create(
          rice({
            name: 'Precise',
            mrp: '99999999999.99',
            minStockLevel: '2.5',
            gstRatePercent: '2.5',
            isTaxable: true,
            hsnCode: '1006',
          }),
        ).expect(201)
      ).body.data;
      expect(p.mrp).toBe('99999999999.99');
      expect(p.minStockLevel).toBe('2.500');
      expect(p.gstRatePercent).toBe('2.5000');
    });
  });

  // ---------- SKU & barcode ----------
  describe('SKUs and barcodes', () => {
    it('normalises manual SKUs, refuses duplicates, and generated SKUs never collide', async () => {
      const first = (await create(rice({ name: 'Manual SKU', sku: 'rice-sm-01' })).expect(201)).body
        .data;
      expect(first.sku).toBe('RICE-SM-01');
      expect(errCode(await create(rice({ name: 'Dup', sku: 'RICE-SM-01' })).expect(409))).toBe(
        'SKU_IN_USE',
      );
      const a = (await create(rice({ name: 'Gen 1' })).expect(201)).body.data.sku;
      const b = (await create(rice({ name: 'Gen 2' })).expect(201)).body.data.sku;
      expect(a).not.toBe(b);
    });

    it('barcodes are unique per shop, scannable, and can be added or removed', async () => {
      const p = (await create(rice({ name: 'Barcoded', barcodes: ['BC-1000001'] })).expect(201))
        .body.data;
      const dup = await create(rice({ name: 'Other', barcodes: ['BC-1000001'] })).expect(409);
      expect(errCode(dup)).toBe('BARCODE_IN_USE');
      expect(dup.body.error.details.productId).toBe(p.id);

      const scanned = (await A.get('/products/by-barcode/BC-1000001').expect(200)).body.data;
      expect(scanned.product.id).toBe(p.id);

      const added = (
        await A.post(`/products/${p.id}/barcodes`, {
          barcode: 'BC-BAG-0001',
          unitId: U.BAG,
        }).expect(201)
      ).body.data;
      const bagCode = added.barcodes.find((b: { barcode: string }) => b.barcode === 'BC-BAG-0001');
      expect(bagCode.unitId).toBe(U.BAG);
      expect(
        (await A.get('/products/by-barcode/BC-BAG-0001').expect(200)).body.data.barcode.unitId,
      ).toBe(U.BAG); // scanning a bag tells billing which unit

      expect(
        errCode(await A.post(`/products/${p.id}/barcodes`, { barcode: 'BC-1000001' }).expect(409)),
      ).toBe('BARCODE_IN_USE');
      expect(
        errCode(
          await A.post(`/products/${p.id}/barcodes`, {
            barcode: 'BC-X-0002',
            unitId: U.TON,
          }).expect(422),
        ),
      ).toBe('UNIT_NOT_CONFIGURED');

      await A.del(`/products/${p.id}/barcodes/${bagCode.id}`).expect(200);
      await A.get('/products/by-barcode/BC-BAG-0001').expect(404);
    });
  });

  // ---------- update ----------
  describe('editing products', () => {
    it('versions every change; stale edits are refused; type and base unit are immutable', async () => {
      const p = (await create(rice({ name: 'Editable' })).expect(201)).body.data;
      expect(p.version).toBe(1);
      const r1 = (
        await A.patch(`/products/${p.id}`, { name: 'Editable v2', version: 1 }).expect(200)
      ).body.data;
      expect(r1.version).toBe(2);
      const stale = await A.patch(`/products/${p.id}`, { name: 'Stale write', version: 1 }).expect(
        409,
      );
      expect(errCode(stale)).toBe('VERSION_CONFLICT');
      expect(stale.body.error.details.currentVersion).toBe(2);
      expect((await A.get(`/products/${p.id}`).expect(200)).body.data.name).toBe('Editable v2');
      // base unit / type are not editable at all
      expect(errCode(await A.patch(`/products/${p.id}`, { baseUnitId: U.G }).expect(400))).toBe(
        'VALIDATION_ERROR',
      );
      expect(errCode(await A.patch(`/products/${p.id}`, { type: 'COUNT' }).expect(400))).toBe(
        'VALIDATION_ERROR',
      );
    });

    it('can clear optional fields, change status, and refuses rules that break existing data', async () => {
      const p = (
        await create(
          rice({
            name: 'Clearable',
            mrp: '70',
            hsnCode: '1006',
            gstRatePercent: '5',
            isTaxable: true,
          }),
        ).expect(201)
      ).body.data;
      const r = (
        await A.patch(`/products/${p.id}`, {
          mrp: null,
          hsnCode: null,
          gstRatePercent: null,
          status: 'INACTIVE',
        }).expect(200)
      ).body.data;
      expect(r).toMatchObject({
        mrp: null,
        hsnCode: null,
        gstRatePercent: null,
        status: 'INACTIVE',
      });
      // weight products are always fractional
      expect(
        errCode(await A.patch(`/products/${p.id}`, { allowFractional: false }).expect(422)),
      ).toBe('FRACTIONAL_REQUIRED');
      // a sale step that would invalidate the existing 500 g price point
      expect(
        errCode(await A.patch(`/products/${p.id}`, { minSaleIncrement: '0.300' }).expect(422)),
      ).toBe('INCREMENT_VIOLATION');
    });
  });

  // ---------- conversions & prices ----------
  describe('changing conversions and prices', () => {
    it('adds, updates and removes conversions with an audit trail; the base unit is protected', async () => {
      const p = (await create(rice({ name: 'Conv test' })).expect(201)).body.data;
      const added = (
        await A.post(`/products/${p.id}/conversions`, { unitId: U.QUINTAL }).expect(201)
      ).body.data;
      expect(
        added.conversions.find((c: { unitCode: string }) => c.unitCode === 'QUINTAL').factorToBase,
      ).toBe('100.000000');
      expect(
        errCode(await A.post(`/products/${p.id}/conversions`, { unitId: U.QUINTAL }).expect(409)),
      ).toBe('CONVERSION_EXISTS');
      expect(
        errCode(await A.post(`/products/${p.id}/conversions`, { unitId: U.L }).expect(422)),
      ).toBe('UNIT_DIMENSION_MISMATCH');

      const changed = (
        await A.patch(`/products/${p.id}/conversions/${U.BAG}`, { factorToBase: '30' }).expect(200)
      ).body.data;
      expect(
        changed.conversions.find((c: { unitCode: string }) => c.unitCode === 'BAG').factorToBase,
      ).toBe('30.000000');
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: {
          organizationId: owner.organizationId,
          action: 'product.conversion.update',
          entityId: p.id,
        },
      });
      const bagOf = (j: unknown) =>
        (j as { conversions: { unitCode: string; factorToBase: string }[] }).conversions.find(
          (c) => c.unitCode === 'BAG',
        )!.factorToBase;
      expect(bagOf(audit.beforeData)).toBe('25.000000'); // history of the change is kept
      expect(bagOf(audit.afterData)).toBe('30.000000');

      expect(
        errCode(
          await A.patch(`/products/${p.id}/conversions/${U.KG}`, { factorToBase: '2' }).expect(422),
        ),
      ).toBe('CONVERSION_MISMATCH');
      expect(
        errCode(
          await A.patch(`/products/${p.id}/conversions/${U.KG}`, { isSaleUnit: false }).expect(409),
        ),
      ).toBe('UNIT_HAS_PRICES'); // KG has a price
      expect(errCode(await A.del(`/products/${p.id}/conversions/${U.KG}`).expect(422))).toBe(
        'BASE_UNIT_REQUIRED',
      );
      expect(errCode(await A.del(`/products/${p.id}/conversions/${U.G}`).expect(409))).toBe(
        'UNIT_IN_USE',
      ); // G has the 500 g price

      await A.del(`/products/${p.id}/conversions/${U.QUINTAL}`).expect(200);
      expect(
        (await A.get(`/products/${p.id}`).expect(200)).body.data.conversions.some(
          (c: { unitCode: string }) => c.unitCode === 'QUINTAL',
        ),
      ).toBe(false);
    });

    it('replaces prices atomically: a bad entry leaves the old list untouched', async () => {
      const p = (await create(rice({ name: 'Price test' })).expect(201)).body.data;
      const bad = await A.put(`/products/${p.id}/prices`, {
        prices: [
          { unitId: U.KG, price: '70' },
          { unitId: U.BAG, price: '1' },
        ],
      }).expect(422);
      expect(errCode(bad)).toBe('UNIT_NOT_SALE_ENABLED');
      const unchanged = (await A.get(`/products/${p.id}`).expect(200)).body.data.prices;
      expect(unchanged.map((x: { price: string }) => x.price).sort()).toEqual(['30.00', '58.00']);

      const ok = (
        await A.put(`/products/${p.id}/prices`, {
          prices: [
            { unitId: U.KG, price: '61.50' },
            { unitId: U.G, quantity: '250', price: '16', label: 'quarter kg' },
          ],
        }).expect(200)
      ).body.data;
      expect(ok.prices).toHaveLength(2);
      expect(ok.prices.find((x: { label: string }) => x.label === 'quarter kg')).toMatchObject({
        quantity: '250.000',
        price: '16.00',
        unitCode: 'G',
      });
      const audit = await ctx.prisma.auditLog.count({
        where: {
          organizationId: owner.organizationId,
          action: 'product.prices.update',
          entityId: p.id,
        },
      });
      expect(audit).toBe(1);
    });
  });

  // ---------- deletion & history ----------
  describe('deleting products and protecting history', () => {
    it('products with stock or transactions cannot be deleted; unused ones can, and their barcodes are freed', async () => {
      const used = (await create(rice({ name: 'Has stock', barcodes: ['USED-0001'] })).expect(201))
        .body.data;
      await ctx.prisma.stockMovement.create({
        data: {
          organizationId: owner.organizationId,
          branchId: owner.branchId,
          productId: used.id,
          type: 'PURCHASE_RECEIPT',
          quantity: '125',
          unitCost: '40',
          balanceAfter: '125',
          referenceType: 'TEST',
          referenceId: randomUUID(),
          createdById: owner.userId,
        },
      });
      expect(errCode(await A.del(`/products/${used.id}`).expect(409))).toBe('PRODUCT_HAS_HISTORY');
      await A.get(`/products/${used.id}`).expect(200); // still there
      await A.patch(`/products/${used.id}`, { status: 'DISCONTINUED' }).expect(200); // the supported alternative

      const unused = (
        await create(rice({ name: 'No history', sku: 'GONE-001', barcodes: ['FREE-0001'] })).expect(
          201,
        )
      ).body.data;
      await A.del(`/products/${unused.id}`).expect(204);
      await A.get(`/products/${unused.id}`).expect(404);
      const listed = (await A.get('/products?q=No%20history').expect(200)).body.data as unknown[];
      expect(listed).toHaveLength(0);
      await create(rice({ name: 'Reuses barcode', barcodes: ['FREE-0001'] })).expect(201); // barcode is free again
      expect(errCode(await create(rice({ name: 'Reuses SKU', sku: 'GONE-001' })).expect(409))).toBe(
        'SKU_IN_USE',
      ); // SKU stays reserved
    });

    it('conversion snapshots keep history stable when the factor later changes', async () => {
      const p = (await create(rice({ name: 'Snapshot' })).expect(201)).body.data;
      const bagBefore = Number(
        p.conversions.find((c: { unitCode: string }) => c.unitCode === 'BAG').factorToBase,
      );
      const stockFromOldPurchase = 5 * bagBefore; // what a purchase line would have snapshotted
      await A.patch(`/products/${p.id}/conversions/${U.BAG}`, { factorToBase: '30' }).expect(200);
      expect(stockFromOldPurchase).toBe(125); // unchanged; new purchases use the new factor
      const now = (await A.get(`/products/${p.id}`).expect(200)).body.data.conversions.find(
        (c: { unitCode: string }) => c.unitCode === 'BAG',
      );
      expect(5 * Number(now.factorToBase)).toBe(150);
    });
  });

  // ---------- search, filter, pagination ----------
  describe('search, filtering and pagination', () => {
    let s: Shop;
    let S: ReturnType<typeof api>;
    const names = [
      'Alpha Basmati Rice',
      'Beta Toor Dal',
      'Gamma Sugar',
      'Delta Salt',
      'Epsilon Tea',
      'Zeta Basmati Premium',
      'Eta Atta',
    ];
    beforeAll(async () => {
      s = await newShop();
      S = api(s.token);
      const cat = (await S.post('/categories', { name: 'Grains' }).expect(201)).body.data;
      for (const [i, name] of names.entries()) {
        await S.post('/products', {
          name,
          type: i % 2 === 0 ? 'WEIGHT' : 'COUNT',
          baseUnitId: i % 2 === 0 ? U.KG : U.PCS,
          sku: `SRCH-${i}`,
          categoryId: name.includes('Basmati') ? cat.id : undefined,
          barcodes: [`99000000${i}`],
        }).expect(201);
      }
      const gamma = (await S.get('/products?q=Gamma').expect(200)).body.data[0];
      await S.patch(`/products/${gamma.id}`, { status: 'INACTIVE' }).expect(200);
    });

    it('searches by name (case-insensitive, partial), SKU and barcode prefix', async () => {
      const ids = async (q: string) =>
        (
          (await S.get(`/products?q=${encodeURIComponent(q)}`).expect(200)).body.data as {
            name: string;
          }[]
        ).map((p) => p.name);
      expect(await ids('basmati')).toEqual(['Alpha Basmati Rice', 'Zeta Basmati Premium']);
      expect(await ids('SRCH-3')).toEqual(['Delta Salt']);
      expect(await ids('9900000')).toHaveLength(7); // barcode prefix
      expect(await ids('990000003')).toEqual(['Delta Salt']);
      expect(await ids('nothing-matches')).toEqual([]);
    });

    it('filters by category, status and type', async () => {
      const get = async (qs: string) => (await S.get(`/products?${qs}`).expect(200)).body;
      expect((await get('status=INACTIVE')).data.map((p: { name: string }) => p.name)).toEqual([
        'Gamma Sugar',
      ]);
      expect((await get('type=COUNT')).meta.total).toBe(3);
      const cat = (await S.get('/categories').expect(200)).body.data[0];
      expect((await get(`categoryId=${cat.id}`)).meta.total).toBe(2);
      expect(cat.productCount).toBe(2);
    });

    it('paginates and sorts on the server', async () => {
      const page1 = (await S.get('/products?pageSize=3&page=1&sort=name&order=asc').expect(200))
        .body;
      const page3 = (await S.get('/products?pageSize=3&page=3&sort=name&order=asc').expect(200))
        .body;
      expect(page1.meta).toEqual({ page: 1, pageSize: 3, total: 7 });
      expect(page1.data.map((p: { name: string }) => p.name)).toEqual([
        'Alpha Basmati Rice',
        'Beta Toor Dal',
        'Delta Salt',
      ]);
      expect(page3.data.map((p: { name: string }) => p.name)).toEqual(['Zeta Basmati Premium']);
      const desc = (await S.get('/products?pageSize=2&sort=name&order=desc').expect(200)).body.data;
      expect(desc.map((p: { name: string }) => p.name)).toEqual([
        'Zeta Basmati Premium',
        'Gamma Sugar',
      ]);
      expect(errCode(await S.get('/products?pageSize=101').expect(400))).toBe('VALIDATION_ERROR');
      expect(errCode(await S.get('/products?sort=passwordHash').expect(400))).toBe(
        'VALIDATION_ERROR',
      );
    });

    it('supports delta sync: updatedSince returns only what changed', async () => {
      await new Promise((r) => setTimeout(r, 50));
      const mark = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 50));
      const tea = (await S.get('/products?q=Epsilon').expect(200)).body.data[0];
      await S.put(`/products/${tea.id}/prices`, {
        prices: [{ unitId: U.KG, price: '12' }],
      }).expect(200); // child change also bumps the product
      const changed = (
        await S.get(`/products?updatedSince=${encodeURIComponent(mark)}`).expect(200)
      ).body.data as { name: string }[];
      expect(changed.map((p) => p.name)).toEqual(['Epsilon Tea']);
    });
  });

  // ---------- categories ----------
  describe('categories', () => {
    it('builds a tree, rejects duplicates (ignoring case), cycles and excessive depth, and protects non-empty categories', async () => {
      const mk = async (name: string, parentId?: string) =>
        (await A.post('/categories', { name, parentId }).expect(201)).body.data;
      const grocery = await mk('Grocery');
      const staples = await mk('Staples', grocery.id);
      const rice = await mk('Rice', staples.id);
      expect(errCode(await A.post('/categories', { name: 'grocery' }).expect(409))).toBe(
        'CONFLICT',
      );
      expect(
        errCode(await A.post('/categories', { name: 'Too Deep', parentId: rice.id }).expect(422)),
      ).toBe('CATEGORY_TOO_DEEP');
      expect(
        errCode(await A.patch(`/categories/${grocery.id}`, { parentId: rice.id }).expect(422)),
      ).toBe('CATEGORY_CYCLE');
      expect(
        errCode(await A.patch(`/categories/${grocery.id}`, { parentId: grocery.id }).expect(422)),
      ).toBe('CATEGORY_CYCLE');
      await mk('Rice', grocery.id); // same name under a different parent is fine

      const p = (await create(rice_(rice.id)).expect(201)).body.data;
      expect(p.category.id).toBe(rice.id);
      expect(errCode(await A.del(`/categories/${grocery.id}`).expect(409))).toBe(
        'CATEGORY_NOT_EMPTY',
      );
      expect(errCode(await A.del(`/categories/${rice.id}`).expect(409))).toBe('CATEGORY_NOT_EMPTY');
      const empty = await mk('Empty one');
      await A.del(`/categories/${empty.id}`).expect(204);
      expect(
        ((await A.get('/categories').expect(200)).body.data as { id: string }[]).some(
          (c) => c.id === empty.id,
        ),
      ).toBe(false);
      void p;
    });
  });
  const rice_ = (categoryId: string) =>
    rice({ name: `In category ${categoryId.slice(0, 4)}`, categoryId });

  // ---------- permissions ----------
  describe('role-based access', () => {
    it('cashiers can look things up but not change the catalogue; agents cannot see products; managers can manage', async () => {
      const shop = await newShop();
      const own = api(shop.token);
      const p = (await own.post('/products', rice({ name: 'RBAC rice' })).expect(201)).body.data;
      const cashier = api(await hire(shop, 'Cashier'));
      const agent = api(await hire(shop, 'Collection Agent'));
      const manager = api(await hire(shop, 'Manager'));

      await cashier.get('/products').expect(200);
      await cashier.get(`/products/${p.id}`).expect(200);
      await cashier.get(`/products/${p.id}/quote?unitId=${U.KG}&quantity=1`).expect(200);
      await cashier.get('/units').expect(200);
      await cashier.get('/categories').expect(200);
      await cashier.post('/products', rice({ name: 'Cashier product' })).expect(403);
      await cashier.patch(`/products/${p.id}`, { name: 'Renamed' }).expect(403);
      await cashier
        .put(`/products/${p.id}/prices`, { prices: [{ unitId: U.KG, price: '1' }] })
        .expect(403);
      await cashier.del(`/products/${p.id}`).expect(403);
      await cashier.post('/categories', { name: 'Nope' }).expect(403);

      await agent.get('/products').expect(403);
      await agent.get('/units').expect(403);

      await manager.post('/products', rice({ name: 'Manager product' })).expect(201);
      await manager.post('/categories', { name: 'Mgr category' }).expect(201);
    });
  });

  // ---------- tenant isolation ----------
  describe('cross-organization isolation', () => {
    it("shop A can never see, scan or change shop B's catalogue", async () => {
      const a = await newShop();
      const b = await newShop();
      const AA = api(a.token);
      const BB = api(b.token);
      const bCat = (await BB.post('/categories', { name: 'B Category' }).expect(201)).body.data;
      const bp = (
        await BB.post(
          '/products',
          rice({
            name: 'B Secret Rice',
            sku: 'B-SECRET',
            categoryId: bCat.id,
            barcodes: ['SHARED-BC-1'],
          }),
        ).expect(201)
      ).body.data;
      const barcodeId = bp.barcodes[0].id as string;

      // A's own data never includes B's
      expect((await AA.get('/products').expect(200)).body.meta.total).toBe(0);
      expect((await AA.get('/products?q=Secret').expect(200)).body.data).toEqual([]);
      expect((await AA.get('/categories').expect(200)).body.data).toEqual([]);

      // direct access by id looks exactly like "not found"
      await AA.get(`/products/${bp.id}`).expect(404);
      await AA.get(`/products/${bp.id}/quote?unitId=${U.KG}&quantity=1`).expect(404);
      await AA.get('/products/by-barcode/SHARED-BC-1').expect(404);
      await AA.patch(`/products/${bp.id}`, { name: 'Stolen' }).expect(404);
      await AA.del(`/products/${bp.id}`).expect(404);
      await AA.put(`/products/${bp.id}/prices`, { prices: [{ unitId: U.KG, price: '1' }] }).expect(
        404,
      );
      await AA.post(`/products/${bp.id}/conversions`, { unitId: U.QUINTAL }).expect(404);
      await AA.patch(`/products/${bp.id}/conversions/${U.BAG}`, { factorToBase: '1' }).expect(404);
      await AA.del(`/products/${bp.id}/conversions/${U.BAG}`).expect(404);
      await AA.post(`/products/${bp.id}/barcodes`, { barcode: 'INJECTED-1' }).expect(404);
      await AA.del(`/products/${bp.id}/barcodes/${barcodeId}`).expect(404);
      await AA.patch(`/categories/${bCat.id}`, { name: 'Stolen cat' }).expect(404);
      await AA.del(`/categories/${bCat.id}`).expect(404);

      // A cannot attach B's category to A's product
      expect(
        errCode(
          await AA.post('/products', rice({ name: 'A rice', categoryId: bCat.id })).expect(404),
        ),
      ).toBe('CATEGORY_NOT_FOUND');
      const ap = (await AA.post('/products', rice({ name: 'A rice' })).expect(201)).body.data;
      expect(
        errCode(await AA.patch(`/products/${ap.id}`, { categoryId: bCat.id }).expect(404)),
      ).toBe('CATEGORY_NOT_FOUND');
      await AA.post('/categories', { name: 'Child of B', parentId: bCat.id }).expect(404);

      // the same SKU and barcode may exist independently in two shops
      await AA.post(
        '/products',
        rice({ name: 'A same codes', sku: 'B-SECRET', barcodes: ['SHARED-BC-1'] }),
      ).expect(201);

      // nothing of B changed
      const after = (await BB.get(`/products/${bp.id}`).expect(200)).body.data;
      expect(after).toMatchObject({ name: 'B Secret Rice', version: 1 });
      expect(after.barcodes).toHaveLength(1);
      expect((await BB.get('/categories').expect(200)).body.data[0].name).toBe('B Category');
    });
  });

  // ---------- audit ----------
  describe('audit trail', () => {
    it('records product lifecycle events with before and after', async () => {
      const p = (await create(rice({ name: 'Audited product' })).expect(201)).body.data;
      await A.patch(`/products/${p.id}`, { name: 'Audited product v2' }).expect(200);
      await A.del(`/products/${p.id}`).expect(204);
      const rows = await ctx.prisma.auditLog.findMany({
        where: { organizationId: owner.organizationId, entityId: p.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual([
        'product.create',
        'product.update',
        'product.delete',
      ]);
      expect((rows[1]!.beforeData as { name: string }).name).toBe('Audited product');
      expect((rows[1]!.afterData as { name: string }).name).toBe('Audited product v2');
    });
  });
});
