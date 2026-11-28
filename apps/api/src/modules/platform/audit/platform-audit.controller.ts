import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { afterKeyset, decodeKeyset, keysetPage } from '../../../common/pagination/keyset';
import { CursorPage } from '../../../common/pagination/paginated';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { CurrentAdmin, PlatformRoles, PlatformRoute } from '../platform.decorators';
import type { PlatformPrincipal } from '../platform.types';

export class PlatformAuditQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() adminId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ example: 'admin.create' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

@ApiTags('Platform: audit')
@ApiBearerAuth()
@PlatformRoute()
@Controller('admin/v1/audit')
export class PlatformAuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** ADMIN sees every entry; SUPPORT only their own (ADMIN_PANEL.md §1.1), whatever filter they send. */
  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get()
  @ApiOperation({ summary: 'Platform audit log, newest first (keyset paging via meta.nextCursor)' })
  async list(@CurrentAdmin() a: PlatformPrincipal, @Query() q: PlatformAuditQuery) {
    const limit = q.limit ?? 50;
    const where: Prisma.PlatformAuditLogWhereInput = {
      adminId: a.role === 'ADMIN' ? q.adminId : a.adminId,
      organizationId: q.organizationId,
      action: q.action,
      ...(q.cursor ? afterKeyset('createdAt', 'desc', 'desc', decodeKeyset(q.cursor)) : {}),
    };
    const rows = await this.prisma.platformAuditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        adminId: true,
        admin: { select: { email: true, fullName: true } },
        action: true,
        organizationId: true,
        entityType: true,
        entityId: true,
        beforeData: true,
        afterData: true,
        reason: true,
        ipAddress: true,
        correlationId: true,
        createdAt: true,
      },
    });
    const page = keysetPage(rows, limit, (r) => r.createdAt);
    return new CursorPage(page.rows, page.meta);
  }
}
