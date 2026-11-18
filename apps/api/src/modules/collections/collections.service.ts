import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DocumentNumberService } from '../../common/numbering/document-number.service';
import { Paginated } from '../../common/pagination/paginated';
import { timestampRange } from '../../common/utils/dates';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CustomerLedgerService } from '../customers/customer-ledger.service';
import { CashbookService } from '../finance/cashbook.service';
import type {
  CollectionsQuery,
  CustomerPaymentDto,
  PaymentMethodName,
  ReverseCollectionDto,
} from './collections.dto';

type Tx = Prisma.TransactionClient;
interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const m2 = (v: { toString(): string }) => new Decimal(v.toString()).toFixed(2);

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerLedger: CustomerLedgerService,
    private readonly cashbook: CashbookService,
    private readonly numbers: DocumentNumberService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async recordPayment(
    t: TenantContext,
    customerId: string,
    key: string,
    dto: CustomerPaymentDto,
    meta: Meta,
    routeKey: string,
    /** True for roles with collection.assign (owner, manager): they may record for any agent. */
    canAttributeOthers: boolean,
  ) {
    const branchId = this.branch(t);
    return this.idempotency.execute(
      t.organizationId,
      key,
      routeKey,
      { branchId, customerId, ...dto },
      async (tx) => {
        const amount = new Decimal(dto.amount);
        if (amount.lte(0)) {
          throw new DomainError('PAYMENT_AMOUNT_INVALID', 'The payment must be more than zero');
        }

        const now = new Date();
        const collectedAt = this.collectedAt(dto.collectedAt, now);
        const agent = await this.resolveAgent(
          tx,
          t.organizationId,
          t.userId,
          dto.agentId,
          canAttributeOthers,
        );

        const paymentId = randomUUID();
        // The receipt series follows the day the receipt is ISSUED, never a date the caller chose.
        const receipt = await this.numbers.next(
          tx,
          { organizationId: t.organizationId, branchId },
          'RECEIPT',
          'RV',
          now,
        );

        const posted = await this.customerLedger.post(tx, {
          organizationId: t.organizationId,
          branchId,
          customerId,
          actorId: t.userId,
          type: 'PAYMENT',
          amount: amount.negated(),
          referenceType: 'PAYMENT',
          referenceId: paymentId,
          description: `Collection ${receipt.number}${dto.referenceNo ? ` (${dto.referenceNo})` : ''}`,
        });

        await tx.payment.create({
          data: {
            id: paymentId,
            organizationId: t.organizationId,
            branchId,
            direction: 'IN',
            purpose: 'CUSTOMER_COLLECTION',
            method: dto.method,
            amount: amount.toFixed(2),
            customerId,
            receiptNumber: receipt.number,
            referenceNo: dto.referenceNo,
            notes: dto.notes,
            recordedById: t.userId,
            paidAt: collectedAt,
          },
        });

        await this.cashbook.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          kind: 'CUSTOMER_COLLECTION',
          method: dto.method,
          amount,
          paymentId,
          referenceType: 'PAYMENT',
          referenceId: paymentId,
          description: `Customer collection (${receipt.number})`,
        });

        let collectionRecord: { id: string; agentId: string; agentName: string } | null = null;
        if (agent) {
          const rec = await tx.collectionRecord.create({
            data: {
              organizationId: t.organizationId,
              branchId,
              agentId: agent.id,
              customerId,
              paymentId,
              receiptNumber: receipt.number,
              amount: amount.toFixed(2),
              recordedById: t.userId,
              collectedAt,
              notes: dto.notes,
            },
          });
          collectionRecord = { id: rec.id, agentId: agent.id, agentName: agent.name };
        }

        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'collection.recorded',
          entityType: 'payment',
          entityId: paymentId,
          after: {
            customerId,
            amount: amount.toFixed(2),
            method: dto.method,
            receiptNumber: receipt.number,
            agentId: agent?.id ?? null,
            balanceAfter: posted.balanceAfter.toFixed(2),
          },
          ...meta,
        });

        return {
          paymentId,
          customerId,
          receiptNumber: receipt.number,
          amount: amount.toFixed(2),
          method: dto.method,
          balanceAfter: posted.balanceAfter.toFixed(2),
          collectedAt: collectedAt.toISOString(),
          collectionRecord,
        };
      },
    );
  }

  async list(t: TenantContext, q: CollectionsQuery) {
    const branchId = this.branch(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const range = timestampRange(q.from, q.to);

    const where: Prisma.PaymentWhereInput = {
      organizationId: t.organizationId,
      branchId,
      purpose: 'CUSTOMER_COLLECTION',
      direction: 'IN',
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(range ? { paidAt: range } : {}),
      ...(q.agentId ? { collection: { agentId: q.agentId } } : {}),
      ...(q.q
        ? {
            OR: [
              { receiptNumber: { contains: q.q, mode: 'insensitive' } },
              { referenceNo: { contains: q.q, mode: 'insensitive' } },
              { customer: { name: { contains: q.q, mode: 'insensitive' } } },
              { customer: { phone: { contains: q.q } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          recordedBy: { select: { id: true, fullName: true } },
          collection: {
            include: { agent: { select: { id: true, name: true } } },
          },
        },
      }),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      amount: m2(r.amount),
      method: r.method,
      status: r.status,
      referenceNo: r.referenceNo,
      notes: r.notes,
      paidAt: r.paidAt.toISOString(),
      reversedAt: r.reversedAt?.toISOString() ?? null,
      customer: r.customer,
      recordedBy: r.recordedBy,
      agent: r.collection ? { id: r.collection.agent.id, name: r.collection.agent.name } : null,
    }));

    return new Paginated(items, { page, pageSize, total });
  }

  async get(t: TenantContext, id: string) {
    const branchId = this.branch(t);
    const p = await this.prisma.payment.findFirst({
      where: {
        id,
        organizationId: t.organizationId,
        branchId,
        purpose: 'CUSTOMER_COLLECTION',
        direction: 'IN',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, balance: true } },
        recordedBy: { select: { id: true, fullName: true } },
        collection: {
          include: { agent: { select: { id: true, name: true, phone: true } } },
        },
      },
    });
    if (!p) {
      throw new AppException('COLLECTION_NOT_FOUND', 'Collection receipt not found', 404);
    }

    return {
      id: p.id,
      receiptNumber: p.receiptNumber,
      amount: m2(p.amount),
      method: p.method,
      status: p.status,
      referenceNo: p.referenceNo,
      notes: p.notes,
      paidAt: p.paidAt.toISOString(),
      reversedAt: p.reversedAt?.toISOString() ?? null,
      customer: p.customer
        ? {
            id: p.customer.id,
            name: p.customer.name,
            phone: p.customer.phone,
            balance: m2(p.customer.balance),
          }
        : null,
      recordedBy: p.recordedBy,
      agent: p.collection ? p.collection.agent : null,
    };
  }

  async reverse(
    t: TenantContext,
    paymentId: string,
    key: string,
    dto: ReverseCollectionDto,
    meta: Meta,
  ) {
    const branchId = this.branch(t);
    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /collections/:id/reverse',
      { branchId, paymentId, ...dto },
      async (tx) => {
        // Lock the receipt first: two simultaneous reversals must queue up, and the second must see REVERSED
        // (and answer 409) instead of tripping the one-reversal-per-payment database rule.
        await tx.$queryRaw`
          SELECT id FROM payments
          WHERE id = ${paymentId}::uuid AND organization_id = ${t.organizationId}::uuid
          FOR NO KEY UPDATE`;
        const orig = await tx.payment.findFirst({
          where: {
            id: paymentId,
            organizationId: t.organizationId,
            branchId,
            purpose: 'CUSTOMER_COLLECTION',
            direction: 'IN',
          },
        });
        if (!orig || !orig.customerId) {
          throw new AppException('COLLECTION_NOT_FOUND', 'Collection receipt not found', 404);
        }
        if (orig.status === 'REVERSED') {
          throw new AppException(
            'PAYMENT_ALREADY_REVERSED',
            'This collection is already reversed',
            409,
          );
        }

        const amount = new Decimal(orig.amount.toString());
        const reversalId = randomUUID();

        const posted = await this.customerLedger.post(tx, {
          organizationId: t.organizationId,
          branchId,
          customerId: orig.customerId,
          actorId: t.userId,
          type: 'CANCELLATION_REVERSAL',
          amount,
          referenceType: 'PAYMENT_REVERSAL',
          referenceId: reversalId,
          description: `Reversal of ${orig.receiptNumber ?? paymentId}: ${dto.reason}`,
        });

        await tx.payment.create({
          data: {
            id: reversalId,
            organizationId: t.organizationId,
            branchId,
            direction: 'OUT',
            purpose: 'CUSTOMER_COLLECTION',
            method: orig.method,
            amount: amount.toFixed(2),
            customerId: orig.customerId,
            reversalOfId: orig.id,
            notes: dto.reason,
            recordedById: t.userId,
          },
        });

        await tx.payment.update({
          where: { id: orig.id },
          data: { status: 'REVERSED', reversedAt: new Date() },
        });

        await this.cashbook.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          kind: 'REVERSAL',
          method: orig.method as PaymentMethodName,
          amount: amount.negated(),
          paymentId: reversalId,
          referenceType: 'PAYMENT_REVERSAL',
          referenceId: reversalId,
          description: `Reversal of collection ${orig.receiptNumber ?? paymentId}`,
        });

        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'collection.reversed',
          entityType: 'payment',
          entityId: orig.id,
          after: {
            reversalId,
            receiptNumber: orig.receiptNumber,
            amount: amount.toFixed(2),
            reason: dto.reason,
            balanceAfter: posted.balanceAfter.toFixed(2),
          },
          ...meta,
        });

        return {
          paymentId: orig.id,
          reversalId,
          receiptNumber: orig.receiptNumber,
          status: 'REVERSED' as const,
          balanceAfter: posted.balanceAfter.toFixed(2),
        };
      },
    );
  }

  /**
   * Who gets the credit for a collection. A collector can only record under THEIR OWN agent record; only roles that
   * manage agents (collection.assign) may name another agent. Without an explicit agent, a login linked to an
   * active agent is attributed automatically.
   */
  private async resolveAgent(
    tx: Tx,
    organizationId: string,
    userId: string,
    explicitAgentId: string | undefined,
    canAttributeOthers: boolean,
  ): Promise<{ id: string; name: string } | null> {
    const linked = await tx.collectionAgent.findFirst({
      where: { organizationId, userId, isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });

    if (explicitAgentId && !canAttributeOthers && explicitAgentId !== linked?.id) {
      throw new AppException(
        'AGENT_ATTRIBUTION_FORBIDDEN',
        'You can only record collections under your own agent profile',
        403,
      );
    }
    if (explicitAgentId && explicitAgentId !== linked?.id) {
      const agent = await tx.collectionAgent.findFirst({
        where: { id: explicitAgentId, organizationId, deletedAt: null },
        select: { id: true, name: true, isActive: true },
      });
      if (!agent) {
        throw new AppException('COLLECTION_AGENT_NOT_FOUND', 'Collection agent not found', 404);
      }
      if (!agent.isActive) {
        throw new DomainError('AGENT_INACTIVE', 'This collection agent is inactive');
      }
      return { id: agent.id, name: agent.name };
    }
    return linked ?? null;
  }

  /** The time the money was received: never in the future, never more than 7 days back. */
  private collectedAt(value: string | undefined, now: Date): Date {
    if (!value) return now;
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) {
      throw new DomainError('COLLECTED_AT_INVALID', 'The collection time is not a valid date');
    }
    const FUTURE_SLACK_MS = 5 * 60 * 1000; // phone clocks drift a little
    const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;
    if (at.getTime() > now.getTime() + FUTURE_SLACK_MS) {
      throw new DomainError(
        'COLLECTED_AT_IN_FUTURE',
        'The collection time cannot be in the future',
      );
    }
    if (at.getTime() < now.getTime() - MAX_BACKDATE_MS) {
      throw new DomainError(
        'COLLECTED_AT_TOO_OLD',
        'A collection can be dated at most 7 days back; record older money as an adjustment',
      );
    }
    return at.getTime() > now.getTime() ? now : at;
  }

  private branch(t: TenantContext): string {
    if (!t.branchId) {
      throw new DomainError('BRANCH_REQUIRED', 'Choose a branch before recording collections');
    }
    return t.branchId;
  }
}
