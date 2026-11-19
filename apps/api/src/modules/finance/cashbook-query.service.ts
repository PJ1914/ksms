import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { Paginated } from '../../common/pagination/paginated';
import { dateOnly, todayInIndia } from '../../common/utils/dates';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CashbookService } from './cashbook.service';
import type { CashbookAdjustmentDto, CashbookQuery } from './finance.dto';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const m2 = (v: { toString(): string }) => new Decimal(v.toString()).toFixed(2);

@Injectable()
export class CashbookQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashbook: CashbookService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async list(t: TenantContext, q: CashbookQuery) {
    const branchId = this.branch(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 30;

    const where: Prisma.CashbookEntryWhereInput = {
      organizationId: t.organizationId,
      branchId,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.from || q.to
        ? {
            businessDate: {
              ...(q.from ? { gte: dateOnly(q.from, 'from') } : {}),
              ...(q.to ? { lte: dateOnly(q.to, 'to') } : {}),
            },
          }
        : {}),
      ...(q.q ? { description: { contains: q.q, mode: 'insensitive' } } : {}),
    };

    const [total, rows, allMatched] = await Promise.all([
      this.prisma.cashbookEntry.count({ where }),
      this.prisma.cashbookEntry.findMany({
        where,
        orderBy: [{ businessDate: 'desc' }, { occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.cashbookEntry.findMany({
        where,
        select: { amount: true, method: true },
      }),
    ]);

    let totalIn = new Decimal(0);
    let totalOut = new Decimal(0);
    let cashNet = new Decimal(0);
    for (const r of allMatched) {
      const amt = new Decimal(r.amount.toString());
      if (amt.gt(0)) totalIn = totalIn.plus(amt);
      else totalOut = totalOut.plus(amt.abs());
      if (r.method === 'CASH') cashNet = cashNet.plus(amt);
    }

    const items = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      method: r.method,
      amount: m2(r.amount),
      description: r.description,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      businessDate: r.businessDate.toISOString().slice(0, 10),
      occurredAt: r.occurredAt.toISOString(),
    }));

    return new Paginated(items, {
      page,
      pageSize,
      total,
      summary: {
        totalIn: totalIn.toFixed(2),
        totalOut: totalOut.toFixed(2),
        net: totalIn.minus(totalOut).toFixed(2),
        cashNet: cashNet.toFixed(2),
      },
    });
  }

  async recordAdjustment(t: TenantContext, key: string, dto: CashbookAdjustmentDto, meta: Meta) {
    const branchId = this.branch(t);
    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /cashbook/entries',
      { branchId, ...dto },
      async (tx) => {
        const amount = new Decimal(dto.amount);
        if (amount.lte(0)) {
          throw new DomainError('CASHBOOK_AMOUNT_INVALID', 'Amount must be more than zero');
        }
        const businessDate = this.validateDate(dto.businessDate);
        const signed = dto.kind === 'CASH_IN' ? amount : amount.negated();
        const method = dto.method ?? 'CASH';
        const refId = randomUUID();

        await this.cashbook.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          kind: dto.kind,
          method,
          amount: signed,
          referenceType: 'MANUAL_ADJUSTMENT',
          referenceId: refId,
          description: dto.description,
          businessDate,
        });

        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'cashbook.adjustment',
          entityType: 'cashbook_entry',
          entityId: refId,
          after: {
            kind: dto.kind,
            method,
            amount: signed.toFixed(2),
            description: dto.description,
            businessDate,
          },
          ...meta,
        });

        return {
          referenceId: refId,
          kind: dto.kind,
          method,
          amount: signed.toFixed(2),
          description: dto.description,
          businessDate,
        };
      },
    );
  }

  private validateDate(value?: string): string {
    const today = todayInIndia();
    if (!value) return today;
    const d = new Date(value);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
      throw new DomainError('BUSINESS_DATE_INVALID', 'The date is not a valid calendar date');
    }
    if (value > today) {
      throw new DomainError('BUSINESS_DATE_IN_FUTURE', 'Date cannot be in the future');
    }
    const min = new Date(`${today}T00:00:00Z`);
    min.setUTCDate(min.getUTCDate() - 7);
    if (d.getTime() < min.getTime()) {
      throw new DomainError(
        'BUSINESS_DATE_TOO_OLD',
        'Manual cashbook entries can be dated at most 7 days back',
      );
    }
    return value;
  }

  private branch(t: TenantContext): string {
    if (!t.branchId) {
      throw new DomainError('BRANCH_REQUIRED', 'Choose a branch first');
    }
    return t.branchId;
  }
}
