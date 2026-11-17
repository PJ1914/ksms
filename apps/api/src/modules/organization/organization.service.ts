import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { UpdateOrganizationDto } from './organization.dto';

const ORG_SELECT = {
  id: true,
  name: true,
  legalName: true,
  pan: true,
  phone: true,
  email: true,
  gstEnabled: true,
  defaultTaxMode: true,
  currency: true,
  timezone: true,
  allowNegativeStock: true,
  maxCashierDiscountPercent: true,
} satisfies Prisma.OrganizationSelect;

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: ORG_SELECT,
    });
    if (!org) throw new AppException('NOT_FOUND', 'Organization not found', 404);
    return { ...org, maxCashierDiscountPercent: org.maxCashierDiscountPercent.toString() };
  }

  async update(
    organizationId: string,
    actorId: string,
    dto: UpdateOrganizationDto,
    meta: { correlationId?: string; ipAddress?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.organization.findFirst({
        where: { id: organizationId, deletedAt: null },
        select: ORG_SELECT,
      });
      if (!before) throw new AppException('NOT_FOUND', 'Organization not found', 404);
      const after = await tx.organization.update({
        where: { id: organizationId },
        data: dto,
        select: ORG_SELECT,
      });
      const plain = (o: typeof before) => ({
        ...o,
        maxCashierDiscountPercent: o.maxCashierDiscountPercent.toString(),
      });
      await this.audit.record(tx, {
        organizationId,
        actorId,
        action: 'organization.update',
        entityType: 'organization',
        entityId: organizationId,
        before: plain(before),
        after: plain(after),
        ...meta,
      });
      return plain(after);
    });
  }
}
