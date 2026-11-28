import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { AppException } from '../../../common/errors/app.exception';
import { afterKeyset, decodeKeyset, keysetPage } from '../../../common/pagination/keyset';
import { CursorPage } from '../../../common/pagination/paginated';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { CurrentAdmin, PlatformRoles, PlatformRoute } from '../platform.decorators';
import { platformMeta, type PlatformPrincipal, type PlatformRequest } from '../platform.types';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const CATEGORIES = ['BILLING', 'BUG', 'HOW_TO', 'CALLBACK', 'OTHER'] as const;
/** RESOLVED tickets with no reply for this long become CLOSED (see autoClose). */
export const AUTO_CLOSE_DAYS = 7;

const label = (n: number) => `T-${String(n).padStart(6, '0')}`;

export class PlatformTicketsQuery {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
  @ApiPropertyOptional({ enum: PRIORITIES })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: (typeof PRIORITIES)[number];
  @ApiPropertyOptional({ enum: CATEGORIES })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: (typeof CATEGORIES)[number];
  @ApiPropertyOptional({ description: "'me', 'unassigned' or an admin id" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  assignee?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() orgId?: string;
  @ApiPropertyOptional({ description: 'Subject text or ticket number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class PlatformReplyDto {
  @ApiProperty() @IsString() @Length(1, 5000) body!: string;
  @ApiPropertyOptional({ description: 'Visible to ADMIN/SUPPORT only, never to the shop' })
  @IsOptional()
  @IsBoolean()
  internalNote?: boolean;
}

export class AssignDto {
  @ApiProperty({ nullable: true, description: 'Admin id, or null to unassign' })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  adminId!: string | null;
}

export class TicketStatusDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
  @ApiPropertyOptional({ enum: PRIORITIES })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: (typeof PRIORITIES)[number];
}

export class SupportSettingsDto {
  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Matches(/^\+?\d{10,15}$/, { message: 'phone: 10-15 digits, optional leading +' })
  phone?: string;
  @ApiPropertyOptional({ example: '919876543210' })
  @IsOptional()
  @Matches(/^\+?\d{10,15}$/, { message: 'whatsapp: 10-15 digits with country code' })
  whatsapp?: string;
  @ApiPropertyOptional({ example: 'Mon-Sat 9 am - 7 pm' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  hours?: string;
}

@ApiTags('Platform: support')
@ApiBearerAuth()
@PlatformRoute()
@Controller('admin/v1')
export class PlatformSupportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get('tickets')
  @ApiOperation({ summary: 'Ticket queue (filters; newest activity first; keyset paging)' })
  async list(@CurrentAdmin() a: PlatformPrincipal, @Query() q: PlatformTicketsQuery) {
    const limit = q.limit ?? 50;
    const text = q.q?.trim();
    const num = text && /^(t-)?\d+$/i.test(text) ? Number(text.replace(/\D/g, '')) : null;
    const where: Prisma.SupportTicketWhereInput = {
      status: q.status,
      priority: q.priority,
      category: q.category,
      organizationId: q.orgId,
      ...(q.assignee === 'me'
        ? { assignedAdminId: a.adminId }
        : q.assignee === 'unassigned'
          ? { assignedAdminId: null }
          : q.assignee
            ? { assignedAdminId: q.assignee }
            : {}),
      ...(text
        ? num !== null
          ? { ticketNumber: num }
          : { subject: { contains: text, mode: 'insensitive' as const } }
        : {}),
      ...(q.cursor ? afterKeyset('lastMessageAt', 'desc', 'desc', decodeKeyset(q.cursor)) : {}),
    };
    const rows = await this.prisma.supportTicket.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        ticketNumber: true,
        organizationId: true,
        category: true,
        priority: true,
        status: true,
        subject: true,
        assignedAdminId: true,
        callbackPhone: true,
        callbackWindow: true,
        firstResponseAt: true,
        lastMessageAt: true,
        createdAt: true,
      },
    });
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.organizationId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(orgs.map((o) => [o.id, o.name]));
    const page = keysetPage(
      rows.map((r) => ({
        ...r,
        label: label(r.ticketNumber),
        shopName: names.get(r.organizationId) ?? null,
      })),
      limit,
      (r) => r.lastMessageAt,
    );
    return new CursorPage(page.rows, page.meta);
  }

  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get('tickets/:id')
  @ApiOperation({ summary: 'A ticket with its full conversation, internal notes included' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!ticket) throw new AppException('NOT_FOUND', 'Ticket not found', 404);
    const [org, creator] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: ticket.organizationId },
        select: { id: true, name: true, phone: true, lockStatus: true },
      }),
      this.prisma.user.findUnique({
        where: { id: ticket.createdByUserId },
        select: { id: true, fullName: true, phone: true },
      }),
    ]);
    return { ...ticket, label: label(ticket.ticketNumber), shop: org, createdBy: creator };
  }

  /**
   * Reply (or internal note). A real reply moves the ticket to WAITING_CUSTOMER, stamps the first
   * response time, and drops an in-app notification for the person who raised it.
   */
  @PlatformRoles('ADMIN', 'SUPPORT')
  @Post('tickets/:id/messages')
  @ApiOperation({ summary: 'Reply to the shop, or add an internal note' })
  async reply(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlatformReplyDto,
    @Req() req: PlatformRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.findUnique({
        where: { id },
        select: {
          id: true,
          ticketNumber: true,
          organizationId: true,
          createdByUserId: true,
          status: true,
          firstResponseAt: true,
          subject: true,
        },
      });
      if (!ticket) throw new AppException('NOT_FOUND', 'Ticket not found', 404);
      if (ticket.status === 'CLOSED' && !dto.internalNote) {
        throw new AppException('TICKET_CLOSED', 'This ticket is closed', 409);
      }
      const internal = dto.internalNote === true;
      const message = await tx.ticketMessage.create({
        data: {
          ticketId: id,
          senderType: a.role,
          senderAdminId: a.adminId,
          body: dto.body,
          internalNote: internal,
        },
      });
      if (!internal) {
        await tx.supportTicket.update({
          where: { id },
          data: {
            status: 'WAITING_CUSTOMER',
            lastMessageAt: message.createdAt,
            firstResponseAt: ticket.firstResponseAt ?? message.createdAt,
            assignedAdminId: undefined,
          },
          select: { id: true },
        });
        await tx.notification.create({
          data: {
            organizationId: ticket.organizationId,
            userId: ticket.createdByUserId,
            type: 'GENERAL',
            title: `Support replied: ${label(ticket.ticketNumber)}`,
            body: dto.body.slice(0, 200),
            data: { kind: 'support_reply', ticketId: id },
          },
          select: { id: true },
        });
      }
      await this.audit.record(tx, {
        adminId: a.adminId,
        action: internal ? 'ticket.note' : 'ticket.reply',
        organizationId: ticket.organizationId,
        entityType: 'support_ticket',
        entityId: id,
        meta: platformMeta(req),
      });
      return message;
    });
  }

  @PlatformRoles('ADMIN', 'SUPPORT')
  @HttpCode(200)
  @Post('tickets/:id/assign')
  @ApiOperation({ summary: 'Assign to an admin/support user, or unassign with null' })
  async assign(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDto,
    @Req() req: PlatformRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.adminId) {
        const target = await tx.platformAdmin.findFirst({
          where: { id: dto.adminId, isActive: true },
          select: { id: true },
        });
        if (!target) throw new AppException('NOT_FOUND', 'Admin not found', 404);
      }
      const ticket = await tx.supportTicket.update({
        where: { id },
        data: { assignedAdminId: dto.adminId },
        select: { id: true, organizationId: true, assignedAdminId: true },
      });
      await this.audit.record(tx, {
        adminId: a.adminId,
        action: 'ticket.assign',
        organizationId: ticket.organizationId,
        entityType: 'support_ticket',
        entityId: id,
        after: { assignedAdminId: dto.adminId },
        meta: platformMeta(req),
      });
      return ticket;
    });
  }

  @PlatformRoles('ADMIN', 'SUPPORT')
  @HttpCode(200)
  @Post('tickets/:id/status')
  @ApiOperation({ summary: 'Change status and/or priority' })
  async status(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TicketStatusDto,
    @Req() req: PlatformRequest,
  ) {
    if (!dto.status && !dto.priority)
      throw new AppException('VALIDATION_ERROR', 'Nothing to change', 400);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.supportTicket.findUnique({
        where: { id },
        select: { status: true, priority: true, organizationId: true },
      });
      if (!before) throw new AppException('NOT_FOUND', 'Ticket not found', 404);
      const resolving = dto.status === 'RESOLVED' || dto.status === 'CLOSED';
      const after = await tx.supportTicket.update({
        where: { id },
        data: {
          status: dto.status,
          priority: dto.priority,
          ...(dto.status ? { resolvedAt: resolving ? new Date() : null } : {}),
        },
        select: { id: true, status: true, priority: true, resolvedAt: true },
      });
      await this.audit.record(tx, {
        adminId: a.adminId,
        action: 'ticket.status',
        organizationId: before.organizationId,
        entityType: 'support_ticket',
        entityId: id,
        before: { status: before.status, priority: before.priority },
        after: { status: after.status, priority: after.priority },
        meta: platformMeta(req),
      });
      return after;
    });
  }

  /** RESOLVED tickets silent for 7 days → CLOSED. Idempotent; also callable from a scheduled job. */
  @PlatformRoles('ADMIN')
  @HttpCode(200)
  @Post('tickets/auto-close')
  @ApiOperation({
    summary: 'Close tickets resolved more than 7 days ago with no reply (idempotent)',
  })
  async autoClose() {
    const res = await this.prisma.supportTicket.updateMany({
      where: {
        status: 'RESOLVED',
        resolvedAt: { lt: new Date(Date.now() - AUTO_CLOSE_DAYS * 86_400_000) },
      },
      data: { status: 'CLOSED' },
    });
    return { closed: res.count };
  }

  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get('support-settings')
  @ApiOperation({ summary: 'Support phone, WhatsApp and hours shown in the shop app' })
  settings() {
    return this.prisma.supportSettings.findUnique({ where: { id: 1 } });
  }

  @PlatformRoles('ADMIN')
  @Patch('support-settings')
  @ApiOperation({
    summary: 'Change what the app Call / WhatsApp buttons open (no app release needed)',
  })
  async updateSettings(
    @CurrentAdmin() a: PlatformPrincipal,
    @Body() dto: SupportSettingsDto,
    @Req() req: PlatformRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.supportSettings.findUnique({ where: { id: 1 } });
      const after = await tx.supportSettings.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          phone: dto.phone,
          whatsapp: dto.whatsapp,
          hoursText: dto.hours,
          updatedBy: a.adminId,
          updatedAt: new Date(),
        },
        update: {
          phone: dto.phone,
          whatsapp: dto.whatsapp,
          hoursText: dto.hours,
          updatedBy: a.adminId,
          updatedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        adminId: a.adminId,
        action: 'support_settings.update',
        entityType: 'support_settings',
        entityId: '1',
        before: {
          phone: before?.phone ?? null,
          whatsapp: before?.whatsapp ?? null,
          hours: before?.hoursText ?? null,
        },
        after: { phone: after.phone, whatsapp: after.whatsapp, hours: after.hoursText },
        meta: platformMeta(req),
      });
      return after;
    });
  }
}
