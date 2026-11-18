import {
  type InvoicePdfData,
  type InvoicePdfLine,
  formatIssuedAt,
  renderInvoicePdf,
} from './invoice-pdf';

const seller = {
  organizationName: 'Sri Lakshmi Kirana',
  legalName: 'Sri Lakshmi Traders',
  branchName: 'Main Branch',
  branchCode: 'MAIN',
  addressLine: 'MG Road',
  city: 'Hyderabad',
  state: 'Telangana',
  pincode: '500001',
  stateCode: '36',
  gstin: '36AABCU9603R1ZM',
  pan: 'AABCU9603R',
  phone: '9876543210',
};

const line = (name: string, over: Partial<InvoicePdfLine> = {}): InvoicePdfLine => ({
  name,
  hsn: '1006',
  quantity: '1.000',
  unitCode: 'KG',
  unitPrice: '105.00',
  discount: '0.00',
  taxableValue: '100.00',
  taxRatePercent: '5.0000',
  cgst: '2.50',
  sgst: '2.50',
  igst: '0.00',
  lineTotal: '105.00',
  ...over,
});

function invoice(lines: InvoicePdfLine[], over: Partial<InvoicePdfData> = {}): InvoicePdfData {
  return {
    invoiceNumber: 'INV/26-27/000001',
    saleNumber: 'INV/26-27/000001',
    type: 'GST',
    status: 'ISSUED',
    issuedAt: new Date('2026-11-19T10:00:00Z'),
    seller,
    buyer: { name: 'Ramesh', phone: '9123456780', gstin: null, stateCode: '36', addressLine: null },
    totals: {
      subtotal: '105.00',
      discountTotal: '0.00',
      taxableTotal: '100.00',
      cgstTotal: '2.50',
      sgstTotal: '2.50',
      igstTotal: '0.00',
      taxTotal: '5.00',
      roundOff: '0.00',
      total: '105.00',
      paidTotal: '105.00',
      creditAmount: '0.00',
      taxMode: 'INCLUSIVE',
      placeOfSupplyStateCode: '36',
      interState: false,
      lines,
    },
    ...over,
  };
}

const text = (pdf: Buffer) => pdf.toString('ascii');
const pageCount = (t: string) => Number(/\/Count (\d+)/.exec(t)![1]);

describe('renderInvoicePdf', () => {
  it('a normal GST invoice carries the number, seller, buyer, tax breakdown and the reverse-charge statement', () => {
    const t = text(renderInvoicePdf(invoice([line('Sona Masoori Rice')])));
    for (const expected of [
      '%PDF-1.4',
      'TAX INVOICE',
      'INV/26-27/000001',
      'Sri Lakshmi Traders',
      '36AABCU9603R1ZM',
      'Sona Masoori Rice',
      'CGST:',
      'SGST:',
      'Tax payable on reverse charge: No',
      'Page 1 of 1',
    ]) {
      expect(t).toContain(expected);
    }
    expect(t.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it.each([1, 10, 28, 29, 30, 45, 60, 150])(
    'a bill of %i lines shows EVERY line and the totals',
    (n) => {
      const names = Array.from(
        { length: n },
        (_, i) => `Product number ${String(i + 1).padStart(3, '0')}`,
      );
      const t = text(renderInvoicePdf(invoice(names.map((x) => line(x)))));
      for (const name of names) expect(t).toContain(`(${name})`);
      expect(t).toContain('Grand Total:');
      expect(t).toContain(`Page ${pageCount(t)} of ${pageCount(t)}`);
    },
  );

  it('long bills continue on further pages that repeat the table header and say "continued"', () => {
    const lines = Array.from({ length: 60 }, (_, i) => line(`Item ${i + 1}`));
    const t = text(renderInvoicePdf(invoice(lines)));
    const pages = pageCount(t);
    expect(pages).toBeGreaterThan(1);
    expect((t.match(/\(Item\)/g) ?? []).length).toBe(pages); // the column header on every page
    expect((t.match(/\(TAX INVOICE \\\(continued\\\)\)/g) ?? []).length).toBe(pages - 1);
    for (let i = 1; i <= pages; i++) expect(t).toContain(`(Page ${i} of ${pages})`);
  });

  it('the totals never run off the bottom of a page', () => {
    for (let n = 1; n <= 80; n++) {
      const t = text(
        renderInvoicePdf(invoice(Array.from({ length: n }, (_, i) => line(`Item ${i + 1}`)))),
      );
      const ys = [...t.matchAll(/Tm \(/g)].length; // sanity: something was drawn
      expect(ys).toBeGreaterThan(0);
      // every text position is above the footer line (y >= 60), except the footer itself at y = 30
      for (const m of t.matchAll(/1 0 0 1 ([\d.]+) ([\d.-]+) Tm/g)) {
        const y = Number(m[2]);
        expect(y === 30 || y >= 55).toBe(true);
      }
    }
  });

  it('is a well-formed file: every cross-reference offset points at its object, and startxref at the table', () => {
    const buf = renderInvoicePdf(
      invoice(Array.from({ length: 70 }, (_, i) => line(`Item ${i + 1}`))),
    );
    const t = text(buf);
    const start = Number(/startxref\n(\d+)\n/.exec(t)![1]);
    expect(t.slice(start, start + 4)).toBe('xref');
    const entries = [...t.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThan(5);
    entries.forEach((off, i) =>
      expect(t.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`),
    );
    // each stream's declared /Length is exactly its length
    for (const m of t.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) {
      expect(Number(m[1])).toBe(Buffer.byteLength(m[2]!, 'ascii'));
    }
  });

  it('shows the date in India time: 19:00 UTC on the 18th is 00:30 on the 19th', () => {
    const t = text(
      renderInvoicePdf(invoice([line('Rice')], { issuedAt: new Date('2026-11-18T19:00:00Z') })),
    );
    expect(t).toContain('Date: 2026-11-19 00:30 IST');
    expect(formatIssuedAt('2026-03-31T18:29:00Z')).toBe('2026-03-31 23:59 IST');
    expect(formatIssuedAt('2026-03-31T18:30:00Z')).toBe('2026-04-01 00:00 IST');
  });

  it('text is escaped so names with brackets and backslashes cannot break the file; other scripts become "?"', () => {
    const t = text(
      renderInvoicePdf(
        invoice([line('Soap (large) \\ 5% off'), line('అన్నం Rice'), line('Rs ₹ 5')]),
      ),
    );
    expect(t).toContain('(Soap \\(large\\) \\\\ 5% off)');
    expect(t).toContain('(????? Rice)');
    expect(t).toContain('(Rs Rs.  5)');
    // brackets in a string are always escaped, so every text operator stays balanced
    for (const m of t.matchAll(/\((.*)\) Tj/g)) {
      expect(m[1]!.replace(/\\[\\()]/g, '')).not.toMatch(/[()\\]/);
    }
  });

  it('a long name wraps onto a second line instead of being cut off', () => {
    const t = text(
      renderInvoicePdf(invoice([line('Premium Sona Masoori Raw Rice 25 kg Gold Label Bag')])),
    );
    expect(t).toContain('(Premium Sona Masoori Raw Rice)');
    expect(t).toContain('(25 kg Gold Label Bag)');
  });

  it('labels the document type, marks a cancelled invoice, and shows IGST for an inter-state bill', () => {
    expect(text(renderInvoicePdf(invoice([line('A')], { type: 'BILL_OF_SUPPLY' })))).toContain(
      'BILL OF SUPPLY',
    );
    expect(text(renderInvoicePdf(invoice([line('A')], { type: 'BILL_OF_SUPPLY' })))).not.toContain(
      'reverse charge',
    );
    expect(text(renderInvoicePdf(invoice([line('A')], { type: 'NORMAL' })))).toContain(
      'RETAIL INVOICE',
    );
    expect(text(renderInvoicePdf(invoice([line('A')], { status: 'CANCELLED' })))).toContain(
      '(CANCELLED)',
    );
    const inter = invoice([line('A', { igst: '5.00', cgst: '0.00', sgst: '0.00' })]);
    inter.totals = {
      ...inter.totals,
      interState: true,
      igstTotal: '5.00',
      cgstTotal: '0.00',
      sgstTotal: '0.00',
    };
    const t = text(renderInvoicePdf(inter));
    expect(t).toContain('IGST:');
    expect(t).not.toContain('(CGST:)');
  });

  it('prints khata balance and round-off only when there is one, and a walk-in customer by name', () => {
    const base = invoice([line('A')], { buyer: null });
    expect(text(renderInvoicePdf(base))).toContain('Customer: Walk-in Customer');
    expect(text(renderInvoicePdf(base))).not.toContain('Balance on Khata');
    const credit = invoice([line('A')]);
    credit.totals = { ...credit.totals, creditAmount: '50.00', roundOff: '-0.40' };
    const t = text(renderInvoicePdf(credit));
    expect(t).toContain('Balance on Khata:');
    expect(t).toContain('Round Off:');
  });
});
