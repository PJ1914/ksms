import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { Paginated } from '../../common/pagination/paginated';
import { timestampRange, todayInIndia } from '../../common/utils/dates';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type {
  AgentSummaryQuery,
  AssignCustomerDto,
  CollectionAgentsQuery,
  CreateCollectionAgentDto,
  UpdateCollectionAgentDto,
} from './collections.dto';

type Tx = Prisma.TransactionClient;
interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const m2 = (v: { toString(): string }) => new Decimal(v.toString()).toFixed(2);

@Injectable()
export class CollectionAgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, q: CollectionAgentsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.CollectionAgentWhereInput = {
      organizationId,
      deletedAt: null,
      ...(q.activeOnly ? { isActive: true } : {}),
      ...(q.q
        ? {
            OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.collectionAgent.count({ where }),
      this.prisma.collectionAgent.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: {
            select: {
              assignments: { where: { status: 'ACTIVE' } },
              records: { where: { payment: { status: 'COMPLETED' } } },
            },
          },
        },
      }),
    ]);

    const ids = rows.map((r) => r.id);
    const totals = ids.length
      ? await this.prisma.collectionRecord.groupBy({
          by: ['agentId'],
          where: {
            organizationId,
            agentId: { in: ids },
            payment: { status: 'COMPLETED' },
          },
          _sum: { amount: true },
        })
      : [];
    const collectedByAgent = new Map(
      totals.map((t) => [t.agentId, t._sum.amount ? m2(t._sum.amount) : '0.00']),
    );

    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      userId: r.userId,
      isActive: r.isActive,
      activeAssignments: r._count.assignments,
      completedCollections: r._count.records,
      totalCollected: collectedByAgent.get(r.id) ?? '0.00',
      createdAt: r.createdAt.toISOString(),
    }));

    return new Paginated(items, { page, pageSize, total });
  }

  async get(organizationId: string, id: string) {
    const agent = await this.prisma.collectionAgent.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        assignments: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          include: {
            customer: {
              select: { id: true, name: true, phone: true, balance: true, isActive: true },
            },
          },
        },
        records: {
          orderBy: { collectedAt: 'desc' },
          take: 25,
          include: {
            customer: { select: { id: true, name: true } },
            payment: { select: { status: true, method: true, referenceNo: true } },
          },
        },
      },
    });
    if (!agent) {
      throw new AppException('COLLECTION_AGENT_NOT_FOUND', 'Collection agent not found', 404);
    }

    return {
      id: agent.id,
      name: agent.name,
      phone: agent.phone,
      userId: agent.userId,
      isActive: agent.isActive,
      createdAt: agent.createdAt.toISOString(),
      assignments: agent.assignments.map((a) => ({
        id: a.id,
        customerId: a.customerId,
        customerName: a.customer.name,
        customerPhone: a.customer.phone,
        customerBalance: m2(a.customer.balance),
        targetAmount: a.targetAmount ? m2(a.targetAmount) : null,
        startDate: a.startDate.toISOString().slice(0, 10),
        status: a.status,
      })),
      recentRecords: agent.records.map((r) => ({
        id: r.id,
        paymentId: r.paymentId,
        receiptNumber: r.receiptNumber,
        customerId: r.customerId,
        customerName: r.customer.name,
        amount: m2(r.amount),
        method: r.payment.method,
        status: r.payment.status,
        referenceNo: r.payment.referenceNo,
        collectedAt: r.collectedAt.toISOString(),
      })),
    };
  }

  async create(t: TenantContext, dto: CreateCollectionAgentDto, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.userId) {
        await this.assertUserAvailable(tx, t.organizationId, dto.userId);
      }
      const created = await tx.collectionAgent.create({
        data: {
          organizationId: t.organizationId,
          userId: dto.userId ?? null,
          name: dto.name,
          phone: dto.phone ?? null,
        },
      });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId ?? undefined,
        actorId: t.userId,
        action: 'collection_agent.created',
        entityType: 'collection_agent',
        entityId: created.id,
        after: { name: created.name, phone: created.phone, userId: created.userId },
        ...meta,
      });
      return {
        id: created.id,
        name: created.name,
        phone: created.phone,
        userId: created.userId,
        isActive: created.isActive,
      };
    });
  }

  async update(t: TenantContext, id: string, dto: UpdateCollectionAgentDto, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.collectionAgent.findFirst({
        where: { id, organizationId: t.organizationId, deletedAt: null },
      });
      if (!existing) {
        throw new AppException('COLLECTION_AGENT_NOT_FOUND', 'Collection agent not found', 404);
      }
      if (dto.userId !== undefined && dto.userId !== null && dto.userId !== existing.userId) {
        await this.assertUserAvailable(tx, t.organizationId, dto.userId, id);
      }
      const updated = await tx.collectionAgent.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.userId !== undefined ? { userId: dto.userId } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId ?? undefined,
        actorId: t.userId,
        action: 'collection_agent.updated',
        entityType: 'collection_agent',
        entityId: updated.id,
        before: {
          name: existing.name,
          phone: existing.phone,
          userId: existing.userId,
          isActive: existing.isActive,
        },
        after: {
          name: updated.name,
          phone: updated.phone,
          userId: updated.userId,
          isActive: updated.isActive,
        },
        ...meta,
      });
      return {
        id: updated.id,
        name: updated.name,
        phone: updated.phone,
        userId: updated.userId,
        isActive: updated.isActive,
      };
    });
  }

  async assignCustomer(t: TenantContext, agentId: string, dto: AssignCustomerDto, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const agent = await tx.collectionAgent.findFirst({
        where: { id: agentId, organizationId: t.organizationId, deletedAt: null },
        select: { id: true, isActive: true },
      });
      if (!agent) {
        throw new AppException('COLLECTION_AGENT_NOT_FOUND', 'Collection agent not found', 404);
      }
      if (!agent.isActive) {
        throw new DomainError('AGENT_INACTIVE', 'Cannot assign customers to an inactive agent');
      }

      // One collector per customer at a time. Lock the customer so two simultaneous assignments queue up
      // (the second then sees and ends the first) instead of both ending up ACTIVE.
      await tx.$queryRaw`
        SELECT id FROM customers
        WHERE id = ${dto.customerId}::uuid AND organization_id = ${t.organizationId}::uuid
        FOR NO KEY UPDATE`;
      const customer = await tx.customer.findFirst({
        where: { id: dto.customerId, organizationId: t.organizationId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!customer) {
        throw new AppException('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
      }

      const sameActive = await tx.collectionAssignment.findFirst({
        where: {
          organizationId: t.organizationId,
          agentId,
          customerId: dto.customerId,
          status: 'ACTIVE',
        },
      });
      if (sameActive) {
        throw new AppException(
          'ASSIGNMENT_ALREADY_ACTIVE',
          'This customer is already actively assigned to this agent',
          409,
        );
      }

      const startDate = new Date(dto.startDate ?? todayInIndia());
      if (
        Number.isNaN(startDate.getTime()) ||
        startDate.toISOString().slice(0, 10) !== (dto.startDate ?? todayInIndia())
      ) {
        throw new DomainError('START_DATE_INVALID', 'The start date is not a real calendar date');
      }
      if (
        Number.isNaN(startDate.getTime()) ||
        startDate.toISOString().slice(0, 10) !== (dto.startDate ?? todayInIndia())
      ) {
        throw new DomainError('START_DATE_INVALID', 'The start date is not a real calendar date');
      }

      // End any previous active assignment for this customer so one customer has one active collector.
      await tx.collectionAssignment.updateMany({
        where: {
          organizationId: t.organizationId,
          customerId: dto.customerId,
          status: 'ACTIVE',
        },
        data: { status: 'ENDED', endDate: startDate },
      });

      const created = await tx.collectionAssignment.create({
        data: {
          organizationId: t.organizationId,
          agentId,
          customerId: dto.customerId,
          status: 'ACTIVE',
          targetAmount: dto.targetAmount ? new Decimal(dto.targetAmount).toFixed(2) : null,
          startDate,
        },
      });

      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId ?? undefined,
        actorId: t.userId,
        action: 'collection.assigned',
        entityType: 'collection_assignment',
        entityId: created.id,
        after: {
          agentId,
          customerId: dto.customerId,
          targetAmount: created.targetAmount ? m2(created.targetAmount) : null,
          startDate: created.startDate.toISOString().slice(0, 10),
        },
        ...meta,
      });

      return {
        id: created.id,
        agentId: created.agentId,
        customerId: created.customerId,
        customerName: customer.name,
        status: created.status,
        targetAmount: created.targetAmount ? m2(created.targetAmount) : null,
        startDate: created.startDate.toISOString().slice(0, 10),
      };
    });
  }

  async endAssignment(t: TenantContext, agentId: string, assignmentId: string, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.collectionAssignment.findFirst({
        where: { id: assignmentId, agentId, organizationId: t.organizationId },
      });
      if (!assignment) {
        throw new AppException('ASSIGNMENT_NOT_FOUND', 'Collection assignment not found', 404);
      }
      if (assignment.status === 'ENDED') {
        throw new AppException(
          'ASSIGNMENT_ALREADY_ENDED',
          'This assignment has already ended',
          409,
        );
      }
      const updated = await tx.collectionAssignment.update({
        where: { id: assignmentId },
        data: { status: 'ENDED', endDate: new Date(todayInIndia()) },
      });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        branchId: t.branchId ?? undefined,
        actorId: t.userId,
        action: 'collection.assignment_ended',
        entityType: 'collection_assignment',
        entityId: updated.id,
        after: { agentId, customerId: updated.customerId, status: updated.status },
        ...meta,
      });
      return {
        id: updated.id,
        status: updated.status,
        endDate: updated.endDate?.toISOString().slice(0, 10) ?? null,
      };
    });
  }

  async summary(organizationId: string, agentId: string, q: AgentSummaryQuery) {
    const agent = await this.prisma.collectionAgent.findFirst({
      where: { id: agentId, organizationId, deletedAt: null },
      select: { id: true, name: true, phone: true, isActive: true },
    });
    if (!agent) {
      throw new AppException('COLLECTION_AGENT_NOT_FOUND', 'Collection agent not found', 404);
    }

    const range = timestampRange(q.from, q.to);
    const [assignments, records] = await Promise.all([
      this.prisma.collectionAssignment.findMany({
        where: { organizationId, agentId, status: 'ACTIVE' },
        include: { customer: { select: { balance: true } } },
      }),
      this.prisma.collectionRecord.findMany({
        where: {
          organizationId,
          agentId,
          ...(range ? { collectedAt: range } : {}),
          payment: { status: 'COMPLETED' },
        },
        include: { payment: { select: { method: true } } },
      }),
    ]);

    const assignedOutstanding = assignments.reduce(
      (sum, a) => sum.plus(Decimal.max(new Decimal(a.customer.balance.toString()), 0)),
      new Decimal(0),
    );

    let totalCollected = new Decimal(0);
    const byMethod: Record<string, Decimal> = {
      CASH: new Decimal(0),
      UPI: new Decimal(0),
      CARD: new Decimal(0),
      BANK_TRANSFER: new Decimal(0),
      OTHER: new Decimal(0),
    };
    for (const r of records) {
      const amt = new Decimal(r.amount.toString());
      totalCollected = totalCollected.plus(amt);
      const m = r.payment.method;
      byMethod[m] = (byMethod[m] ?? new Decimal(0)).plus(amt);
    }

    return {
      agent,
      activeAssignments: assignments.length,
      assignedOutstanding: assignedOutstanding.toFixed(2),
      collectionCount: records.length,
      totalCollected: totalCollected.toFixed(2),
      byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, v.toFixed(2)])),
    };
  }

  private async assertUserAvailable(
    tx: Tx | Db,
    organizationId: string,
    userId: string,
    excludeAgentId?: string,
  ) {
    const member = await tx.organizationMember.findFirst({
      where: { organizationId, userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!member) {
      throw new AppException('USER_NOT_FOUND', 'Linked user not found in this shop', 404);
    }
    const existing = await tx.collectionAgent.findFirst({
      where: {
        organizationId,
        userId,
        deletedAt: null,
        ...(excludeAgentId ? { id: { not: excludeAgentId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new DomainError(
        'AGENT_USER_ALREADY_LINKED',
        'This login is already linked to another collection agent',
      );
    }
  }
}
