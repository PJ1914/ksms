import { randomUUID } from 'node:crypto';
import {
  IntegrationApp,
  TestSchema,
  createIntegrationApp,
  createTestSchema,
  testDbUrl,
  uniquePhone,
} from './harness';

/**
 * Audit of Phase 10 (GST billing and invoices) on a real database. Each test states a rule a GST bill must satisfy and
 * checks it through the API. A failing test here is a defect found by the audit.
 */
const suite = testDbUrl() ? describe : describe.skip;
const PW = 'Str0ng-Pass!';
const B = '/api/v1';
const GSTIN_TS = '36AABCU9603R1ZM'; // 36 = Telangana
const GSTIN_MH = '27AABCU9603R1ZM'; // 27 = Maharashtra

suite('Phase 10 audit: GST billing (real database)', () => {
  jest.setTimeout(900_000);
  let db: TestSchema;
  let ctx: IntegrationApp;
  let n = 0;

  beforeAll(async () => {
    db = await createTestSchema();
    ctx = await createIntegrationApp(db);
  });
  afterAll(async () => {
    await ctx?.close();
    await db?.drop();
  });

  interface Shop {
    token: string;
    organizationId: string;
    branchId: string;
    pcs: string;
  }
  const api = (token: string, branchId?: string) => {
    const a = <T extends { set(k: string, v: string): T }>(r: T) => {
      r.set('Authorization', `Bearer ${token}`);
      if (branchId) r.set('x-branch-id', branchId);
      return r;
    };
    return {
      get: (p: string) => a(ctx.http().get(B + p)),
      post: (p: string, body: object = {}, key: string | null = randomUUID()) => {
        const r = a(ctx.http().post(B + p));
        if (key) r.set('idempotency-key', key);
        return r.send(body);
      },
      patch: (p: string, body: object) => a(ctx.http().patch(B + p)).send(body),
    };
  };
  const errCode = (res: { body: { error: { code: string } } }) => res.body.error.code;

  /** A GST-registered shop in Telangana, ready to bill. */
  async function gstShop(): Promise<Shop & { A: ReturnType<typeof api> }> {
    const phone = uniquePhone();
    const res = await ctx
      .http()
      .post(`${B}/auth/register-owner`)
      .send({
        fullName: 'Owner',
        phone,
        password: PW,
        shopName: `GST ${phone}`,
        deviceUid: `d-${phone}`,
      })
      .expect(201);
    const x = res.body.data;
    await ctx.prisma.organization.update({
      where: { id: x.organization.id },
      data: { gstEnabled: true },
    });
    const token = x.accessToken as string;
    const branchId = x.branches[0].id as string;
    await api(token)
      .patch(`/branches/${branchId}`, { gstin: GSTIN_TS, stateCode: '36' })
      .expect(200);
    const units = (await api(token).get('/units').expect(200)).body.data as {
      id: string;
      code: string;
    }[];
    return {
      token,
      organizationId: x.organization.id,
      branchId,
      pcs: units.find((u) => u.code === 'PCS')!.id,
      A: api(token, branchId),
    };
  }

  async function taxedProduct(
    s: Awaited<ReturnType<typeof gstShop>>,
    over: Record<string, unknown> = {},
    stock = '100',
  ) {
    const p = (
      await api(s.token)
        .post(
          '/products',
          {
            name: `Item ${String(++n).padStart(2, '0')}`,
            type: 'COUNT',
            baseUnitId: s.pcs,
            isTaxable: true,
            gstRatePercent: '18',
            hsnCode: '3401',
            prices: [{ unitId: s.pcs, price: '118' }],
            ...over,
          },
          null,
        )
        .expect(201)
    ).body.data as { id: string };
    if (stock !== '0')
      await s.A.post('/inventory/opening-stock', {
        productId: p.id,
        unitId: s.pcs,
        quantity: stock,
        unitCost: '50',
      }).expect(201);
    return p;
  }
  const line = (productId: string, unitId: string, quantity: string, extra: object = {}) => ({
    productId,
    unitId,
    quantity,
    ...extra,
  });
  const cash = (amount: string) => ({ method: 'CASH', amount });

  // ------------------------------------------------------------------ the law on invoice numbers

  it('RULE 46: a GST invoice number is at most 16 characters (letters, digits, "-" and "/")', async () => {
    const s = await gstShop();
    const taxed = await taxedProduct(s);
    const exempt = await taxedProduct(s, {
      isTaxable: false,
      gstRatePercent: undefined,
      name: `Exempt ${++n}`,
    });
    const tax = (
      await s.A.post('/sales', {
        items: [line(taxed.id, s.pcs, '1')],
        payments: [cash('118')],
      }).expect(201)
    ).body.data;
    const bos = (
      await s.A.post('/sales', {
        items: [line(exempt.id, s.pcs, '1')],
        payments: [cash('118')],
      }).expect(201)
    ).body.data;
    for (const inv of [tax.invoice, bos.invoice]) {
      expect(inv.invoiceNumber).toMatch(/^[A-Za-z0-9/-]+$/);
      expect([inv.type, inv.invoiceNumber.length]).toEqual([inv.type, expect.any(Number)]);
      expect(inv.invoiceNumber.length).toBeLessThanOrEqual(16);
    }
  });

  it('invoice numbers are consecutive and never repeat, even when many bills are made at once or one is cancelled', async () => {
    const s = await gstShop();
    const p = await taxedProduct(s);
    const all = await Promise.all(
      Array.from({ length: 10 }, () =>
        s.A.post('/sales', { items: [line(p.id, s.pcs, '1')], payments: [cash('118')] }),
      ),
    );
    expect(all.every((r) => r.status === 201)).toBe(true);
    const seq = all.map((r) => r.body.data.invoice.sequenceNumber as number).sort((a, b) => a - b);
    expect(seq).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));

    const victim = all[3]!.body.data;
    await s.A.post(`/sales/${victim.id}/cancel`, { reason: 'wrong customer' }).expect(200);
    const next = (
      await s.A.post('/sales', { items: [line(p.id, s.pcs, '1')], payments: [cash('118')] }).expect(
        201,
      )
    ).body.data;
    expect(next.invoice.sequenceNumber).toBe(11); // the cancelled number is not reused
    const list = (await s.A.get('/invoices?pageSize=50').expect(200)).body.data as {
      sequenceNumber: number;
      status: string;
    }[];
    expect(list.find((i) => i.sequenceNumber === victim.invoice.sequenceNumber)?.status).toBe(
      'CANCELLED',
    );
  });

  // ------------------------------------------------------------------ products that were never set up for GST

  it('a taxable product with no GST rate is refused, not billed at 0% tax', async () => {
    const s = await gstShop();
    const p = await taxedProduct(s, { gstRatePercent: undefined, name: `No rate ${++n}` });
    const res = await s.A.post('/sales', {
      items: [line(p.id, s.pcs, '1')],
      payments: [cash('118')],
    });
    expect(res.status).toBe(422);
    expect(errCode(res)).toBe('PRODUCT_GST_RATE_MISSING');
  });

  // ------------------------------------------------------------------ the preview and the bill agree

  it('the cart preview and the real bill agree on every tax figure (mixed rates, discount, other-state buyer)', async () => {
    const s = await gstShop();
    const a = await taxedProduct(s, {
      gstRatePercent: '5',
      prices: [{ unitId: s.pcs, price: '105' }],
    });
    const b = await taxedProduct(s, {
      gstRatePercent: '18',
      taxMode: 'EXCLUSIVE',
      prices: [{ unitId: s.pcs, price: '100' }],
    });
    const buyer = (
      await api(s.token)
        .post('/customers', { name: 'Pune Mart', gstin: GSTIN_MH, stateCode: '27' }, null)
        .expect(201)
    ).body.data;
    const body = {
      customerId: buyer.id,
      items: [line(a.id, s.pcs, '3'), line(b.id, s.pcs, '2')],
      billDiscount: '10',
    };
    const pv = (await s.A.post('/sales/preview', body, null).expect(200)).body.data;
    const sale = (await s.A.post('/sales', { ...body, payments: [cash(pv.total)] }).expect(201))
      .body.data;
    expect(pv.interState).toBe(true);
    for (const f of [
      'taxableTotal',
      'cgstTotal',
      'sgstTotal',
      'igstTotal',
      'taxTotal',
      'roundOff',
      'total',
    ] as const) {
      expect([f, pv[f]]).toEqual([f, sale[f]]);
    }
    expect(sale.cgstTotal).toBe('0.00');
    expect(sale.igstTotal).toBe(pv.taxTotal);
  });

  // ------------------------------------------------------------------ returns on a GST bill

  it('returning a GST bill in pieces gives back exactly the bill total and exactly the bill tax (no paisa lost)', async () => {
    const s = await gstShop();
    const p = await taxedProduct(s, { prices: [{ unitId: s.pcs, price: '33.33' }] }); // 18% included
    const sale = (
      await s.A.post('/sales', { items: [line(p.id, s.pcs, '7')], payments: [cash('233')] }).expect(
        201,
      )
    ).body.data;
    expect(sale.taxTotal).toBe('35.59'); // 233.31 x 18 / 118
    const ret = async (q: string) =>
      (
        await s.A.post('/sale-returns', {
          saleId: sale.id,
          reason: 'not needed',
          refundTo: 'CASH',
          items: [{ saleItemId: sale.items[0].id, quantity: q, disposition: 'SALEABLE' }],
        }).expect(201)
      ).body.data as { total: string; taxTotal: string };
    const parts = [await ret('3'), await ret('2'), await ret('2')];
    const sum = (f: 'total' | 'taxTotal') =>
      parts.reduce((a, r) => a + Math.round(Number(r[f]) * 100), 0) / 100;
    expect(sum('taxTotal')).toBe(35.59);
    expect(sum('total')).toBe(233);
    expect((await s.A.get(`/sales/${sale.id}`).expect(200)).body.data).toMatchObject({
      returnedTotal: '233.00',
      refundedTotal: '233.00',
    });
    expect((await s.A.get('/sales/reconciliation').expect(200)).body.data.consistent).toBe(true);
  });

  // ------------------------------------------------------------------ the invoice document

  it('an invoice cannot be changed after it is issued: not its type and not its issue date either', async () => {
    const s = await gstShop();
    const p = await taxedProduct(s);
    const sale = (
      await s.A.post('/sales', { items: [line(p.id, s.pcs, '1')], payments: [cash('118')] }).expect(
        201,
      )
    ).body.data;
    const attempt = (sql: string) => ctx.prisma.$executeRawUnsafe(sql);
    await expect(
      attempt(`UPDATE invoices SET type = 'NORMAL' WHERE id = '${sale.invoice.id}'`),
    ).rejects.toThrow();
    await expect(
      attempt(
        `UPDATE invoices SET issued_at = now() - interval '40 days' WHERE id = '${sale.invoice.id}'`,
      ),
    ).rejects.toThrow();
  });

  it('the PDF shows EVERY line of the bill, not just the first few', async () => {
    const s = await gstShop();
    const items = [];
    for (let i = 0; i < 32; i++) items.push(line((await taxedProduct(s)).id, s.pcs, '1'));
    const sale = (await s.A.post('/sales', { items, payments: [cash('3776')] }).expect(201)).body
      .data;
    expect(sale.items).toHaveLength(32);
    const pdf = (await s.A.get(`/invoices/${sale.invoice.id}/pdf`).expect(200)).body as Buffer;
    const text = pdf.toString('latin1');
    const shown = sale.items.filter(
      (i: { name: string }) => text.includes(`(${i.name})`) || text.includes(i.name),
    );
    expect(shown.length).toBe(32);
  });

  it('the PDF shows the invoice date in India time (not UTC)', async () => {
    const s = await gstShop();
    const p = await taxedProduct(s);
    const sale = (
      await s.A.post('/sales', { items: [line(p.id, s.pcs, '1')], payments: [cash('118')] }).expect(
        201,
      )
    ).body.data;
    const issued = new Date(sale.invoice.issuedAt as string).getTime();
    const india = new Date(issued + 5.5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
    const pdf = (
      (await s.A.get(`/invoices/${sale.invoice.id}/pdf`).expect(200)).body as Buffer
    ).toString('latin1');
    expect(pdf).toContain(`Date: ${india} IST`);
    expect(pdf).not.toContain(' UTC');
  });

  it("a place of supply typed at the counter is respected, and a plain walk-in bill is in the shop's own state", async () => {
    const s = await gstShop();
    const p = await taxedProduct(s);
    const walkIn = (
      await s.A.post('/sales', { items: [line(p.id, s.pcs, '1')], payments: [cash('118')] }).expect(
        201,
      )
    ).body.data;
    expect([walkIn.placeOfSupplyStateCode, walkIn.igstTotal]).toEqual(['36', '0.00']);
    const other = (
      await s.A.post('/sales', {
        items: [line(p.id, s.pcs, '1')],
        payments: [cash('118')],
        placeOfSupplyStateCode: '27',
      }).expect(201)
    ).body.data;
    expect([other.placeOfSupplyStateCode, other.cgstTotal, other.igstTotal]).toEqual([
      '27',
      '0.00',
      '18.00',
    ]);
  });
});
