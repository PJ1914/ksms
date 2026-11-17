import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { financialYear } from '../../common/utils/financial-year';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface BranchInput {
  code: string;
  name: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  stateCode?: string;
  gstin?: string;
  phone?: string;
}

const BRANCH_SELECT = {
  id: true,
  code: true,
  name: true,
  addressLine: true,
  city: true,
  state: true,
  pincode: true,
  stateCode: true,
  gstin: true,
  phone: true,
  isActive: true,
} satisfies Prisma.BranchSelect;

/** Number series created for every branch (invoice, receipt, ...). Next financial years are created on demand. */
const DOCUMENT_SERIES = [
  { documentType: 'INVOICE', series: 'INV' },
  { documentType: 'RECEIPT', series: 'RCP' },
  { documentType: 'PURCHASE', series: 'PUR' },
  { documentType: 'SALE_RETURN', series: 'SRT' },
  { documentType: 'PURCHASE_RETURN', series: 'PRT' },
] as const;

@Injectable()
export class BranchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a branch with its default cash register and document number series.
   * Every ACTIVE member holding the system Owner role is assigned to it automatically.
   * Runs inside the caller's transaction.
   */
  async createInTx(db: Db, organizationId: string, input: BranchInput) {
    const branch = await db.branch.create({
      data: { organizationId, ...input },
      select: BRANCH_SELECT,
    });
    await db.cashRegister.create({
      data: { organizationId, branchId: branch.id, name: 'Main Register' },
    });
    const fy = financialYear(new Date());
    await db.documentSequence.createMany({
      data: DOCUMENT_SERIES.map((s) => ({
        organizationId,
        branchId: branch.id,
        documentType: s.documentType,
        series: s.series,
        financialYear: fy,
      })),
    });
    const owners = await db.organizationMember.findMany({
      where: { organizationId, status: 'ACTIVE', role: { isSystem: true, name: 'Owner' } },
      select: { id: true },
    });
    if (owners.length > 0) {
      await db.branchMembership.createMany({
        data: owners.map((o) => ({ organizationId, memberId: o.id, branchId: branch.id })),
        skipDuplicates: true,
      });
    }
    return branch;
  }

  async create(
    organizationId: string,
    actorId: string,
    input: BranchInput,
    meta: { correlationId?: string; ipAddress?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const branch = await this.createInTx(tx, organizationId, input);
      await this.audit.record(tx, {
        organizationId,
        branchId: branch.id,
        actorId,
        action: 'branch.create',
        entityType: 'branch',
        entityId: branch.id,
        after: branch,
        ...meta,
      });
      return branch;
    });
  }

  /** Branches the member may see: everything for branch managers, otherwise only assigned ones. */
  async list(organizationId: string, memberId: string, seeAll: boolean) {
    return this.prisma.branch.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(seeAll ? {} : { memberships: { some: { memberId } } }),
      },
      select: BRANCH_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    input: Partial<Omit<BranchInput, 'code'>> & { isActive?: boolean },
    meta: { correlationId?: string; ipAddress?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.branch.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: BRANCH_SELECT,
      });
      if (!before) throw new AppException('NOT_FOUND', 'Branch not found', 404);
      const after = await tx.branch.update({ where: { id }, data: input, select: BRANCH_SELECT });
      await this.audit.record(tx, {
        organizationId,
        branchId: id,
        actorId,
        action: 'branch.update',
        entityType: 'branch',
        entityId: id,
        before,
        after,
        ...meta,
      });
      return after;
    });
  }

  /** Returns the ids that belong to the organization and are usable; used to validate branch assignments. */
  async assertAssignable(db: Db, organizationId: string, branchIds: string[]): Promise<void> {
    const unique = [...new Set(branchIds)];
    const found = await db.branch.count({
      where: { id: { in: unique }, organizationId, deletedAt: null, isActive: true },
    });
    if (found !== unique.length) {
      throw new AppException(
        'BRANCH_NOT_FOUND',
        'One or more branches do not exist in this organization',
        404,
      );
    }
  }
}
