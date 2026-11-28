import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { shopSubscription } from '../../common/subscription/shop-subscription';
import { addDays } from '../../common/subscription/subscription-state';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';

export const TRIAL_PLAN_CODE = 'TRIAL';
export const DEFAULT_GRACE_DAYS = 5;

export type PlanLimit = 'branches' | 'users';

/**
 * The shop side of subscriptions (ADMIN_PANEL.md Phase B): start the trial, show a shop its own state,
 * and enforce plan limits. Only ever touches the caller's own organization. Changing a subscription
 * (extend, lock, plan change) belongs to the platform plane.
 */
@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Starts the free trial for a new shop, inside the registration transaction. */
  async startTrial(db: Db, organizationId: string): Promise<void> {
    const plan = await db.plan.findUnique({
      where: { code: TRIAL_PLAN_CODE },
      select: { id: true, trialDays: true },
    });
    if (!plan) throw new Error('TRIAL plan missing: run the subscriptions migration');
    const startsAt = new Date();
    const endsAt = addDays(startsAt, plan.trialDays ?? 14);
    await db.subscription.create({
      data: {
        organizationId,
        planId: plan.id,
        startsAt,
        endsAt,
        graceDays: DEFAULT_GRACE_DAYS,
      },
      select: { id: true },
    });
    await db.subscriptionEvent.create({
      data: { organizationId, type: 'TRIAL_STARTED', planId: plan.id, newEndsAt: endsAt },
      select: { id: true },
    });
  }

  /** The block `/auth/me` returns to every member (no history, no money). */
  async summary(organizationId: string, db: Db = this.prisma) {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: {
        lockStatus: true,
        lockedAt: true,
        subscription: {
          select: {
            endsAt: true,
            graceDays: true,
            plan: {
              select: { code: true, name: true, isTrial: true, maxBranches: true, maxUsers: true },
            },
          },
        },
      },
    });
    const s = shopSubscription(org ?? undefined);
    const plan = org?.subscription?.plan ?? null;
    return {
      state: s.state,
      planCode: s.planCode,
      planName: plan?.name ?? null,
      endsAt: s.endsAt,
      graceEndsAt: s.graceEndsAt,
      daysLeft: s.daysLeft,
      graceDaysLeft: s.graceDaysLeft,
      limits: { maxBranches: plan?.maxBranches ?? null, maxUsers: plan?.maxUsers ?? null },
      // Clients show banners from this and must not trust the phone clock (ADMIN_PANEL.md §2.6).
      serverTime: new Date(),
    };
  }

  /** The owner's view: summary plus the history of grants, extensions and locks. */
  async detail(organizationId: string) {
    const [summary, events] = await Promise.all([
      this.summary(organizationId),
      this.prisma.subscriptionEvent.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          type: true,
          months: true,
          oldEndsAt: true,
          newEndsAt: true,
          createdAt: true,
          plan: { select: { code: true, name: true } },
        },
      }),
    ]);
    return { ...summary, events };
  }

  /**
   * Refuses to go over the plan's branch or user limit. Locks the subscription row first, so two
   * concurrent creations cannot both slip under the limit. No subscription row (legacy) = no limit.
   * `adding` is how many will exist after the change minus how many exist now (usually 1).
   */
  async assertWithinLimit(tx: Db, organizationId: string, limit: PlanLimit, adding = 1) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM subscriptions WHERE organization_id = ${organizationId}::uuid FOR UPDATE`;
    if (locked.length === 0) return;
    const sub = await tx.subscription.findUniqueOrThrow({
      where: { organizationId },
      select: { plan: { select: { code: true, maxBranches: true, maxUsers: true } } },
    });
    const max = limit === 'branches' ? sub.plan.maxBranches : sub.plan.maxUsers;
    if (max === null) return;
    const current =
      limit === 'branches'
        ? await tx.branch.count({ where: { organizationId, deletedAt: null } })
        : await tx.organizationMember.count({ where: { organizationId, status: 'ACTIVE' } });
    if (current + adding > max) {
      throw new AppException(
        'PLAN_LIMIT_REACHED',
        limit === 'branches'
          ? `Your ${sub.plan.code} plan allows ${max} branch${max === 1 ? '' : 'es'}. Upgrade to add more.`
          : `Your ${sub.plan.code} plan allows ${max} active user${max === 1 ? '' : 's'}. Upgrade to add more.`,
        409,
        { limit, max, current, planCode: sub.plan.code },
      );
    }
  }
}
