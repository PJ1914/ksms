import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { Paginated } from '../../common/pagination/paginated';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { HeldBillDto, HeldBillsQuery } from './sales.dto';
import { branchOf } from './sales.service';

const MAX_PAYLOAD_BYTES = 64 * 1024;
type Db = PrismaService | Prisma.TransactionClient;

/**
 * Held bills: a cart parked at the counter ("hold this, serve the next customer") so another device in the branch
 * can pick it up. They NEVER touch stock, money or numbers. Checking out with `heldBillId` closes the held bill.
 */
@Injectable()
export class HeldBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(t: TenantContext, dto: HeldBillDto) {
    return this.createInDb(this.prisma, t, dto);
  }

  /** Idempotent held-bill upload used by the mobile sync outbox so retries never create duplicates. */
  async createIdempotent(t: TenantContext, idempotencyKey: string, dto: HeldBillDto) {
    const branchId = branchOf(t);
    return this.idempotency.execute(
      { organizationId: t.organizationId, userId: t.userId },
      idempotencyKey,
      'POST /held-bills',
      { branchId, ...dto },
      (tx) => this.createInDb(tx, t, dto),
    );
  }

  private async createInDb(db: Db, t: TenantContext, dto: HeldBillDto) {
    const branchId = branchOf(t);
    this.assertPayload(dto.payload);
    await this.assertCustomer(db, t.organizationId, dto.customerId);
    const h = await db.heldBill.create({
      data: {
        organizationId: t.organizationId,
        branchId,
        customerId: dto.customerId,
        label: dto.label,
        payload: dto.payload as Prisma.InputJsonValue,
        createdById: t.userId,
      },
    });
    return view(h);
  }

  async list(t: TenantContext, q: HeldBillsQuery) {
    const branchId = branchOf(t);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.HeldBillWhereInput = {
      organizationId: t.organizationId,
      branchId,
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.heldBill.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.heldBill.count({ where }),
    ]);
    return new Paginated(rows.map(view), { page, pageSize, total });
  }

  async get(t: TenantContext, id: string) {
    return view(await this.find(t, id));
  }

  async update(t: TenantContext, id: string, dto: HeldBillDto) {
    await this.find(t, id);
    this.assertPayload(dto.payload);
    await this.assertCustomer(this.prisma, t.organizationId, dto.customerId);
    const h = await this.prisma.heldBill.update({
      where: { id },
      data: {
        label: dto.label ?? null,
        customerId: dto.customerId ?? null,
        payload: dto.payload as Prisma.InputJsonValue,
      },
    });
    return view(h);
  }

  async remove(t: TenantContext, id: string): Promise<void> {
    await this.find(t, id);
    await this.prisma.heldBill.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async find(t: TenantContext, id: string) {
    const h = await this.prisma.heldBill.findFirst({
      where: { id, organizationId: t.organizationId, branchId: branchOf(t), deletedAt: null },
    });
    if (!h) throw new AppException('HELD_BILL_NOT_FOUND', 'Held bill not found', 404);
    return h;
  }

  private assertPayload(payload: Record<string, unknown>) {
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new AppException(
        'HELD_BILL_TOO_LARGE',
        'This held bill is too large (64 KB at most)',
        400,
      );
    }
  }

  private async assertCustomer(db: Db, organizationId: string, customerId?: string) {
    if (!customerId) return;
    const c = await db.customer.findFirst({
      where: { id: customerId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new AppException('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
  }
}

function view(h: Prisma.HeldBillGetPayload<object>) {
  return {
    id: h.id,
    label: h.label,
    customerId: h.customerId,
    payload: h.payload,
    createdById: h.createdById,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}
