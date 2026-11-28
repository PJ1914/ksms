import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { SessionCache } from '../../../common/auth/session-cache';
import { AppException } from '../../../common/errors/app.exception';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { shopSubscription } from '../../../common/subscription/shop-subscription';
import { addMonths } from '../../../common/subscription/subscription-state';
import type { Db } from '../../../database/db.types';
import { PrismaService } from '../../../database/prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import type { PlatformPrincipal, PlatformRequestMeta } from '../platform.types';
import { ShopsService } from '../shops/shops.service';
import type {
  AdjustSubscriptionDto,
  ChangePlanDto,
  ExtendSubscriptionDto,
  RefundDto,
} from './platform-subscriptions.dto';
import { quote } from './pricing';

const DEFAULT_GRACE_DAYS = 5;

interface LockedSub {
  id: string;
  plan_id: string;
  starts_at: Date;
  ends_at: Date;
  grace_days: number;
  version: number;
}

const PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  monthlyPrice: true,
  durationDiscounts: true,
  isTrial: true,
  isActive: true,
} as const;

/**
 * Changing a shop's subscription (ADMIN only, ADMIN_PANEL.md section 2.2). Every change runs in ONE
 * transaction that row-locks the subscription (FOR UPDATE) and bumps `version`, so concurrent changes
 * queue instead of losing an update; it writes an append-only event and an audit row with the reason.
 * Recording a payment needs an Idempotency-Key: a double click extends once.
 */
@Injectable()
export class PlatformSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly idempotency: IdempotencyService,
    private readonly shops: ShopsService,
    private readonly cache: SessionCache,
  ) {}

  async get(orgId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: {
        id: true,
        name: true,
        lockStatus: true,
        lockedAt: true,
        subscription: {
          select: {
            startsAt: true,
            endsAt: true,
            graceDays: true,
            version: true,
            plan: {
              select: { id: true, code: true, name: true, isTrial: true, monthlyPrice: true },
            },
          },
        },
      },
    });
    if (!org) throw new AppException('NOT_FOUND', 'Shop not found', 404);
    const events = await this.prisma.subscriptionEvent.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        type: true,
        months: true,
        oldEndsAt: true,
        newEndsAt: true,
        paymentId: true,
        reason: true,
        createdAt: true,
        plan: { select: { code: true } },
        admin: { select: { email: true } },
      },
    });
    return {
      organizationId: org.id,
      name: org.name,
      status: shopSubscription(org),
      subscription: org.subscription,
      events,
    };
  }

  /** What N months would cost on the shop's plan (or another plan). */
  async quote(orgId: string, months: number, planId?: string) {
    const plan = await this.resolvePlan(this.prisma, orgId, planId);
    return {
      plan: { id: plan.id, code: plan.code, name: plan.name },
      ...quote(plan.monthlyPrice, months, plan.durationDiscounts),
    };
  }

  private async resolvePlan(db: Db, orgId: string, planId?: string) {
    const plan = planId
      ? await db.plan.findUnique({ where: { id: planId }, select: PLAN_SELECT })
      : (
          await db.subscription.findUnique({
            where: { organizationId: orgId },
            select: { plan: { select: PLAN_SELECT } },
          })
        )?.plan;
    if (!plan) throw new AppException('PLAN_REQUIRED', 'Choose a plan for this shop', 400);
    if (planId && !plan.isActive) {
      throw new AppException('PLAN_INACTIVE', 'That plan is switched off', 400);
    }
    return plan;
  }

  private async lockSubscription(tx: Db, orgId: string): Promise<LockedSub | null> {
    const exists = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM organizations WHERE id = ${orgId}::uuid AND deleted_at IS NULL`;
    if (exists.length === 0) throw new AppException('NOT_FOUND', 'Shop not found', 404);
    const rows = await tx.$queryRaw<LockedSub[]>`
      SELECT id, plan_id, starts_at, ends_at, grace_days, version
      FROM subscriptions WHERE organization_id = ${orgId}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  private async saveSubscription(
    tx: Db,
    orgId: string,
    current: LockedSub | null,
    data: { planId: string; startsAt: Date; endsAt: Date; graceDays: number },
  ) {
    if (!current) {
      await tx.subscription.create({
        data: { organizationId: orgId, ...data },
        select: { id: true },
      });
      return;
    }
    const res = await tx.subscription.updateMany({
      where: { id: current.id, version: current.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) {
      throw new AppException(
        'CONFLICT',
        'The subscription changed at the same time; try again',
        409,
      );
    }
  }

  /**
   * Records a manual payment and extends: new end = max(now, current end) + N calendar months
   * (end-of-month safe). Optional plan switch and unlock in the same transaction.
   */
  async extend(
    actor: PlatformPrincipal,
    orgId: string,
    rawKey: unknown,
    dto: ExtendSubscriptionDto,
    meta: PlatformRequestMeta,
  ) {
    const key = this.idempotency.requireKey(rawKey);
    const { result, replayed } = await this.idempotency.execute(
      orgId,
      key,
      `platform:subscription.extend:${actor.adminId}`,
      dto,
      async (tx) => {
        const current = await this.lockSubscription(tx, orgId);
        const plan = await this.resolvePlan(tx, orgId, dto.planId);
        if (plan.isTrial) {
          throw new AppException('PLAN_IS_TRIAL', 'Pick a paid plan to record a payment', 400);
        }
        const priced = quote(plan.monthlyPrice, dto.months, plan.durationDiscounts);
        const amount = new Decimal(dto.payment.amount ?? priced.amount);
        if (amount.lte(0)) {
          throw new AppException('VALIDATION_ERROR', 'Amount must be more than 0', 400);
        }
        if (dto.payment.reference) {
          const dup = await tx.subscriptionPayment.findFirst({
            where: {
              organizationId: orgId,
              method: dto.payment.method,
              reference: dto.payment.reference,
              reversesPaymentId: null,
            },
            select: { id: true },
          });
          if (dup) {
            throw new AppException(
              'DUPLICATE_PAYMENT_REFERENCE',
              'A payment with this reference is already recorded for this shop',
              409,
              { paymentId: dup.id },
            );
          }
        }

        const now = new Date();
        const oldEndsAt = current?.ends_at ?? null;
        const base = oldEndsAt && oldEndsAt.getTime() > now.getTime() ? oldEndsAt : now;
        const newEndsAt = addMonths(base, dto.months);

        const payment = await tx.subscriptionPayment.create({
          data: {
            organizationId: orgId,
            amount: amount.toFixed(2),
            method: dto.payment.method,
            reference: dto.payment.reference ?? null,
            months: dto.months,
            receivedAt: dto.payment.receivedAt ? new Date(dto.payment.receivedAt) : now,
            recordedById: actor.adminId,
          },
          select: { id: true, method: true, reference: true, months: true, receivedAt: true },
        });
        await this.saveSubscription(tx, orgId, current, {
          planId: plan.id,
          startsAt: current?.starts_at ?? now,
          endsAt: newEndsAt,
          graceDays: current?.grace_days ?? DEFAULT_GRACE_DAYS,
        });
        if (current && current.plan_id !== plan.id) {
          await tx.subscriptionEvent.create({
            data: {
              organizationId: orgId,
              type: 'PLAN_CHANGED',
              planId: plan.id,
              reason: dto.reason,
              adminId: actor.adminId,
            },
            select: { id: true },
          });
        }
        await tx.subscriptionEvent.create({
          data: {
            organizationId: orgId,
            type: 'EXTENDED',
            planId: plan.id,
            months: dto.months,
            oldEndsAt,
            newEndsAt,
            paymentId: payment.id,
            reason: dto.reason,
            adminId: actor.adminId,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          adminId: actor.adminId,
          action: 'subscription.extend',
          organizationId: orgId,
          entityType: 'subscription_payment',
          entityId: payment.id,
          before: { planId: current?.plan_id ?? null, endsAt: oldEndsAt?.toISOString() ?? null },
          after: {
            planId: plan.id,
            endsAt: newEndsAt.toISOString(),
            months: dto.months,
            amount: amount.toFixed(2),
            quotedAmount: priced.amount,
            method: dto.payment.method,
          },
          reason: dto.reason,
          meta,
        });

        let unlocked = false;
        if (dto.unlock) {
          const org = await tx.organization.findUniqueOrThrow({
            where: { id: orgId },
            select: { lockStatus: true },
          });
          if (org.lockStatus === 'LOCKED') {
            await this.shops.unlockInTx(
              tx,
              actor,
              orgId,
              dto.reason ?? 'Unlocked with payment',
              meta,
            );
            unlocked = true;
          }
        }
        return {
          payment: { ...payment, amount: amount.toFixed(2) },
          quote: priced,
          planCode: plan.code,
          oldEndsAt,
          newEndsAt,
          unlocked,
        };
      },
    );
    this.cache.invalidateAll();
    return { ...result, replayed };
  }

  async changePlan(
    actor: PlatformPrincipal,
    orgId: string,
    dto: ChangePlanDto,
    meta: PlatformRequestMeta,
  ) {
    const out = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockSubscription(tx, orgId);
      if (!current) {
        throw new AppException('NO_SUBSCRIPTION', 'Record a payment to start a subscription', 409);
      }
      const plan = await this.resolvePlan(tx, orgId, dto.planId);
      if (plan.id === current.plan_id) {
        throw new AppException('SAME_PLAN', 'The shop is already on this plan', 409);
      }
      await this.saveSubscription(tx, orgId, current, {
        planId: plan.id,
        startsAt: current.starts_at,
        endsAt: current.ends_at,
        graceDays: current.grace_days,
      });
      await tx.subscriptionEvent.create({
        data: {
          organizationId: orgId,
          type: 'PLAN_CHANGED',
          planId: plan.id,
          reason: dto.reason,
          adminId: actor.adminId,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'subscription.change_plan',
        organizationId: orgId,
        entityType: 'subscription',
        entityId: current.id,
        before: { planId: current.plan_id },
        after: { planId: plan.id, planCode: plan.code },
        reason: dto.reason,
        meta,
      });
      return { planCode: plan.code };
    });
    this.cache.invalidateAll();
    return out;
  }

  /** Correct the end date and/or grace days by hand (with a reason). */
  async adjust(
    actor: PlatformPrincipal,
    orgId: string,
    dto: AdjustSubscriptionDto,
    meta: PlatformRequestMeta,
  ) {
    if (dto.endsAt === undefined && dto.graceDays === undefined) {
      throw new AppException('VALIDATION_ERROR', 'Nothing to change', 400);
    }
    const out = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockSubscription(tx, orgId);
      if (!current) {
        throw new AppException('NO_SUBSCRIPTION', 'Record a payment to start a subscription', 409);
      }
      const endsAt = dto.endsAt ? new Date(dto.endsAt) : current.ends_at;
      const graceDays = dto.graceDays ?? current.grace_days;
      const startsAt = endsAt.getTime() < current.starts_at.getTime() ? endsAt : current.starts_at;
      await this.saveSubscription(tx, orgId, current, {
        planId: current.plan_id,
        startsAt,
        endsAt,
        graceDays,
      });
      if (dto.endsAt) {
        await tx.subscriptionEvent.create({
          data: {
            organizationId: orgId,
            type: 'ADJUSTED',
            oldEndsAt: current.ends_at,
            newEndsAt: endsAt,
            reason: dto.reason,
            adminId: actor.adminId,
          },
          select: { id: true },
        });
      }
      if (dto.graceDays !== undefined && dto.graceDays !== current.grace_days) {
        await tx.subscriptionEvent.create({
          data: {
            organizationId: orgId,
            type: 'GRACE_CHANGED',
            reason: `${dto.reason} (grace ${current.grace_days} -> ${graceDays} days)`,
            adminId: actor.adminId,
          },
          select: { id: true },
        });
      }
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'subscription.adjust',
        organizationId: orgId,
        entityType: 'subscription',
        entityId: current.id,
        before: { endsAt: current.ends_at.toISOString(), graceDays: current.grace_days },
        after: { endsAt: endsAt.toISOString(), graceDays },
        reason: dto.reason,
        meta,
      });
      return { endsAt, graceDays };
    });
    this.cache.invalidateAll();
    return out;
  }

  /**
   * Refund = a NEGATIVE payment row pointing at the original (never a delete). Dates do not change;
   * use adjust for that. One refund per payment.
   */
  async refund(actor: PlatformPrincipal, orgId: string, dto: RefundDto, meta: PlatformRequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockSubscription(tx, orgId);
      const original = await tx.subscriptionPayment.findFirst({
        where: { id: dto.paymentId, organizationId: orgId },
        select: {
          id: true,
          amount: true,
          method: true,
          reversesPaymentId: true,
          reversedBy: { select: { id: true } },
        },
      });
      if (!original || original.reversesPaymentId) {
        throw new AppException('NOT_FOUND', 'Payment not found', 404);
      }
      if (original.reversedBy) {
        throw new AppException('ALREADY_REFUNDED', 'This payment was already refunded', 409);
      }
      const paid = new Decimal(original.amount.toString());
      const amount = dto.amount ? new Decimal(dto.amount) : paid;
      if (amount.lte(0) || amount.gt(paid)) {
        throw new AppException(
          'VALIDATION_ERROR',
          `Refund must be more than 0 and at most ${paid.toFixed(2)}`,
          400,
        );
      }
      const refund = await tx.subscriptionPayment.create({
        data: {
          organizationId: orgId,
          amount: amount.neg().toFixed(2),
          method: original.method,
          months: 0,
          receivedAt: new Date(),
          reversesPaymentId: original.id,
          recordedById: actor.adminId,
        },
        select: { id: true },
      });
      await tx.subscriptionEvent.create({
        data: {
          organizationId: orgId,
          type: 'REFUNDED',
          paymentId: refund.id,
          reason: dto.reason,
          adminId: actor.adminId,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'subscription.refund',
        organizationId: orgId,
        entityType: 'subscription_payment',
        entityId: refund.id,
        after: { refundOf: original.id, amount: amount.neg().toFixed(2) },
        reason: dto.reason,
        meta,
      });
      return { refundId: refund.id, refundOf: original.id, amount: amount.neg().toFixed(2) };
    });
  }
}
