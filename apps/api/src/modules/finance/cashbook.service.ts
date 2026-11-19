import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DEFAULT_CASH_REGISTER_NAME } from '@ksms/constants';
import { AppException } from '../../common/errors/app.exception';
import { todayInIndia } from '../../common/utils/dates';
import type { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

export type CashbookKind =
  | 'SALE_RECEIPT'
  | 'CUSTOMER_COLLECTION'
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE'
  | 'REFUND'
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'REVERSAL'
  | 'OPENING_BALANCE';

export type PaymentMethodName = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';

export interface CashbookLine {
  organizationId: string;
  branchId: string;
  actorId: string;
  kind: CashbookKind;
  method: PaymentMethodName;
  /** Signed: positive = money in, negative = money out. */
  amount: Decimal;
  paymentId?: string;
  referenceType: string;
  referenceId: string;
  description: string;
  businessDate?: string;
}

/**
 * The only writer of cashbook lines (append-only table). Every money movement of a branch goes on that branch's
 * cash register, so the daily closing (Phase 12) sees all of it in one place. Writes in the caller's transaction.
 */
@Injectable()
export class CashbookService {
  async record(tx: Tx, line: CashbookLine): Promise<void> {
    if (line.amount.isZero()) return;
    const registerId = await this.registerOf(tx, line.organizationId, line.branchId);
    // Share-lock the register: a daily closing (which holds it exclusively) and a cash line then queue up, so a
    // line can never slip into a day after that day's figures were taken.
    await tx.$queryRaw`SELECT id FROM cash_registers WHERE id = ${registerId}::uuid FOR SHARE`;

    // A line that names its day (a manual entry, an expense date) must land on that day, or be refused if the day
    // is closed. A line made "now" (a sale, a collection, a refund) goes on today, or on the next business day when
    // today has already been closed: the shop can keep trading after the evening close.
    const explicit = line.businessDate !== undefined;
    let businessDateStr = line.businessDate ?? todayInIndia();
    const isClosed = async (day: string) =>
      (await tx.dailyClosing.findFirst({
        where: { registerId, businessDate: new Date(day), status: 'CLOSED' },
        select: { id: true },
      })) !== null;

    if (await isClosed(businessDateStr)) {
      if (explicit) {
        throw new AppException(
          'DAY_ALREADY_CLOSED',
          `Cash register is already closed for ${businessDateStr}`,
          409,
        );
      }
      const next = new Date(`${businessDateStr}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      businessDateStr = next.toISOString().slice(0, 10); // a future day can never be closed
    }
    const businessDate = new Date(businessDateStr);

    await tx.cashbookEntry.create({
      data: {
        organizationId: line.organizationId,
        branchId: line.branchId,
        registerId,
        kind: line.kind,
        method: line.method,
        amount: line.amount.toFixed(2),
        paymentId: line.paymentId,
        referenceType: line.referenceType,
        referenceId: line.referenceId,
        description: line.description,
        businessDate,
        createdById: line.actorId,
      },
    });
  }

  /**
   * The branch's register: the oldest active one (branches are created with "Main Register"). Created only if a
   * branch somehow has none, so a branch never ends up with two registers by accident.
   */
  async registerOf(tx: Tx, organizationId: string, branchId: string): Promise<string> {
    const existing = await tx.cashRegister.findFirst({
      where: { branchId, organizationId, isActive: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (existing) return existing.id;
    await tx.$executeRaw`
      INSERT INTO cash_registers (id, organization_id, branch_id, name, is_active)
      VALUES (gen_random_uuid(), ${organizationId}::uuid, ${branchId}::uuid, ${DEFAULT_CASH_REGISTER_NAME}, true)
      ON CONFLICT (branch_id, name) DO NOTHING`;
    const created = await tx.cashRegister.findFirstOrThrow({
      where: { branchId, name: DEFAULT_CASH_REGISTER_NAME },
      select: { id: true },
    });
    return created.id;
  }
}
