import type { SubscriptionState } from '@ksms/constants';
import { subscriptionState } from './subscription-state';

/** The organization fields TenantGuard gets with the membership row (see member-lookup.ts). */
export interface OrgSubscriptionRow {
  lockStatus: string;
  lockedAt: Date | null;
  subscription: {
    endsAt: Date;
    graceDays: number;
    plan: { code: string; isTrial: boolean };
  } | null;
}

export interface ShopSubscription {
  state: SubscriptionState;
  canRead: boolean;
  canWrite: boolean;
  planCode: string | null;
  endsAt: Date | null;
  graceEndsAt: Date | null;
  lockedAt: Date | null;
  daysLeft: number | null;
  graceDaysLeft: number | null;
}

/**
 * The shop's state now. A shop with no subscription row yet (created between the go-live migration and
 * the code that writes trials) is treated as ACTIVE with no end: nobody is locked out by a gap.
 */
export function shopSubscription(
  org: OrgSubscriptionRow | undefined,
  now = new Date(),
): ShopSubscription {
  const locked = org?.lockStatus === 'LOCKED';
  const sub = org?.subscription ?? null;
  if (!sub) {
    return {
      state: locked ? 'LOCKED' : 'ACTIVE',
      canRead: !locked,
      canWrite: !locked,
      planCode: null,
      endsAt: null,
      graceEndsAt: null,
      lockedAt: org?.lockedAt ?? null,
      daysLeft: null,
      graceDaysLeft: null,
    };
  }
  const s = subscriptionState({
    now,
    endsAt: sub.endsAt,
    graceDays: sub.graceDays,
    isTrial: sub.plan.isTrial,
    locked,
  });
  return {
    state: s.state,
    canRead: s.canRead,
    canWrite: s.canWrite,
    planCode: sub.plan.code,
    endsAt: sub.endsAt,
    graceEndsAt: s.graceEndsAt,
    lockedAt: org?.lockedAt ?? null,
    daysLeft: s.daysLeft,
    graceDaysLeft: s.graceDaysLeft,
  };
}
