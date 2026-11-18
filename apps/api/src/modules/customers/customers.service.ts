import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { Paginated } from '../../common/pagination/paginated';
import { timestampRange } from '../../common/utils/dates';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type {
  CreateCustomerDto,
  CustomerLedgerQuery,
  CustomersQuery,
  UpdateCustomerDto,
} from './customers.dto';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const m2 = (v: { toString(): string }) => new Decimal(v.toString()).toFixed(2);

export function customerView(c: Prisma.CustomerGetPayload<object>) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    gstin: c.gstin,
    stateCode: c.stateCode,
    addressLine: c.addressLine,
    creditLimit: c.creditLimit === null ? null : m2(c.creditLimit),
    /** Positive = the customer owes the shop; negative = the shop holds the customer's money (advance). */
    balance: m2(c.balance),
    isActive: c.isActive,
    version: c.version,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/**
 * Customers (minimal set for credit sales). Collections, agents and statements arrive with khata in Phase 11.
 * The balance is never edited here: only CustomerLedgerService changes it.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(t: TenantContext, dto: CreateCustomerDto, meta: Meta) {
    if (dto.phone) await this.assertPhoneFree(t.organizationId, dto.phone);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.customer.create({
        data: {
          organizationId: t.organizationId,
          name: dto.name,
          phone: dto.phone,
          email: dto.email,
          gstin: dto.gstin,
          stateCode: dto.stateCode,
          addressLine: dto.addressLine,
          creditLimit: dto.creditLimit,
        },
      });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId,
        actorId: t.userId,
        action: 'customer.create',
        entityType: 'customer',
        entityId: c.id,
        after: { name: c.name, phone: c.phone, creditLimit: dto.creditLimit ?? null },
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return customerView(c);
    });
  }

  async list(organizationId: string, q: CustomersQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.CustomerWhereInput = {
      organizationId,
      deletedAt: null,
      ...(q.isActive === undefined ? {} : { isActive: q.isActive }),
      ...(q.owes ? { balance: { gt: 0 } } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { phone: { contains: q.q } },
              { gstin: { contains: q.q.toUpperCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: [{ [q.sort ?? 'name']: q.order ?? 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return new Paginated(rows.map(customerView), { page, pageSize, total });
  }

  async get(organizationId: string, id: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!c) throw new AppException('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    return customerView(c);
  }

  async update(t: TenantContext, id: string, dto: UpdateCustomerDto, meta: Meta) {
    const before = await this.prisma.customer.findFirst({
      where: { id, organizationId: t.organizationId, deletedAt: null },
    });
    if (!before) throw new AppException('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    if (dto.phone && dto.phone !== before.phone)
      await this.assertPhoneFree(t.organizationId, dto.phone, id);
    const { version, ...fields } = dto;
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.customer.updateMany({
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
          'This customer was changed on another device. Reload and try again',
          409,
          { currentVersion: before.version },
        );
      }
      const after = await tx.customer.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId,
        actorId: t.userId,
        action: 'customer.update',
        entityType: 'customer',
        entityId: id,
        before: pick(customerView(before), Object.keys(fields)) as Prisma.InputJsonValue,
        after: pick(customerView(after), Object.keys(fields)) as Prisma.InputJsonValue,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return customerView(after);
    });
  }

  async setActive(t: TenantContext, id: string, isActive: boolean, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.customer.updateMany({
        where: { id, organizationId: t.organizationId, deletedAt: null },
        data: { isActive, version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new AppException('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId,
        actorId: t.userId,
        action: isActive ? 'customer.reactivate' : 'customer.deactivate',
        entityType: 'customer',
        entityId: id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return customerView(await tx.customer.findUniqueOrThrow({ where: { id } }));
    });
  }

  /** Khata statement: every change to what the customer owes, newest first, with the running balance. */
  async statement(organizationId: string, id: string, q: CustomerLedgerQuery) {
    const c = await this.prisma.customer.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, name: true, balance: true },
    });
    if (!c) throw new AppException('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.CustomerLedgerEntryWhereInput = {
      organizationId,
      customerId: id,
      ...(q.from || q.to ? { occurredAt: timestampRange(q.from, q.to) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customerLedgerEntry.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customerLedgerEntry.count({ where }),
    ]);
    return new Paginated(
      rows.map((e) => ({
        id: e.id,
        type: e.entryType,
        amount: m2(e.amount),
        balanceAfter: m2(e.balanceAfter),
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        description: e.description,
        branchId: e.branchId,
        occurredAt: e.occurredAt,
      })),
      { page, pageSize, total, customer: { id: c.id, name: c.name, balance: m2(c.balance) } },
    );
  }

  private async assertPhoneFree(organizationId: string, phone: string, exceptId?: string) {
    const clash = await this.prisma.customer.findFirst({
      where: {
        organizationId,
        phone,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new AppException('CUSTOMER_PHONE_IN_USE', `This number belongs to ${clash.name}`, 409, {
        customerId: clash.id,
      });
    }
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = obj[k] ?? null;
  return out;
}
