import Decimal from 'decimal.js';

/**
 * Minimal, dependency-free PDF 1.4 generator using built-in Type1 Helvetica / Helvetica-Bold fonts.
 * Produces a valid single-page A4 invoice PDF in memory (Buffer) with exact byte offsets in the xref table.
 */

export interface InvoicePdfSeller {
  organizationName: string;
  legalName: string | null;
  branchName: string;
  branchCode: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  stateCode: string | null;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
}

export interface InvoicePdfBuyer {
  name: string;
  phone: string | null;
  gstin: string | null;
  stateCode: string | null;
  addressLine: string | null;
}

export interface InvoicePdfLine {
  name: string;
  hsn: string | null;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  discount: string;
  taxableValue: string;
  taxRatePercent: string;
  cgst: string;
  sgst: string;
  igst: string;
  lineTotal: string;
}

export interface InvoicePdfTotals {
  subtotal: string;
  discountTotal: string;
  taxableTotal: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  taxTotal: string;
  roundOff: string;
  total: string;
  paidTotal: string;
  creditAmount: string;
  taxMode: string;
  placeOfSupplyStateCode: string | null;
  interState: boolean;
  lines: InvoicePdfLine[];
}

export interface InvoicePdfData {
  invoiceNumber: string;
  saleNumber: string;
  type: 'NORMAL' | 'GST' | 'BILL_OF_SUPPLY';
  status: 'ISSUED' | 'CANCELLED';
  issuedAt: Date | string;
  seller: InvoicePdfSeller;
  buyer: InvoicePdfBuyer | null;
  totals: InvoicePdfTotals;
}

/** Escapes a string for a PDF literal string `(...)`, replacing non-ASCII with ASCII equivalents. */
function pdfText(input: string): string {
  return input
    .replace(/₹/g, 'Rs. ')
    .replace(/[—–]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function titleFor(type: InvoicePdfData['type']): string {
  if (type === 'GST') return 'TAX INVOICE';
  if (type === 'BILL_OF_SUPPLY') return 'BILL OF SUPPLY';
  return 'RETAIL INVOICE';
}

/** An instant as the India-time date and minute, e.g. "2026-11-19 00:30 IST" (invoices are dated in India time). */
export function formatIssuedAt(value: Date | string): string {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return String(value);
  return `${new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')} IST`;
}

const PAGE_TOP = 800;
const PAGE_BOTTOM = 60; // nothing is drawn below this (the footer lives under it)
const TOTALS_HEIGHT = 175; // room the totals block needs
const NAME_WIDTH = 30; // characters of an item name per line

/** Splits a name over at most two lines. */
function wrap(name: string): string[] {
  if (name.length <= NAME_WIDTH) return [name];
  const cut = name.lastIndexOf(' ', NAME_WIDTH);
  const at = cut > 10 ? cut : NAME_WIDTH;
  const first = name.slice(0, at).trimEnd();
  const rest = name.slice(at).trim();
  return [first, rest.length > NAME_WIDTH ? `${rest.slice(0, NAME_WIDTH - 1)}.` : rest];
}

/**
 * Draws the invoice on as many A4 pages as the bill needs: every line of the bill appears, the table header repeats
 * on each page, the totals follow the last line, and every page carries "Page i of n".
 */
export function renderInvoicePdf(inv: InvoicePdfData): Buffer {
  const pages: string[][] = [];
  let ops: string[] = [];
  let y = PAGE_TOP;

  const text = (x: number, yy: number, str: string, bold = false, size = 10) => {
    ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${yy.toFixed(1)} Tm (${pdfText(str)}) Tj ET`,
    );
  };
  const hline = (yy: number) => {
    ops.push(`0.7 w 40 ${yy.toFixed(1)} m 555 ${yy.toFixed(1)} l S`);
  };
  const tableHeader = () => {
    text(40, y, 'Item', true, 9);
    text(210, y, 'HSN', true, 9);
    text(260, y, 'Qty', true, 9);
    text(320, y, 'Rate', true, 9);
    text(380, y, 'Taxable', true, 9);
    text(440, y, 'GST', true, 9);
    text(500, y, 'Total', true, 9);
    y -= 6;
    hline(y);
    y -= 13;
  };
  const shopTitle = inv.seller.legalName ?? inv.seller.organizationName;
  const cancelled = inv.status === 'CANCELLED';

  const startContinuationPage = () => {
    pages.push(ops);
    ops = [];
    y = PAGE_TOP;
    text(40, y, shopTitle, true, 12);
    text(380, y, `${titleFor(inv.type)} (continued)`, true, 11);
    y -= 15;
    text(40, y, `Invoice No: ${inv.invoiceNumber}`, true, 9);
    if (cancelled) text(380, y, 'CANCELLED', true, 11);
    y -= 14;
    hline(y);
    y -= 14;
    tableHeader();
  };

  // ---- first page: seller, invoice details, buyer
  text(40, y, shopTitle, true, 16);
  text(400, y, titleFor(inv.type), true, 14);
  y -= 16;
  if (cancelled) {
    text(400, y + 2, 'CANCELLED', true, 14);
  }
  const addrParts = [
    inv.seller.branchName,
    inv.seller.addressLine,
    inv.seller.city,
    inv.seller.state,
    inv.seller.pincode,
  ].filter(Boolean);
  if (addrParts.length > 0) {
    text(40, y, addrParts.join(', '), false, 9);
    y -= 13;
  }
  if (inv.seller.gstin) {
    text(
      40,
      y,
      `GSTIN: ${inv.seller.gstin}${inv.seller.stateCode ? `  |  State Code: ${inv.seller.stateCode}` : ''}`,
      true,
      9,
    );
    y -= 13;
  }
  if (inv.seller.phone) {
    text(40, y, `Phone: ${inv.seller.phone}`, false, 9);
    y -= 13;
  }

  hline(y);
  y -= 15;

  text(40, y, `Invoice No: ${inv.invoiceNumber}`, true, 10);
  text(320, y, `Date: ${formatIssuedAt(inv.issuedAt)}`, false, 9);
  y -= 14;
  text(40, y, `Bill No: ${inv.saleNumber}`, false, 9);
  text(
    320,
    y,
    `Status: ${inv.status}${inv.totals.placeOfSupplyStateCode ? `  |  Place of Supply: ${inv.totals.placeOfSupplyStateCode}` : ''}`,
    cancelled,
    9,
  );
  y -= 14;
  if (inv.type === 'GST') {
    // Rule 46 asks every tax invoice to say whether the tax is payable on reverse charge; retail sales are not.
    text(40, y, 'Tax payable on reverse charge: No', false, 9);
    y -= 14;
  }

  if (inv.buyer) {
    text(
      40,
      y,
      `Customer: ${inv.buyer.name}${inv.buyer.phone ? ` (${inv.buyer.phone})` : ''}`,
      true,
      9,
    );
    y -= 13;
    if (inv.buyer.gstin || inv.buyer.stateCode || inv.buyer.addressLine) {
      const bParts = [
        inv.buyer.gstin ? `GSTIN: ${inv.buyer.gstin}` : null,
        inv.buyer.stateCode ? `State: ${inv.buyer.stateCode}` : null,
        inv.buyer.addressLine,
      ].filter(Boolean);
      text(40, y, bParts.join('  |  '), false, 9);
      y -= 13;
    }
  } else {
    text(40, y, 'Customer: Walk-in Customer', false, 9);
    y -= 13;
  }

  hline(y);
  y -= 14;
  tableHeader();

  // ---- the lines: a new page whenever the next one would not fit
  for (const l of inv.totals.lines) {
    const nameLines = wrap(l.name);
    if (y - 13 * (nameLines.length - 1) < PAGE_BOTTOM) startContinuationPage();
    const gstAmt = inv.totals.interState ? l.igst : new Decimal(l.cgst).plus(l.sgst).toFixed(2);
    const rateLabel = new Decimal(l.taxRatePercent).toFixed();
    text(40, y, nameLines[0]!, false, 9);
    text(210, y, l.hsn ?? '-', false, 8);
    text(260, y, `${l.quantity} ${l.unitCode}`, false, 8);
    text(320, y, l.unitPrice, false, 8);
    text(380, y, l.taxableValue, false, 8);
    text(440, y, `${gstAmt} (${rateLabel}%)`, false, 8);
    text(500, y, l.lineTotal, true, 9);
    y -= 13;
    for (const extra of nameLines.slice(1)) {
      text(40, y, extra, false, 9);
      y -= 13;
    }
  }

  // ---- totals (on a fresh page if they would not fit under the last line)
  if (y - TOTALS_HEIGHT < PAGE_BOTTOM) startContinuationPage();
  hline(y);
  y -= 15;
  const row = (label: string, val: string, bold = false) => {
    text(360, y, label, bold, 9);
    text(490, y, `Rs. ${val}`, bold, 9);
    y -= 13;
  };
  row('Subtotal:', inv.totals.subtotal);
  if (inv.totals.discountTotal !== '0.00') row('Discount:', `- ${inv.totals.discountTotal}`);
  row('Taxable Value:', inv.totals.taxableTotal);
  if (inv.type === 'GST') {
    if (inv.totals.interState) {
      row('IGST:', inv.totals.igstTotal);
    } else {
      row('CGST:', inv.totals.cgstTotal);
      row('SGST:', inv.totals.sgstTotal);
    }
  }
  if (inv.totals.roundOff !== '0.00') row('Round Off:', inv.totals.roundOff);
  row('Grand Total:', inv.totals.total, true);
  row('Paid:', inv.totals.paidTotal);
  if (inv.totals.creditAmount !== '0.00') row('Balance on Khata:', inv.totals.creditAmount, true);
  pages.push(ops);

  // ---- footers, now that the page count is known
  const count = pages.length;
  pages.forEach((p, i) => {
    p.push(`BT /F1 8 Tf 1 0 0 1 270.0 30.0 Tm (${pdfText(`Page ${i + 1} of ${count}`)}) Tj ET`);
  });

  // ---- assemble the file: catalog, pages, 2 fonts, then a page object and a content object per page
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + 2 * i);
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${count} >>\nendobj\n`,
  );
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');
  pages.forEach((p, i) => {
    const stream = p.join('\n');
    objects.push(
      `${5 + 2 * i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${6 + 2 * i} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(out, 'ascii'));
    out += obj;
  }
  const xrefStart = Buffer.byteLength(out, 'ascii');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    out += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, 'ascii');
}
