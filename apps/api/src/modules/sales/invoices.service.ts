import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { Paginated } from '../../common/pagination/paginated';
import { timestampRange } from '../../common/utils/dates';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  type InvoicePdfBuyer,
  type InvoicePdfSeller,
  type InvoicePdfTotals,
  renderInvoicePdf,
} from './domain/invoice-pdf';
import type { InvoicesQuery } from './sales.dto';
import { branchOf } from './sales.service';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(t: TenantContext, q: InvoicesQuery) {
    const branchId = branchOf(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.InvoiceWhereInput = {
      organizationId: t.organizationId,
      branchId,
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.saleId ? { saleId: q.saleId } : {}),
      ...(q.q ? { invoiceNumber: { contains: q.q, mode: 'insensitive' } } : {}),
      ...(q.from || q.to ? { issuedAt: timestampRange(q.from, q.to) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { sale: { select: { saleNumber: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return new Paginated(
      rows.map((inv) => {
        const totals = inv.totalsSnapshot as unknown as InvoicePdfTotals;
        const buyer = inv.buyerSnapshot as unknown as InvoicePdfBuyer | null;
        return {
          id: inv.id,
          saleId: inv.saleId,
          saleNumber: inv.sale.saleNumber,
          invoiceNumber: inv.invoiceNumber,
          type: inv.type,
          status: inv.status,
          series: inv.series,
          sequenceNumber: inv.sequenceNumber,
          issuedAt: inv.issuedAt,
          customerName: buyer?.name ?? null,
          total: totals.total,
          taxTotal: totals.taxTotal,
        };
      }),
      { page, pageSize, total },
    );
  }

  async get(t: TenantContext, id: string) {
    const branchId = branchOf(t);
    const inv = await this.prisma.invoice.findFirst({
      where: { id, organizationId: t.organizationId, branchId },
      include: { sale: { select: { saleNumber: true } } },
    });
    if (!inv) throw new AppException('INVOICE_NOT_FOUND', 'Invoice not found', 404);
    return {
      id: inv.id,
      saleId: inv.saleId,
      saleNumber: inv.sale.saleNumber,
      invoiceNumber: inv.invoiceNumber,
      type: inv.type,
      status: inv.status,
      series: inv.series,
      sequenceNumber: inv.sequenceNumber,
      issuedAt: inv.issuedAt,
      sellerSnapshot: inv.sellerSnapshot,
      buyerSnapshot: inv.buyerSnapshot,
      totalsSnapshot: inv.totalsSnapshot,
      pdfKey: inv.pdfKey,
    };
  }

  async pdf(t: TenantContext, id: string): Promise<{ filename: string; buffer: Buffer }> {
    const branchId = branchOf(t);
    const inv = await this.prisma.invoice.findFirst({
      where: { id, organizationId: t.organizationId, branchId },
      include: { sale: { select: { saleNumber: true } } },
    });
    if (!inv) throw new AppException('INVOICE_NOT_FOUND', 'Invoice not found', 404);
    const seller = inv.sellerSnapshot as unknown as InvoicePdfSeller;
    const buyer = (inv.buyerSnapshot as unknown as InvoicePdfBuyer | null) ?? null;
    const totals = inv.totalsSnapshot as unknown as InvoicePdfTotals;
    const buffer = renderInvoicePdf({
      invoiceNumber: inv.invoiceNumber,
      saleNumber: inv.sale.saleNumber,
      type: inv.type,
      status: inv.status,
      issuedAt: inv.issuedAt,
      seller,
      buyer,
      totals,
    });
    return {
      filename: `${inv.invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '-')}.pdf`,
      buffer,
    };
  }
}
