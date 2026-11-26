import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { Paginated } from '../../common/pagination/paginated';
import { dateOnly, todayInIndia } from '../../common/utils/dates';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CashbookService } from './cashbook.service';
import { computeDailyClosing } from './domain/closing-math';
import type { CloseDayDto, ClosingsQuery } from './finance.dto';

type Tx = Prisma.TransactionClient;
interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const m2 = (v: { toString(): string }) => new Decimal(v.toString()).toFixed(2);

@Injectable()
export class DailyClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashbook: CashbookService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async preview(t: TenantContext, rawDate?: string) {
    const branchId = this.branch(t);
    const businessDateStr = this.validateDate(rawDate);
    return this.prisma.$transaction(async (tx) => {
      const registerId = await this.cashbook.registerOf(tx, t.organizationId, branchId);
      return this.computePreview(tx, t.organizationId, branchId, registerId, businessDateStr);
    });
  }

  async close(t: TenantContext, key: string, dto: CloseDayDto, meta: Meta) {
    const branchId = this.branch(t);
    return this.idempotency.execute(
      { organizationId: t.organizationId, userId: t.userId },
      key,
      'POST /closings',
      { branchId, ...dto },
      async (tx) => {
        const businessDateStr = this.validateDate(dto.businessDate);
        const businessDate = new Date(businessDateStr);
        const registerId = await this.cashbook.registerOf(tx, t.organizationId, branchId);

        // Lock the register so two simultaneous close requests for the same day serialize cleanly.
        await tx.$queryRaw`
          SELECT id FROM cash_registers
          WHERE id = ${registerId}::uuid AND organization_id = ${t.organizationId}::uuid
          FOR NO KEY UPDATE`;

        const existing = await tx.dailyClosing.findFirst({
          where: { registerId, businessDate },
        });
        if (existing?.status === 'CLOSED') {
          throw new AppException(
            'DAY_ALREADY_CLOSED',
            `Daily closing is already completed for ${businessDateStr}`,
            409,
          );
        }

        // The cash carried forward from day to day is a chain: an older day cannot be closed once a newer one has
        // been, or the newer closing's opening figure would no longer match.
        const newer = await tx.dailyClosing.findFirst({
          where: { registerId, status: 'CLOSED', businessDate: { gt: businessDate } },
          select: { businessDate: true },
        });
        if (newer) {
          throw new AppException(
            'CLOSING_OUT_OF_ORDER',
            `${newer.businessDate.toISOString().slice(0, 10)} is already closed; days must be closed in order`,
            409,
          );
        }

        const preview = await this.computePreview(
          tx,
          t.organizationId,
          branchId,
          registerId,
          businessDateStr,
        );
        const calc = computeDailyClosing({
          openingCash: new Decimal(preview.openingCash),
          netCashMovements: new Decimal(preview.netCashMovements),
          actualCash: new Decimal(dto.actualCash),
        });

        const closedAt = new Date();
        const saved = existing
          ? await tx.dailyClosing.update({
              where: { id: existing.id },
              data: {
                openingCash: calc.openingCash.toFixed(2),
                expectedCash: calc.expectedCash.toFixed(2),
                actualCash: calc.actualCash.toFixed(2),
                difference: calc.difference.toFixed(2),
                status: 'CLOSED',
                notes: dto.notes,
                closedById: t.userId,
                closedAt,
              },
            })
          : await tx.dailyClosing.create({
              data: {
                organizationId: t.organizationId,
                branchId,
                registerId,
                businessDate,
                openingCash: calc.openingCash.toFixed(2),
                expectedCash: calc.expectedCash.toFixed(2),
                actualCash: calc.actualCash.toFixed(2),
                difference: calc.difference.toFixed(2),
                status: 'CLOSED',
                notes: dto.notes,
                closedById: t.userId,
                closedAt,
              },
            });

        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'closing.closed',
          entityType: 'daily_closing',
          entityId: saved.id,
          after: {
            businessDate: businessDateStr,
            openingCash: calc.openingCash.toFixed(2),
            expectedCash: calc.expectedCash.toFixed(2),
            actualCash: calc.actualCash.toFixed(2),
            difference: calc.difference.toFixed(2),
          },
          ...meta,
        });

        return {
          id: saved.id,
          businessDate: businessDateStr,
          openingCash: calc.openingCash.toFixed(2),
          expectedCash: calc.expectedCash.toFixed(2),
          actualCash: calc.actualCash.toFixed(2),
          difference: calc.difference.toFixed(2),
          status: saved.status,
          notes: saved.notes,
          closedAt: closedAt.toISOString(),
        };
      },
    );
  }

  async list(t: TenantContext, q: ClosingsQuery) {
    const branchId = this.branch(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;

    const where: Prisma.DailyClosingWhereInput = {
      organizationId: t.organizationId,
      branchId,
      ...(q.from || q.to
        ? {
            businessDate: {
              ...(q.from ? { gte: dateOnly(q.from, 'from') } : {}),
              ...(q.to ? { lte: dateOnly(q.to, 'to') } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.dailyClosing.count({ where }),
      this.prisma.dailyClosing.findMany({
        where,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      businessDate: r.businessDate.toISOString().slice(0, 10),
      openingCash: m2(r.openingCash),
      expectedCash: m2(r.expectedCash),
      actualCash: r.actualCash ? m2(r.actualCash) : null,
      difference: r.difference ? m2(r.difference) : null,
      status: r.status,
      notes: r.notes,
      closedAt: r.closedAt?.toISOString() ?? null,
    }));

    return new Paginated(items, { page, pageSize, total });
  }

  /**
   * Cash in the drawer when a day starts: what was counted at the last closing before it, PLUS the cash movements of
   * every day since then that was never closed (a forgotten day must not make its takings vanish).
   */
  async openingCash(
    db: Tx | Db,
    organizationId: string,
    registerId: string,
    businessDate: Date,
  ): Promise<Decimal> {
    const prev = await db.dailyClosing.findFirst({
      where: { organizationId, registerId, status: 'CLOSED', businessDate: { lt: businessDate } },
      orderBy: { businessDate: 'desc' },
      select: { businessDate: true, actualCash: true },
    });
    const between = await db.cashbookEntry.aggregate({
      where: {
        organizationId,
        registerId,
        method: 'CASH',
        businessDate: { lt: businessDate, ...(prev ? { gt: prev.businessDate } : {}) },
      },
      _sum: { amount: true },
    });
    const counted = prev?.actualCash ? new Decimal(prev.actualCash.toString()) : new Decimal(0);
    return counted.plus(between._sum.amount ? new Decimal(between._sum.amount.toString()) : 0);
  }

  private async computePreview(
    db: Tx | Db,
    organizationId: string,
    branchId: string,
    registerId: string,
    businessDateStr: string,
  ) {
    const businessDate = new Date(businessDateStr);

    const [openingCash, existingClosing, entries] = await Promise.all([
      this.openingCash(db, organizationId, registerId, businessDate),
      db.dailyClosing.findFirst({
        where: { registerId, businessDate },
      }),
      db.cashbookEntry.findMany({
        where: { organizationId, branchId, registerId, businessDate },
        select: { amount: true, method: true },
      }),
    ]);

    let cashIn = new Decimal(0);
    let cashOut = new Decimal(0);
    const byMethod: Record<string, Decimal> = {
      CASH: new Decimal(0),
      UPI: new Decimal(0),
      CARD: new Decimal(0),
      BANK_TRANSFER: new Decimal(0),
      OTHER: new Decimal(0),
    };

    for (const e of entries) {
      const amt = new Decimal(e.amount.toString());
      byMethod[e.method] = (byMethod[e.method] ?? new Decimal(0)).plus(amt);
      if (e.method === 'CASH') {
        if (amt.gt(0)) cashIn = cashIn.plus(amt);
        else cashOut = cashOut.plus(amt.abs());
      }
    }

    const netCashMovements = byMethod.CASH ?? new Decimal(0);
    const expectedCash = openingCash.plus(netCashMovements);

    return {
      businessDate: businessDateStr,
      registerId,
      openingCash: openingCash.toFixed(2),
      cashIn: cashIn.toFixed(2),
      cashOut: cashOut.toFixed(2),
      netCashMovements: netCashMovements.toFixed(2),
      expectedCash: expectedCash.toFixed(2),
      entryCount: entries.length,
      byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, v.toFixed(2)])),
      closing: existingClosing
        ? {
            id: existingClosing.id,
            status: existingClosing.status,
            actualCash: existingClosing.actualCash ? m2(existingClosing.actualCash) : null,
            difference: existingClosing.difference ? m2(existingClosing.difference) : null,
            notes: existingClosing.notes,
            closedAt: existingClosing.closedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  private validateDate(value?: string): string {
    const today = todayInIndia();
    if (!value) return today;
    const d = new Date(value);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
      throw new DomainError('BUSINESS_DATE_INVALID', 'The date is not a valid calendar date');
    }
    if (value > today) {
      throw new DomainError('BUSINESS_DATE_IN_FUTURE', 'Closing date cannot be in the future');
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
