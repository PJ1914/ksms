import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../database/prisma.service';
import { CurrentAdmin, PlatformRoles, PlatformRoute } from '../platform.decorators';
import type { PlatformPrincipal } from '../platform.types';

interface Counts {
  total: number;
  trial: number;
  active: number;
  grace: number;
  expired: number;
  locked: number;
  signups_30d: number;
  expiring_7d: number;
}

/**
 * Admin panel home (ADMIN_PANEL.md section 6). Shop counts by derived state come from ONE aggregate
 * query (index: subscriptions.ends_at). Revenue is ADMIN-only; SUPPORT sees counts.
 */
@ApiTags('Platform: dashboard')
@ApiBearerAuth()
@PlatformRoute()
@Controller('admin/v1/dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get()
  @ApiOperation({ summary: 'Shop counts by state, expiring soon, sign-ups; revenue for ADMIN' })
  async get(@CurrentAdmin() a: PlatformPrincipal) {
    const [counts] = await this.prisma.$queryRaw<Counts[]>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE o.lock_status = 'NONE' AND s.ends_at > now() AND p.is_trial)::int AS trial,
        count(*) FILTER (WHERE o.lock_status = 'NONE'
          AND (s.id IS NULL OR (s.ends_at > now() AND NOT p.is_trial)))::int AS active,
        count(*) FILTER (WHERE o.lock_status = 'NONE' AND s.ends_at <= now()
          AND s.ends_at + make_interval(days => s.grace_days) > now())::int AS grace,
        count(*) FILTER (WHERE o.lock_status = 'NONE'
          AND s.ends_at + make_interval(days => s.grace_days) <= now())::int AS expired,
        count(*) FILTER (WHERE o.lock_status = 'LOCKED')::int AS locked,
        count(*) FILTER (WHERE o.created_at > now() - interval '30 days')::int AS signups_30d,
        count(*) FILTER (WHERE o.lock_status = 'NONE'
          AND s.ends_at BETWEEN now() AND now() + interval '7 days')::int AS expiring_7d
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE o.deleted_at IS NULL`;

    const expiringSoon = await this.prisma.$queryRaw<
      { id: string; name: string; ends_at: Date; plan_code: string }[]
    >`
      SELECT o.id, o.name, s.ends_at, p.code AS plan_code
      FROM subscriptions s
      JOIN organizations o ON o.id = s.organization_id AND o.deleted_at IS NULL AND o.lock_status = 'NONE'
      JOIN plans p ON p.id = s.plan_id
      WHERE s.ends_at BETWEEN now() AND now() + interval '7 days'
      ORDER BY s.ends_at
      LIMIT 20`;

    const tickets = await this.prisma.supportTicket.groupBy({
      by: ['priority'],
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      _count: { _all: true },
    });
    const callbacks = await this.prisma.supportTicket.count({
      where: { category: 'CALLBACK', status: { in: ['OPEN', 'IN_PROGRESS'] } },
    });

    const c = counts!;
    const result = {
      shops: {
        total: c.total,
        trial: c.trial,
        active: c.active,
        grace: c.grace,
        expired: c.expired,
        locked: c.locked,
      },
      signups30d: c.signups_30d,
      expiring7d: c.expiring_7d,
      expiringSoon: expiringSoon.map((r) => ({
        id: r.id,
        name: r.name,
        endsAt: r.ends_at,
        planCode: r.plan_code,
      })),
      openTickets: Object.fromEntries(tickets.map((t) => [t.priority, t._count._all])),
      openCallbacks: callbacks,
      revenue: null as null | { month: string; amount: string }[],
      serverTime: new Date(),
    };
    if (a.role === 'ADMIN') {
      // Net of refunds (negative rows), by calendar month in India time, last 6 months.
      const months = await this.prisma.$queryRaw<{ month: string; amount: string }[]>`
        SELECT to_char(date_trunc('month', received_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
               sum(amount)::text AS amount
        FROM subscription_payments
        WHERE received_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '5 months') AT TIME ZONE 'Asia/Kolkata'
        GROUP BY 1
        ORDER BY 1`;
      result.revenue = months;
    }
    return result;
  }
}
