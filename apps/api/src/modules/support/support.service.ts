import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/auth/auth.types';
import { RolePermissionService } from '../../common/auth/role-permission.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import type { CallbackDto, CreateTicketDto, TicketListQuery } from './support.dto';

/** At most this many tickets per shop per hour (abuse guard, ADMIN_PANEL.md Phase D). */
export const TICKETS_PER_HOUR = 10;

export const ticketLabel = (n: number) => `T-${String(n).padStart(6, '0')}`;

const TICKET_VIEW = {
  id: true,
  ticketNumber: true,
  category: true,
  priority: true,
  status: true,
  subject: true,
  callbackPhone: true,
  callbackWindow: true,
  lastMessageAt: true,
  resolvedAt: true,
  createdAt: true,
  createdByUserId: true,
} as const;

/**
 * Shop side of support. Always scoped to the caller's organization, which comes from the token, never
 * the body. Internal notes written by platform staff are never returned here. Every route also works
 * while the shop is LOCKED or EXPIRED (so a blocked shop can still ask for help).
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: RolePermissionService,
  ) {}

  /** Phone/WhatsApp/hours from the admin panel, plus a ready WhatsApp link with the shop name. */
  async contact(t: TenantContext) {
    const [settings, org] = await Promise.all([
      this.prisma.supportSettings.findUnique({ where: { id: 1 } }),
      this.prisma.organization.findUnique({
        where: { id: t.organizationId },
        select: { name: true },
      }),
    ]);
    const digits = settings?.whatsapp?.replace(/\D/g, '') ?? '';
    const text = `Hello, I need help with my shop "${org?.name ?? ''}".`;
    return {
      phone: settings?.phone ?? null,
      whatsapp: settings?.whatsapp ?? null,
      hours: settings?.hoursText ?? null,
      whatsappUrl: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null,
    };
  }

  /** Owner and `support.read` see every ticket of the shop; others only the ones they raised. */
  private async seesAll(t: TenantContext): Promise<boolean> {
    const perms = await this.roles.get(t.roleId);
    return perms.isOwner || perms.keys.has('support.read');
  }

  private async senderType(t: TenantContext): Promise<'VENDOR' | 'STAFF'> {
    return (await this.roles.get(t.roleId)).isOwner ? 'VENDOR' : 'STAFF';
  }

  private async assertRate(organizationId: string) {
    const recent = await this.prisma.supportTicket.count({
      where: { organizationId, createdAt: { gt: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= TICKETS_PER_HOUR) {
      throw new AppException(
        'TICKET_RATE_LIMITED',
        'Too many tickets in the last hour. Please call or WhatsApp us instead.',
        429,
      );
    }
  }

  async create(t: TenantContext, dto: CreateTicketDto) {
    await this.assertRate(t.organizationId);
    const senderType = await this.senderType(t);
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          organizationId: t.organizationId,
          createdByUserId: t.userId,
          category: dto.category,
          priority: dto.category === 'BILLING' ? 'HIGH' : 'NORMAL',
          subject: dto.subject.trim(),
          appVersion: dto.appVersion,
          deviceInfo: dto.deviceInfo,
          lastCorrelationId: dto.lastCorrelationId,
        },
        select: TICKET_VIEW,
      });
      await tx.ticketMessage.create({
        data: { ticketId: ticket.id, senderType, senderUserId: t.userId, body: dto.message },
        select: { id: true },
      });
      return { ...ticket, label: ticketLabel(ticket.ticketNumber) };
    });
  }

  /** "Call me back": a CALLBACK ticket, highlighted in the support queue. */
  async callback(t: TenantContext, dto: CallbackDto) {
    await this.assertRate(t.organizationId);
    const senderType = await this.senderType(t);
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          organizationId: t.organizationId,
          createdByUserId: t.userId,
          category: 'CALLBACK',
          priority: 'HIGH',
          subject: `Callback request: ${dto.window}`,
          callbackPhone: dto.phone,
          callbackWindow: dto.window,
        },
        select: TICKET_VIEW,
      });
      await tx.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderType,
          senderUserId: t.userId,
          body: dto.message?.trim() || `Please call ${dto.phone} (${dto.window}).`,
        },
        select: { id: true },
      });
      return { ...ticket, label: ticketLabel(ticket.ticketNumber) };
    });
  }

  async list(t: TenantContext, q: TicketListQuery) {
    const all = await this.seesAll(t);
    const rows = await this.prisma.supportTicket.findMany({
      where: {
        organizationId: t.organizationId,
        ...(all ? {} : { createdByUserId: t.userId }),
        status: q.status,
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: q.limit ?? 50,
      select: TICKET_VIEW,
    });
    return rows.map((r) => ({ ...r, label: ticketLabel(r.ticketNumber) }));
  }

  private async findOwn(t: TenantContext, id: string) {
    const all = await this.seesAll(t);
    const ticket = await this.prisma.supportTicket.findFirst({
      where: {
        id,
        organizationId: t.organizationId,
        ...(all ? {} : { createdByUserId: t.userId }),
      },
      select: TICKET_VIEW,
    });
    if (!ticket) throw new AppException('NOT_FOUND', 'Ticket not found', 404);
    return ticket;
  }

  async get(t: TenantContext, id: string) {
    const ticket = await this.findOwn(t, id);
    const messages = await this.prisma.ticketMessage.findMany({
      where: { ticketId: id, internalNote: false }, // internal notes never leave the platform
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, senderType: true, body: true, createdAt: true },
    });
    return { ...ticket, label: ticketLabel(ticket.ticketNumber), messages };
  }

  /**
   * A reply from the shop. A RESOLVED ticket reopens (IN_PROGRESS); a CLOSED one is refused, open a new
   * ticket instead (ADMIN_PANEL_PLAN.md section 2 item 6).
   */
  async reply(t: TenantContext, id: string, body: string) {
    const ticket = await this.findOwn(t, id);
    if (ticket.status === 'CLOSED') {
      throw new AppException(
        'TICKET_CLOSED',
        'This ticket is closed. Please raise a new one.',
        409,
      );
    }
    const senderType = await this.senderType(t);
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.ticketMessage.create({
        data: { ticketId: id, senderType, senderUserId: t.userId, body },
        select: { id: true, senderType: true, body: true, createdAt: true },
      });
      await tx.supportTicket.update({
        where: { id },
        data: { status: 'IN_PROGRESS', lastMessageAt: message.createdAt, resolvedAt: null },
        select: { id: true },
      });
      return message;
    });
  }
}
