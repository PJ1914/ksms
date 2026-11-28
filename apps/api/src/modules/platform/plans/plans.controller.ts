import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AppException } from '../../../common/errors/app.exception';
import { afterKeyset, decodeKeyset, keysetPage } from '../../../common/pagination/keyset';
import { CursorPage } from '../../../common/pagination/paginated';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { CurrentAdmin, PlatformRoles, PlatformRoute } from '../platform.decorators';
import { platformMeta, type PlatformPrincipal, type PlatformRequest } from '../platform.types';
import { AMOUNT_PATTERN } from '../subscriptions/pricing';

/** {"3":"5","6":"10"}: months → percent off, each a decimal string between 0 and 100. */
function assertDiscounts(value: unknown): Prisma.InputJsonObject {
  if (value === undefined) return {};
  const ok =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value as Record<string, unknown>).every(
      ([k, v]) =>
        /^\d{1,2}$/.test(k) &&
        Number(k) >= 1 &&
        typeof v === 'string' &&
        /^\d{1,3}(\.\d{1,2})?$/.test(v) &&
        Number(v) <= 100,
    );
  if (!ok) {
    throw new AppException(
      'VALIDATION_ERROR',
      'durationDiscounts must look like {"3":"5","6":"10"} (months → percent, 0-100)',
      400,
    );
  }
  return value as Prisma.InputJsonObject;
}

export class CreatePlanDto {
  @ApiProperty({ example: 'PRO_PLUS' })
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/, { message: 'code: 2-30 chars, A-Z, 0-9, _' })
  code!: string;
  @ApiProperty() @IsString() @Length(2, 60) name!: string;
  @ApiProperty({ example: '599.00' }) @Matches(AMOUNT_PATTERN) monthlyPrice!: string;
  @ApiPropertyOptional({ example: { '3': '5', '6': '10', '9': '12', '12': '15' } })
  @IsOptional()
  @IsObject()
  durationDiscounts?: Record<string, string>;
  @ApiPropertyOptional({ description: 'null = unlimited' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxBranches?: number | null;
  @ApiPropertyOptional({ description: 'null = unlimited' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxUsers?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsObject() features?: Record<string, unknown>;
}

export class UpdatePlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(AMOUNT_PATTERN) monthlyPrice?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() durationDiscounts?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) maxBranches?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10000) maxUsers?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsObject() features?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 365, description: 'Trial plan only' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  trialDays?: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

const PLAN_VIEW = {
  id: true,
  code: true,
  name: true,
  monthlyPrice: true,
  durationDiscounts: true,
  maxBranches: true,
  maxUsers: true,
  features: true,
  isTrial: true,
  trialDays: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@ApiTags('Platform: plans')
@ApiBearerAuth()
@PlatformRoute()
@Controller('admin/v1/plans')
export class PlansController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get()
  @ApiOperation({ summary: 'All plans with prices, limits and discounts' })
  async list() {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ isTrial: 'desc' }, { monthlyPrice: 'asc' }],
      select: { ...PLAN_VIEW, _count: { select: { subscriptions: true } } },
    });
    return plans.map(({ _count, ...p }) => ({ ...p, shops: _count.subscriptions }));
  }

  @PlatformRoles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create a paid plan' })
  async create(
    @CurrentAdmin() a: PlatformPrincipal,
    @Body() dto: CreatePlanDto,
    @Req() req: PlatformRequest,
  ) {
    const durationDiscounts = assertDiscounts(dto.durationDiscounts);
    return this.prisma.$transaction(async (tx) => {
      const clash = await tx.plan.findUnique({ where: { code: dto.code }, select: { id: true } });
      if (clash) throw new AppException('CONFLICT', 'A plan with this code exists', 409);
      const plan = await tx.plan.create({
        data: {
          code: dto.code,
          name: dto.name,
          monthlyPrice: dto.monthlyPrice,
          durationDiscounts,
          maxBranches: dto.maxBranches ?? null,
          maxUsers: dto.maxUsers ?? null,
          features: (dto.features ?? {}) as Prisma.InputJsonObject,
        },
        select: PLAN_VIEW,
      });
      await this.audit.record(tx, {
        adminId: a.adminId,
        action: 'plan.create',
        entityType: 'plan',
        entityId: plan.id,
        after: { code: plan.code, monthlyPrice: dto.monthlyPrice },
        meta: platformMeta(req),
      });
      return plan;
    });
  }

  @PlatformRoles('ADMIN')
  @Patch(':id')
  @ApiOperation({
    summary: 'Edit price, limits, discounts, or switch a plan off (reason required)',
  })
  async update(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @Req() req: PlatformRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.plan.findUnique({ where: { id }, select: PLAN_VIEW });
      if (!before) throw new AppException('NOT_FOUND', 'Plan not found', 404);
      if (dto.trialDays !== undefined && !before.isTrial) {
        throw new AppException('VALIDATION_ERROR', 'trialDays only applies to the trial plan', 400);
      }
      const after = await tx.plan.update({
        where: { id },
        data: {
          name: dto.name,
          monthlyPrice: dto.monthlyPrice,
          durationDiscounts:
            dto.durationDiscounts === undefined
              ? undefined
              : assertDiscounts(dto.durationDiscounts),
          maxBranches: dto.maxBranches,
          maxUsers: dto.maxUsers,
          features: dto.features as Prisma.InputJsonObject | undefined,
          isActive: dto.isActive,
          trialDays: dto.trialDays,
        },
        select: PLAN_VIEW,
      });
      await this.audit.record(tx, {
        adminId: a.adminId,
        action: 'plan.update',
        entityType: 'plan',
        entityId: id,
        before: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonObject,
        after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonObject,
        reason: dto.reason,
        meta: platformMeta(req),
      });
      return after;
    });
  }
}

export class PaymentsQuery {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() orgId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

@ApiTags('Platform: payments')
@ApiBearerAuth()
@PlatformRoute()
@PlatformRoles('ADMIN')
@Controller('admin/v1/payments')
export class PaymentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Subscription payments and refunds, newest first (ADMIN only)' })
  async list(@Query() q: PaymentsQuery) {
    const limit = q.limit ?? 50;
    const where: Prisma.SubscriptionPaymentWhereInput = {
      organizationId: q.orgId,
      receivedAt: {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lt: new Date(q.to) } : {}),
      },
      ...(q.cursor ? afterKeyset('receivedAt', 'desc', 'desc', decodeKeyset(q.cursor)) : {}),
    };
    const rows = await this.prisma.subscriptionPayment.findMany({
      where,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        organizationId: true,
        amount: true,
        method: true,
        reference: true,
        months: true,
        receivedAt: true,
        reversesPaymentId: true,
        recordedBy: { select: { email: true } },
        createdAt: true,
      },
    });
    const orgIds = [...new Set(rows.map((r) => r.organizationId))];
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
    });
    const names = new Map(orgs.map((o) => [o.id, o.name]));
    const page = keysetPage(
      rows.map((r) => ({ ...r, shopName: names.get(r.organizationId) ?? null })),
      limit,
      (r) => r.receivedAt,
    );
    return new CursorPage(page.rows, page.meta);
  }
}
