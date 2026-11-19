import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { Paginated } from '../../common/pagination/paginated';
import { dateOnly, todayInIndia } from '../../common/utils/dates';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CashbookService } from './cashbook.service';
import type {
  CancelExpenseDto,
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  ExpensesQuery,
  PaymentMethodName,
  UpdateExpenseCategoryDto,
} from './finance.dto';

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const m2 = (v: { toString(): string }) => new Decimal(v.toString()).toFixed(2);

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashbook: CashbookService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async listCategories(organizationId: string, activeOnly = false) {
    return this.prisma.expenseCategory.findMany({
      where: { organizationId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async createCategory(t: TenantContext, dto: CreateExpenseCategoryDto, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.expenseCategory.findFirst({
        where: {
          organizationId: t.organizationId,
          name: { equals: dto.name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (existing) {
        throw new AppException(
          'EXPENSE_CATEGORY_EXISTS',
          'An expense category with this name already exists',
          409,
        );
      }

      const created = await tx.expenseCategory.create({
        data: { organizationId: t.organizationId, name: dto.name },
      });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId ?? undefined,
        actorId: t.userId,
        action: 'expense_category.created',
        entityType: 'expense_category',
        entityId: created.id,
        after: { name: created.name },
        ...meta,
      });
      return created;
    });
  }

  async updateCategory(t: TenantContext, id: string, dto: UpdateExpenseCategoryDto, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.expenseCategory.findFirst({
        where: { id, organizationId: t.organizationId },
      });
      if (!existing) {
        throw new AppException('EXPENSE_CATEGORY_NOT_FOUND', 'Expense category not found', 404);
      }
      if (dto.name && dto.name.toLowerCase() !== existing.name.toLowerCase()) {
        const dup = await tx.expenseCategory.findFirst({
          where: {
            organizationId: t.organizationId,
            name: { equals: dto.name, mode: 'insensitive' },
            id: { not: id },
          },
          select: { id: true },
        });
        if (dup) {
          throw new AppException(
            'EXPENSE_CATEGORY_EXISTS',
            'An expense category with this name already exists',
            409,
          );
        }
      }
      const updated = await tx.expenseCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId ?? undefined,
        actorId: t.userId,
        action: 'expense_category.updated',
        entityType: 'expense_category',
        entityId: updated.id,
        before: { name: existing.name, isActive: existing.isActive },
        after: { name: updated.name, isActive: updated.isActive },
        ...meta,
      });
      return updated;
    });
  }

  async list(t: TenantContext, q: ExpensesQuery) {
    const branchId = this.branch(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;

    const where: Prisma.ExpenseWhereInput = {
      organizationId: t.organizationId,
      branchId,
      ...(q.includeCancelled ? {} : { cancelledAt: null }),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.from || q.to
        ? {
            expenseDate: {
              ...(q.from ? { gte: dateOnly(q.from, 'from') } : {}),
              ...(q.to ? { lte: dateOnly(q.to, 'to') } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { description: { contains: q.q, mode: 'insensitive' } },
              { referenceNo: { contains: q.q, mode: 'insensitive' } },
              { category: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, rows, agg] = await Promise.all([
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: { select: { id: true, name: true } } },
      }),
      this.prisma.expense.aggregate({
        where: { ...where, cancelledAt: null },
        _sum: { amount: true },
      }),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      categoryName: r.category.name,
      amount: m2(r.amount),
      method: r.method,
      description: r.description,
      referenceNo: r.referenceNo,
      expenseDate: r.expenseDate.toISOString().slice(0, 10),
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));

    return new Paginated(items, {
      page,
      pageSize,
      total,
      activeTotal: agg._sum.amount ? m2(agg._sum.amount) : '0.00',
    });
  }

  async create(t: TenantContext, key: string, dto: CreateExpenseDto, meta: Meta) {
    const branchId = this.branch(t);
    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /expenses',
      { branchId, ...dto },
      async (tx) => {
        const amount = new Decimal(dto.amount);
        if (amount.lte(0)) {
          throw new DomainError(
            'EXPENSE_AMOUNT_INVALID',
            'The expense amount must be more than zero',
          );
        }

        const category = await tx.expenseCategory.findFirst({
          where: { id: dto.categoryId, organizationId: t.organizationId },
          select: { id: true, name: true, isActive: true },
        });
        if (!category) {
          throw new AppException('EXPENSE_CATEGORY_NOT_FOUND', 'Expense category not found', 404);
        }
        if (!category.isActive) {
          throw new DomainError(
            'EXPENSE_CATEGORY_INACTIVE',
            'This expense category is switched off',
          );
        }

        const expenseDateStr = this.validateExpenseDate(dto.expenseDate);
        const expenseId = randomUUID();

        const created = await tx.expense.create({
          data: {
            id: expenseId,
            organizationId: t.organizationId,
            branchId,
            categoryId: category.id,
            amount: amount.toFixed(2),
            method: dto.method,
            description: dto.description,
            referenceNo: dto.referenceNo,
            expenseDate: new Date(expenseDateStr),
            recordedById: t.userId,
          },
        });

        await this.cashbook.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          kind: 'EXPENSE',
          method: dto.method,
          amount: amount.negated(),
          referenceType: 'EXPENSE',
          referenceId: expenseId,
          description: `Expense (${category.name})${dto.description ? `: ${dto.description}` : ''}`,
          businessDate: expenseDateStr,
        });

        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'expense.created',
          entityType: 'expense',
          entityId: expenseId,
          after: {
            categoryId: category.id,
            categoryName: category.name,
            amount: amount.toFixed(2),
            method: dto.method,
            expenseDate: expenseDateStr,
          },
          ...meta,
        });

        return {
          id: created.id,
          categoryId: category.id,
          categoryName: category.name,
          amount: amount.toFixed(2),
          method: created.method,
          description: created.description,
          referenceNo: created.referenceNo,
          expenseDate: expenseDateStr,
        };
      },
    );
  }

  async cancel(t: TenantContext, id: string, key: string, dto: CancelExpenseDto, meta: Meta) {
    const branchId = this.branch(t);
    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /expenses/:id/cancel',
      { branchId, id, ...dto },
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM expenses
          WHERE id = ${id}::uuid AND organization_id = ${t.organizationId}::uuid AND branch_id = ${branchId}::uuid
          FOR NO KEY UPDATE`;
        const exp = await tx.expense.findFirst({
          where: { id, organizationId: t.organizationId, branchId },
          include: { category: { select: { name: true } } },
        });
        if (!exp) {
          throw new AppException('EXPENSE_NOT_FOUND', 'Expense not found', 404);
        }
        if (exp.cancelledAt) {
          throw new AppException(
            'EXPENSE_ALREADY_CANCELLED',
            'This expense is already cancelled',
            409,
          );
        }

        const amount = new Decimal(exp.amount.toString());
        const cancelledAt = new Date();
        await tx.expense.update({
          where: { id: exp.id },
          data: { cancelledAt },
        });

        // Booked now (today, or the next open day), never into the original day: that day may be closed.
        await this.cashbook.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          kind: 'REVERSAL',
          method: exp.method as PaymentMethodName,
          amount,
          referenceType: 'EXPENSE_CANCELLATION',
          referenceId: exp.id,
          description: `Cancelled expense (${exp.category.name}): ${dto.reason}`,
        });

        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'expense.cancelled',
          entityType: 'expense',
          entityId: exp.id,
          after: { reason: dto.reason, amount: amount.toFixed(2) },
          ...meta,
        });

        return {
          id: exp.id,
          cancelledAt: cancelledAt.toISOString(),
        };
      },
    );
  }

  private validateExpenseDate(value?: string): string {
    const today = todayInIndia();
    if (!value) return today;
    const d = new Date(value);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
      throw new DomainError(
        'EXPENSE_DATE_INVALID',
        'The expense date is not a valid calendar date',
      );
    }
    if (value > today) {
      throw new DomainError('EXPENSE_DATE_IN_FUTURE', 'Expense date cannot be in the future');
    }
    const min = new Date(`${today}T00:00:00Z`);
    min.setUTCDate(min.getUTCDate() - 30);
    if (d.getTime() < min.getTime()) {
      throw new DomainError(
        'EXPENSE_DATE_TOO_OLD',
        'Expense date can be at most 30 days in the past',
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
