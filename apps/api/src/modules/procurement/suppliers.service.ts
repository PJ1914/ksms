import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { Paginated } from '../../common/pagination/paginated';
import { timestampRange } from '../../common/utils/dates';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateSupplierDto,
  LedgerQuery,
  SuppliersQuery,
  UpdateSupplierDto,
} from './procurement.dto';
import { SupplierLedgerService } from './supplier-ledger.service';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const money = (v: Prisma.Decimal | Decimal | string) => new Decimal(v.toString()).toFixed(2);

type SupplierRow = Prisma.SupplierGetPayload<object>;

export function supplierView(s: SupplierRow) {
  return {
    id: s.id,
    name: s.name,
    contactPerson: s.contactPerson,
    phone: s.phone,
    email: s.email,
    gstin: s.gstin,
    addressLine: s.addressLine,
    stateCode: s.stateCode,
    paymentTermsDays: s.paymentTermsDays,
    /** Positive = the shop owes the supplier; negative = the supplier holds an advance of the shop's money. */
    balance: money(s.balance),
    isActive: s.isActive,
    version: s.version,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: SupplierLedgerService,
    private readonly audit: AuditService,
  ) {}

  async create(t: TenantContext, dto: CreateSupplierDto, meta: Meta) {
    const opening = new Decimal(dto.openingBalance ?? 0);
    if (opening.gt(0) && !t.branchId) {
      throw new AppException(
        'BRANCH_REQUIRED',
        'x-branch-id header is required to record an opening balance',
        400,
      );
    }
    await this.assertNameFree(t.organizationId, dto.name);

    return this.prisma.$transaction(async (tx) => {
      const s = await tx.supplier.create({
        data: {
          organizationId: t.organizationId,
          name: dto.name,
          contactPerson: dto.contactPerson,
          phone: dto.phone,
          email: dto.email,
          gstin: dto.gstin,
          addressLine: dto.addressLine,
          stateCode: dto.stateCode,
          paymentTermsDays: dto.paymentTermsDays,
        },
      });
      if (opening.gt(0)) {
        await this.ledger.post(tx, {
          organizationId: t.organizationId,
          branchId: t.branchId!,
          supplierId: s.id,
          actorId: t.userId,
          type: 'OPENING_BALANCE',
          amount: opening,
          referenceType: 'SUPPLIER',
          referenceId: s.id,
          description: 'Amount already owed when the shop started using KSMS',
        });
      }
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId,
        actorId: t.userId,
        action: 'supplier.create',
        entityType: 'supplier',
        entityId: s.id,
        after: { name: s.name, openingBalance: opening.toFixed(2) },
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return supplierView(await tx.supplier.findUniqueOrThrow({ where: { id: s.id } }));
    });
  }

  async list(organizationId: string, q: SuppliersQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.SupplierWhereInput = {
      organizationId,
      deletedAt: null,
      ...(q.isActive === undefined ? {} : { isActive: q.isActive }),
      ...(q.owed ? { balance: { gt: 0 } } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { contactPerson: { contains: q.q, mode: 'insensitive' } },
              { phone: { contains: q.q } },
              { gstin: { contains: q.q.toUpperCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: [{ [q.sort ?? 'name']: q.order ?? 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return new Paginated(rows.map(supplierView), { page, pageSize, total });
  }

  async get(organizationId: string, id: string) {
    const s = await this.prisma.supplier.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!s) throw new AppException('SUPPLIER_NOT_FOUND', 'Supplier not found', 404);
    const [purchases, unpaid] = await Promise.all([
      this.prisma.purchase.count({
        where: { organizationId, supplierId: id, status: { not: 'CANCELLED' } },
      }),
      this.prisma.$queryRaw<{ n: number; outstanding: string | null }[]>`
        SELECT count(*)::int AS n, COALESCE(sum(o.outstanding), 0)::text AS outstanding FROM (
          SELECT p.billed_total - p.returned_total - COALESCE((
            SELECT sum(pp.amount) FROM purchase_payments pp JOIN payments pay ON pay.id = pp.payment_id
            WHERE pp.purchase_id = p.id AND pay.status = 'COMPLETED'), 0) AS outstanding
          FROM purchases p
          WHERE p.organization_id = ${organizationId}::uuid AND p.supplier_id = ${id}::uuid
            AND p.status IN ('PARTIALLY_RECEIVED', 'RECEIVED')
        ) o WHERE o.outstanding > 0`,
    ]);
    return {
      ...supplierView(s),
      purchaseCount: purchases,
      unpaidPurchaseCount: unpaid[0]!.n,
      unpaidPurchasesTotal: money(unpaid[0]!.outstanding ?? '0'),
    };
  }

  async update(t: TenantContext, id: string, dto: UpdateSupplierDto, meta: Meta) {
    const before = await this.prisma.supplier.findFirst({
      where: { id, organizationId: t.organizationId, deletedAt: null },
    });
    if (!before) throw new AppException('SUPPLIER_NOT_FOUND', 'Supplier not found', 404);
    if (dto.name && dto.name.toLowerCase() !== before.name.toLowerCase()) {
      await this.assertNameFree(t.organizationId, dto.name, id);
    }
    const { version, ...fields } = dto;

    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.supplier.updateMany({
        where: {
          id,
          organizationId: t.organizationId,
          deletedAt: null,
          ...(version ? { version } : {}),
        },
        data: { ...fields, version: { increment: 1 } },
      });
      if (changed.count !== 1) {
        throw new AppException(
          'VERSION_CONFLICT',
          'This supplier was changed on another device. Reload and try again',
          409,
          {
            currentVersion: before.version,
          },
        );
      }
      const after = await tx.supplier.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId,
        actorId: t.userId,
        action: 'supplier.update',
        entityType: 'supplier',
        entityId: id,
        before: pick(before, Object.keys(fields)) as Prisma.InputJsonValue,
        after: pick(after, Object.keys(fields)) as Prisma.InputJsonValue,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return supplierView(after);
    });
  }

  async setActive(t: TenantContext, id: string, isActive: boolean, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.supplier.updateMany({
        where: { id, organizationId: t.organizationId, deletedAt: null },
        data: { isActive, version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new AppException('SUPPLIER_NOT_FOUND', 'Supplier not found', 404);
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId,
        actorId: t.userId,
        action: isActive ? 'supplier.reactivate' : 'supplier.deactivate',
        entityType: 'supplier',
        entityId: id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return supplierView(await tx.supplier.findUniqueOrThrow({ where: { id } }));
    });
  }

  /** Statement: every change to what is owed, newest first, each with the running balance. */
  async statement(organizationId: string, id: string, q: LedgerQuery) {
    const s = await this.prisma.supplier.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, name: true, balance: true },
    });
    if (!s) throw new AppException('SUPPLIER_NOT_FOUND', 'Supplier not found', 404);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.SupplierLedgerEntryWhereInput = {
      organizationId,
      supplierId: id,
      ...(q.from || q.to ? { occurredAt: timestampRange(q.from, q.to) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.supplierLedgerEntry.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplierLedgerEntry.count({ where }),
    ]);
    const items = rows.map((e) => ({
      id: e.id,
      type: e.entryType,
      amount: money(e.amount),
      balanceAfter: money(e.balanceAfter),
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      description: e.description,
      branchId: e.branchId,
      occurredAt: e.occurredAt,
    }));
    return new Paginated(items, {
      page,
      pageSize,
      total,
      supplier: { id: s.id, name: s.name, balance: money(s.balance) },
    });
  }

  /** Stock received from this supplier through "add stock" / opening stock (history only, no money). */
  async stockReceived(organizationId: string, id: string, q: { page?: number; pageSize?: number }) {
    const s = await this.prisma.supplier.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!s) throw new AppException('SUPPLIER_NOT_FOUND', 'Supplier not found', 404);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where = { organizationId, supplierId: id };
    const [rows, total] = await Promise.all([
      this.prisma.stockSupplierNote.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockSupplierNote.count({ where }),
    ]);
    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: [...new Set(rows.map((r) => r.productId))] } },
      select: { id: true, name: true, baseUnit: { select: { code: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const items = rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: byId.get(r.productId)?.name ?? 'Product',
      baseUnitCode: byId.get(r.productId)?.baseUnit.code ?? '',
      quantity: r.quantity.toFixed(3),
      receivedAt: r.createdAt,
    }));
    return new Paginated(items, { page, pageSize, total, supplier: { id: s.id, name: s.name } });
  }

  private async assertNameFree(organizationId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.supplier.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new AppException(
        'SUPPLIER_NAME_IN_USE',
        'A supplier with this name already exists',
        409,
        {
          supplierId: clash.id,
        },
      );
    }
  }
}

function pick(obj: object, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (obj as Record<string, unknown>)[k] ?? null;
  return out;
}
