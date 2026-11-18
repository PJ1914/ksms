import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { DEFAULT_CASH_REGISTER_NAME } from '@ksms/constants';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { DomainError } from '../../common/errors/domain.error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DocumentNumberService } from '../../common/numbering/document-number.service';
import { Paginated } from '../../common/pagination/paginated';
import { timestampRange } from '../../common/utils/dates';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { todayInIndia } from '../inventory/domain/stock';
import type { PaymentsQuery, ReversePaymentDto, SupplierPaymentDto } from './procurement.dto';
import { SupplierLedgerService } from './supplier-ledger.service';

type Tx = Prisma.TransactionClient;
interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

const dec = (v: { toString(): string }) => new Decimal(v.toString());
const m2 = (v: { toString(): string }) => dec(v).toFixed(2);

interface Outstanding {
  id: string;
  purchaseNumber: string;
  outstanding: Decimal;
}

/**
 * Money paid to suppliers. One payment can settle several purchases; whatever is not allocated stays as an advance
 * (the supplier balance goes negative). Every payment writes, in ONE transaction: the payment, its allocations,
 * a cashbook line and a supplier ledger line. Mistakes are fixed by a reversal, never by editing or deleting.
 */
@Injectable()
export class SupplierPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: SupplierLedgerService,
    private readonly numbers: DocumentNumberService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async pay(
    t: TenantContext,
    supplierId: string,
    key: string,
    dto: SupplierPaymentDto,
    meta: Meta,
  ) {
    const branchId = this.branch(t);
    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /suppliers/:id/payments',
      { branchId, supplierId, ...dto },
      async (tx) => {
        const amount = new Decimal(dto.amount);
        if (amount.lte(0))
          throw new DomainError('PAYMENT_AMOUNT_INVALID', 'The payment must be more than zero');

        // The supplier lock serialises every payment and posting for this supplier, so two payments can never
        // allocate the same outstanding amount twice.
        await this.ledger.lockBalance(tx, t.organizationId, supplierId);

        const open = await this.outstanding(tx, t.organizationId, supplierId);
        const allocations = dto.allocations?.length
          ? this.explicitAllocations(dto.allocations, open, amount)
          : this.oldestFirst(open, amount);
        const allocated = allocations.reduce((a, x) => a.plus(x.amount), new Decimal(0));

        const paymentId = randomUUID();
        const receipt = await this.numbers.next(
          tx,
          { organizationId: t.organizationId, branchId },
          'RECEIPT',
          'PV',
        );
        await tx.payment.create({
          data: {
            id: paymentId,
            organizationId: t.organizationId,
            branchId,
            direction: 'OUT',
            purpose: 'SUPPLIER_PAYMENT',
            method: dto.method,
            amount: amount.toFixed(2),
            supplierId,
            receiptNumber: receipt.number,
            referenceNo: dto.referenceNo,
            notes: dto.notes,
            recordedById: t.userId,
          },
        });
        if (allocations.length > 0) {
          await tx.purchasePayment.createMany({
            data: allocations.map((a) => ({
              organizationId: t.organizationId,
              purchaseId: a.purchaseId,
              paymentId,
              amount: a.amount.toFixed(2),
            })),
          });
        }
        await this.cashbook(tx, t, branchId, {
          kind: 'SUPPLIER_PAYMENT',
          method: dto.method,
          amount: amount.negated(),
          paymentId,
          description: `Paid supplier (${receipt.number})`,
        });
        const posted = await this.ledger.post(tx, {
          organizationId: t.organizationId,
          branchId,
          supplierId,
          actorId: t.userId,
          type: 'PAYMENT',
          amount: amount.negated(),
          referenceType: 'PAYMENT',
          referenceId: paymentId,
          description: `Payment ${receipt.number}${dto.referenceNo ? ` (${dto.referenceNo})` : ''}`,
        });
        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId,
          actorId: t.userId,
          action: 'supplier.payment',
          entityType: 'payment',
          entityId: paymentId,
          after: {
            supplierId,
            amount: amount.toFixed(2),
            method: dto.method,
            allocated: allocated.toFixed(2),
            advance: amount.minus(allocated).toFixed(2),
          },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        });

        return {
          id: paymentId,
          receiptNumber: receipt.number,
          supplierId,
          amount: amount.toFixed(2),
          method: dto.method,
          referenceNo: dto.referenceNo ?? null,
          allocations: allocations.map((a) => ({
            purchaseId: a.purchaseId,
            purchaseNumber: a.purchaseNumber,
            amount: a.amount.toFixed(2),
          })),
          /** The part not matched to any purchase; it reduces what the shop owes later. */
          advance: amount.minus(allocated).toFixed(2),
          supplierBalance: posted!.balanceAfter.toFixed(2),
        };
      },
    );
  }

  /** Undoes a payment recorded by mistake: a new opposite payment, cashbook line and ledger line. Nothing is deleted. */
  async reverse(
    t: TenantContext,
    paymentId: string,
    key: string,
    dto: ReversePaymentDto,
    meta: Meta,
  ) {
    // Like every other money action, a payment can be undone only from the branch it was made in.
    const scopeBranchId = this.branch(t);
    return this.idempotency.execute(
      t.organizationId,
      key,
      'POST /supplier-payments/:id/reverse',
      { branchId: scopeBranchId, paymentId, ...dto },
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; supplier_id: string; branch_id: string }[]>`
          SELECT id, supplier_id, branch_id FROM payments
          WHERE id = ${paymentId}::uuid AND organization_id = ${t.organizationId}::uuid
            AND branch_id = ${scopeBranchId}::uuid
            AND purpose = 'SUPPLIER_PAYMENT' AND direction = 'OUT' AND supplier_id IS NOT NULL
          FOR UPDATE`;
        const row = rows[0];
        if (!row) throw new AppException('PAYMENT_NOT_FOUND', 'Supplier payment not found', 404);
        const original = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
        if (original.status !== 'COMPLETED') {
          throw new AppException(
            'PAYMENT_ALREADY_REVERSED',
            'This payment was already reversed',
            409,
          );
        }
        await this.ledger.lockBalance(tx, t.organizationId, row.supplier_id);

        const reversalId = randomUUID();
        const receipt = await this.numbers.next(
          tx,
          { organizationId: t.organizationId, branchId: row.branch_id },
          'RECEIPT',
          'PV',
        );
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: 'REVERSED', reversedAt: new Date() },
        });
        await tx.payment.create({
          data: {
            id: reversalId,
            organizationId: t.organizationId,
            branchId: row.branch_id,
            direction: 'IN',
            purpose: 'SUPPLIER_PAYMENT',
            method: original.method,
            amount: original.amount,
            status: 'COMPLETED',
            supplierId: row.supplier_id,
            receiptNumber: receipt.number,
            referenceNo: original.referenceNo,
            recordedById: t.userId,
            reversalOfId: paymentId,
            notes: `Reversal: ${dto.reason}`,
          },
        });
        await this.cashbook(tx, t, row.branch_id, {
          kind: 'REVERSAL',
          method: original.method,
          amount: dec(original.amount),
          paymentId: reversalId,
          description: `Reversal of ${original.receiptNumber ?? 'payment'}: ${dto.reason}`,
        });
        const posted = await this.ledger.post(tx, {
          organizationId: t.organizationId,
          branchId: row.branch_id,
          supplierId: row.supplier_id,
          actorId: t.userId,
          type: 'CANCELLATION_REVERSAL',
          amount: dec(original.amount),
          referenceType: 'PAYMENT',
          referenceId: reversalId,
          description: `Reversal of ${original.receiptNumber ?? 'payment'}: ${dto.reason}`,
        });
        await this.audit.record(tx, {
          organizationId: t.organizationId,
          branchId: row.branch_id,
          actorId: t.userId,
          action: 'supplier.payment.reverse',
          entityType: 'payment',
          entityId: paymentId,
          reason: dto.reason,
          after: { reversalId, amount: m2(original.amount) },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        });
        return {
          reversedPaymentId: paymentId,
          reversalPaymentId: reversalId,
          receiptNumber: receipt.number,
          amount: m2(original.amount),
          supplierBalance: posted!.balanceAfter.toFixed(2),
        };
      },
    );
  }

  async list(t: TenantContext, q: PaymentsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.PaymentWhereInput = {
      organizationId: t.organizationId,
      purpose: 'SUPPLIER_PAYMENT',
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.from || q.to ? { paidAt: timestampRange(q.from, q.to) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { supplier: { select: { id: true, name: true } }, purchasePayments: true },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return new Paginated(
      rows.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        direction: p.direction,
        status: p.status,
        method: p.method,
        amount: m2(p.amount),
        referenceNo: p.referenceNo,
        supplier: p.supplier,
        reversalOfId: p.reversalOfId,
        allocatedTo: p.purchasePayments.length,
        paidAt: p.paidAt,
      })),
      { page, pageSize, total },
    );
  }

  /** Outstanding purchases of one supplier, oldest first. */
  async outstanding(db: Db, organizationId: string, supplierId: string): Promise<Outstanding[]> {
    const rows = await db.$queryRaw<{ id: string; purchase_number: string; outstanding: string }[]>`
      SELECT p.id, p.purchase_number,
        (p.billed_total - p.returned_total - COALESCE((
          SELECT sum(pp.amount) FROM purchase_payments pp JOIN payments pay ON pay.id = pp.payment_id
          WHERE pp.purchase_id = p.id AND pay.status = 'COMPLETED'), 0))::text AS outstanding
      FROM purchases p
      WHERE p.organization_id = ${organizationId}::uuid AND p.supplier_id = ${supplierId}::uuid
        AND p.status IN ('PARTIALLY_RECEIVED', 'RECEIVED')
      ORDER BY p.purchase_date ASC, p.created_at ASC, p.id ASC`;
    return rows
      .map((r) => ({
        id: r.id,
        purchaseNumber: r.purchase_number,
        outstanding: new Decimal(r.outstanding),
      }))
      .filter((r) => r.outstanding.gt(0));
  }

  private oldestFirst(open: Outstanding[], amount: Decimal) {
    let left = amount;
    const out: { purchaseId: string; purchaseNumber: string; amount: Decimal }[] = [];
    for (const o of open) {
      if (left.lte(0)) break;
      const part = Decimal.min(o.outstanding, left);
      out.push({ purchaseId: o.id, purchaseNumber: o.purchaseNumber, amount: part });
      left = left.minus(part);
    }
    return out;
  }

  private explicitAllocations(
    requested: NonNullable<SupplierPaymentDto['allocations']>,
    open: Outstanding[],
    amount: Decimal,
  ) {
    const byId = new Map(open.map((o) => [o.id, o]));
    const seen = new Set<string>();
    let total = new Decimal(0);
    const out: { purchaseId: string; purchaseNumber: string; amount: Decimal }[] = [];
    for (const r of requested) {
      const o = byId.get(r.purchaseId);
      if (!o) {
        throw new DomainError(
          'ALLOCATION_NOT_PAYABLE',
          'This purchase has nothing outstanding for this supplier',
          {
            purchaseId: r.purchaseId,
          },
        );
      }
      if (seen.has(r.purchaseId))
        throw new DomainError('ALLOCATION_DUPLICATE', 'List each purchase once');
      seen.add(r.purchaseId);
      const part = new Decimal(r.amount);
      if (part.lte(0))
        throw new DomainError('ALLOCATION_INVALID', 'Each allocation must be more than zero');
      if (part.gt(o.outstanding)) {
        throw new DomainError(
          'ALLOCATION_EXCEEDS_OUTSTANDING',
          'More than what is outstanding on this purchase',
          {
            purchaseId: r.purchaseId,
            outstanding: o.outstanding.toFixed(2),
          },
        );
      }
      total = total.plus(part);
      out.push({ purchaseId: o.id, purchaseNumber: o.purchaseNumber, amount: part });
    }
    if (total.gt(amount)) {
      throw new DomainError(
        'ALLOCATION_EXCEEDS_PAYMENT',
        'The allocations add up to more than the payment',
        {
          allocated: total.toFixed(2),
          payment: amount.toFixed(2),
        },
      );
    }
    return out;
  }

  /** One cashbook line, on the branch's cash register. */
  private async cashbook(
    tx: Tx,
    t: TenantContext,
    branchId: string,
    e: {
      kind: 'SUPPLIER_PAYMENT' | 'REVERSAL';
      method: SupplierPaymentDto['method'];
      amount: Decimal;
      paymentId: string;
      description: string;
    },
  ) {
    // Branches are created with their register (BranchService). Use the oldest active one, so supplier payments
    // and the daily closing always agree; only create the default if the branch somehow has none.
    let register = await tx.cashRegister.findFirst({
      where: { branchId, isActive: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!register) {
      await tx.$executeRaw`
        INSERT INTO cash_registers (id, organization_id, branch_id, name, is_active)
        VALUES (gen_random_uuid(), ${t.organizationId}::uuid, ${branchId}::uuid, ${DEFAULT_CASH_REGISTER_NAME}, true)
        ON CONFLICT (branch_id, name) DO NOTHING`;
      register = await tx.cashRegister.findFirstOrThrow({
        where: { branchId, name: DEFAULT_CASH_REGISTER_NAME },
        select: { id: true },
      });
    }
    await tx.cashbookEntry.create({
      data: {
        organizationId: t.organizationId,
        branchId,
        registerId: register.id,
        kind: e.kind,
        method: e.method,
        amount: e.amount.toFixed(2),
        paymentId: e.paymentId,
        referenceType: 'PAYMENT',
        referenceId: e.paymentId,
        description: e.description,
        businessDate: new Date(todayInIndia()),
        createdById: t.userId,
      },
    });
  }

  private branch(t: TenantContext): string {
    if (!t.branchId)
      throw new AppException('BRANCH_REQUIRED', 'x-branch-id header is required', 400);
    return t.branchId;
  }
}
