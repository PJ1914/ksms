import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { BRANCH_HEADER } from '@ksms/constants';
import { PrismaService } from '../../database/prisma.service';
import type { AppRequest } from '../auth/auth.types';
import { IS_PUBLIC, REQUIRE_BRANCH } from '../auth/decorators';
import { AppException } from '../errors/app.exception';

const uuid = z.uuid();

/**
 * Global guard #2 (runs after AuthGuard): builds the tenant context.
 * - The organization comes ONLY from the verified token, never from headers or body.
 * - The user must be an ACTIVE member of that organization.
 * - A requested branch (X-Branch-Id) must be one the member is assigned to.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const principal = req.principal;
    if (!principal) throw new AppException('UNAUTHORIZED', 'Not authenticated', 401);

    const member = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: principal.organizationId,
          userId: principal.userId,
        },
      },
      select: { id: true, roleId: true, status: true, branches: { select: { branchId: true } } },
    });
    if (!member || member.status !== 'ACTIVE') {
      throw new AppException(
        'ORG_ACCESS_DENIED',
        'You do not have access to this organization',
        403,
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
