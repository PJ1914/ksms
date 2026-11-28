import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { BRANCH_HEADER, SUBSCRIPTION_STATE_HEADER } from '@ksms/constants';
import { PrismaService } from '../../database/prisma.service';
import type { AppRequest } from '../auth/auth.types';
import {
  ALLOW_WHEN_EXPIRED,
  ALLOW_WHEN_LOCKED,
  IS_PLATFORM,
  IS_PUBLIC,
  READ_ONLY_SAFE,
  REQUIRE_BRANCH,
} from '../auth/decorators';
import { AppException } from '../errors/app.exception';
import { shopSubscription } from '../subscription/shop-subscription';
import { findMember } from './member-lookup';

const uuid = z.uuid();

/**
 * Global guard #2 (runs after AuthGuard): builds the tenant context.
 * - The organization comes ONLY from the verified token, never from headers or body.
 * - The user must be an ACTIVE member of that organization.
 * - A requested branch (X-Branch-Id) must be one the member is assigned to AND that is still active.
 * - The shop's subscription is enforced (ADMIN_PANEL.md §2.5), from fields loaded with the membership:
 *   LOCKED → 403 ORG_LOCKED (except @AllowWhenLocked routes); EXPIRED → reads only, writes 402
 *   SUBSCRIPTION_EXPIRED (except @AllowWhenExpired / @ReadOnlySafe); GRACE and the rest pass.
 *   Every answer carries X-Subscription-State.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    // Platform routes have no tenant: they are cross-tenant by design (ADR-001).
    if (this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const principal = req.principal;
    if (!principal) throw new AppException('UNAUTHORIZED', 'Not authenticated', 401);

    const member = await (req.memberLookup ??
      findMember(this.prisma, principal.organizationId, principal.userId));
    if (!member || member.status !== 'ACTIVE') {
      throw new AppException(
        'ORG_ACCESS_DENIED',
        'You do not have access to this organization',
        403,
      );
    }

    const subscription = shopSubscription(member.organization);
    req.subscription = subscription;
    ctx
      .switchToHttp()
      .getResponse<{ setHeader(n: string, v: string): void }>()
      .setHeader(SUBSCRIPTION_STATE_HEADER, subscription.state);
    const flag = (key: string) => this.reflector.getAllAndOverride<boolean>(key, targets) === true;
    if (subscription.state === 'LOCKED' && !flag(ALLOW_WHEN_LOCKED)) {
      throw new AppException('ORG_LOCKED', 'This shop is locked. Please contact support.', 403, {
        lockedAt: subscription.lockedAt,
      });
    }
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (
      subscription.state === 'EXPIRED' &&
      isWrite &&
      !flag(ALLOW_WHEN_EXPIRED) &&
      !flag(ALLOW_WHEN_LOCKED) &&
      !flag(READ_ONLY_SAFE)
    ) {
      throw new AppException(
        'SUBSCRIPTION_EXPIRED',
        'Your subscription has ended. You can view your data; renew to make changes.',
        402,
        { endsAt: subscription.endsAt, graceEndsAt: subscription.graceEndsAt },
      );
    }

    const raw = req.headers[BRANCH_HEADER];
    let branchId: string | null = null;
    if (raw !== undefined) {
      const parsed = uuid.safeParse(Array.isArray(raw) ? raw[0] : raw);
      if (!parsed.success) {
        throw new AppException('INVALID_BRANCH_ID', `${BRANCH_HEADER} must be a valid UUID`, 400);
      }
      if (!member.branches.some((b) => b.branchId === parsed.data)) {
        throw new AppException('BRANCH_FORBIDDEN', 'You are not assigned to this branch', 403);
      }
      branchId = parsed.data;
    }

    if (branchId === null && this.reflector.getAllAndOverride<boolean>(REQUIRE_BRANCH, targets)) {
      throw new AppException('BRANCH_REQUIRED', `${BRANCH_HEADER} header is required`, 400);
    }

    req.tenant = {
      organizationId: principal.organizationId,
      branchId,
      memberId: member.id,
      roleId: member.roleId,
      userId: principal.userId,
    };
    return true;
  }
}
