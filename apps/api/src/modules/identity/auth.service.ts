import { Injectable } from '@nestjs/common';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_BUSINESS_TYPE,
  PERMISSIONS,
  SYSTEM_ROLE_DESCRIPTIONS,
  SYSTEM_ROLE_PERMISSIONS,
} from '@ksms/constants';
import { normalizeIndianPhone } from '@ksms/validation';
import { AppException } from '../../common/errors/app.exception';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchService } from '../organization/branch.service';
import { SubscriptionService } from '../subscription/subscription.service';
import type { ChangePasswordDto, LoginDto, RegisterOwnerDto } from './auth.dto';
import { LoginLockoutService } from './login-lockout.service';
import { PasswordService } from './password.service';
import { type ClientInfo, SessionService } from './session.service';

export interface RequestMeta extends ClientInfo {
  correlationId?: string;
}

const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Salaries',
  'Transport',
  'Repairs & Maintenance',
  'Packaging',
  'Miscellaneous',
];

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly branches: BranchService,
    private readonly audit: AuditService,
    private readonly lockout: LoginLockoutService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** Creates the organization, first branch, system roles, the owner account and a first session in ONE transaction. */
  async registerOwner(dto: RegisterOwnerDto, meta: RequestMeta) {
    const passwordHash = await this.passwords.hash(dto.password); // CPU-heavy: keep outside the transaction

    const created = await this.prisma.$transaction(async (tx) => {
      await this.ensurePermissionCatalog(tx);
      const permissions = await tx.permission.findMany({ select: { id: true, key: true } });
      const permissionId = new Map(permissions.map((p) => [p.key, p.id]));

      const org = await tx.organization.create({
        data: {
          name: dto.shopName,
          phone: dto.phone,
          email: dto.email,
          settings: { businessType: dto.businessType ?? DEFAULT_BUSINESS_TYPE },
        },
        select: { id: true },
      });
      // Every new shop starts on the free trial (ADMIN_PANEL.md decision 4), in this same transaction.
      await this.subscriptions.startTrial(tx, org.id);

      const roleIds = new Map<string, string>();
      for (const [name, keys] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
        const role = await tx.role.create({
          data: {
            organizationId: org.id,
            name,
            isSystem: true,
            description: SYSTEM_ROLE_DESCRIPTIONS[name as keyof typeof SYSTEM_ROLE_DESCRIPTIONS],
          },
          select: { id: true },
        });
        roleIds.set(name, role.id);
        await tx.rolePermission.createMany({
          data: keys.map((k) => ({ roleId: role.id, permissionId: permissionId.get(k)! })),
        });
      }

      await tx.expenseCategory.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ organizationId: org.id, name })),
      });

      const user = await tx.user.create({
        data: { fullName: dto.fullName, phone: dto.phone, email: dto.email, passwordHash },
        select: { id: true },
      });
      const member = await tx.organizationMember.create({
        data: { organizationId: org.id, userId: user.id, roleId: roleIds.get('Owner')! },
        select: { id: true },
      });

      // The branch is created after the Owner member so the owner is auto-assigned to it.
      const branch = await this.branches.createInTx(tx, org.id, {
        code: 'MAIN',
        name: dto.branchName ?? 'Main Branch',
        stateCode: dto.stateCode,
        gstin: dto.gstin,
      });
      await tx.branchMembership.updateMany({
        where: { memberId: member.id, branchId: branch.id },
        data: { isDefault: true },
      });

      const session = await this.sessions.create(tx, user.id, org.id, meta);
      await this.audit.record(tx, {
        organizationId: org.id,
        branchId: branch.id,
        actorId: user.id,
        action: 'organization.register',
        entityType: 'organization',
        entityId: org.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return { userId: user.id, organizationId: org.id, ...session };
    });

    return this.authResponse(
      created.userId,
      created.organizationId,
      created.sessionId,
      created.refreshToken,
    );
  }

  async login(dto: LoginDto, meta: RequestMeta) {
    const identifier = dto.identifier.trim();
    const where = identifier.includes('@')
      ? { email: identifier.toLowerCase() }
      : { phone: normalizeIndianPhone(identifier) ?? '__invalid__' };

    const user = await this.prisma.user.findUnique({
      where,
      select: {
        id: true,
        passwordHash: true,
        isActive: true,
        failedLoginCount: true,
        lockedUntil: true,
        memberships: {
          where: { status: 'ACTIVE', organization: { deletedAt: null } },
          select: {
            organizationId: true,
            organization: { select: { name: true, lockStatus: true } },
          },
        },
      },
    });
    // A locked account still pays for a full hash check, so timing and answer match a wrong password.
    const locked = user !== null && this.lockout.isLocked(user);
    const passwordOk = await this.passwords.verifyOrDummy(
      locked ? null : user?.passwordHash,
      dto.password,
    );
    if (!user || locked || !passwordOk || !user.isActive) {
      if (user && !locked && !passwordOk) await this.lockout.recordFailure(user.id, meta);
      throw new AppException('INVALID_CREDENTIALS', 'Invalid mobile number/email or password', 401);
    }
    await this.lockout.recordSuccess(user);
    if (user.memberships.length === 0) {
      throw new AppException('NO_ACTIVE_MEMBERSHIP', 'Your account is not active in any shop', 403);
    }

    let organizationId: string;
    if (dto.organizationId) {
      const m = user.memberships.find((x) => x.organizationId === dto.organizationId);
      if (!m)
        throw new AppException(
          'ORG_ACCESS_DENIED',
          'You do not have access to this organization',
          403,
        );
      organizationId = m.organizationId;
    } else if (user.memberships.length === 1) {
      organizationId = user.memberships[0]!.organizationId;
    } else {
      throw new AppException('ORGANIZATION_REQUIRED', 'Choose which shop to sign in to', 409, {
        organizations: user.memberships.map((m) => ({
          id: m.organizationId,
          name: m.organization.name,
        })),
      });
    }

    // A shop locked by the platform cannot sign in (expired shops can: they keep read access).
    const chosen = user.memberships.find((m) => m.organizationId === organizationId);
    if (chosen?.organization.lockStatus === 'LOCKED') {
      throw new AppException('ORG_LOCKED', 'This shop is locked. Please contact support.', 403, {
        supportContact: await this.supportContact(),
      });
    }

    const session = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      return this.sessions.create(tx, user.id, organizationId, meta);
    });
    return this.authResponse(user.id, organizationId, session.sessionId, session.refreshToken);
  }

  async refresh(presentedRefreshToken: string) {
    const r = await this.sessions.rotate(presentedRefreshToken);
    return this.authResponse(r.userId, r.organizationId, r.sessionId, r.refreshToken);
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, 'logout');
  }

  /** Profile, role, branches and permission keys for the signed-in member. */
  async me(userId: string, organizationId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        id: true,
        user: { select: { id: true, fullName: true, phone: true, email: true } },
        organization: { select: { id: true, name: true, gstEnabled: true, currency: true } },
        role: {
          select: {
            id: true,
            name: true,
            isSystem: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
        branches: {
          where: { branch: { deletedAt: null, isActive: true } },
          select: { isDefault: true, branch: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    if (!member)
      throw new AppException(
        'ORG_ACCESS_DENIED',
        'You do not have access to this organization',
        403,
      );

    const isOwner = member.role.isSystem && member.role.name === 'Owner';
    const [subscription, supportContact] = await Promise.all([
      this.subscriptions.summary(organizationId),
      this.supportContact(),
    ]);
    return {
      subscription,
      supportContact,
      user: member.user,
      organization: member.organization,
      role: { id: member.role.id, name: member.role.name },
      branches: member.branches.map((b) => ({ ...b.branch, isDefault: b.isDefault })),
      permissions: isOwner
        ? [...ALL_PERMISSION_KEYS]
        : member.role.permissions.map((p) => p.permission.key).sort(),
    };
  }

  /** Changes the password and signs the user out everywhere (token version bump + session revocation). */
  async changePassword(
    userId: string,
    organizationId: string,
    dto: ChangePasswordDto,
    meta: RequestMeta,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user || !(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw new AppException('INVALID_CREDENTIALS', 'Current password is incorrect', 401);
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new AppException(
        'VALIDATION_ERROR',
        'New password must be different from the current one',
        400,
      );
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      await this.sessions.revokeAllForUser(tx, userId, 'password_changed');
      await this.audit.record(tx, {
        organizationId,
        actorId: userId,
        action: 'user.change_password',
        entityType: 'user',
        entityId: userId,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
    });
  }

  /** Tokens plus everything the app needs right after signing in. */
  async authResponse(
    userId: string,
    organizationId: string,
    sessionId: string,
    refreshToken: string,
  ) {
    const [profile, user] = await Promise.all([
      this.me(userId, organizationId),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } }),
    ]);
    const access = await this.sessions.signAccessToken(
      userId,
      sessionId,
      organizationId,
      user.tokenVersion,
    );
    return { ...access, refreshToken, ...profile };
  }

  /** Idempotent: inserts any permission keys missing from the global catalogue. */
  /** Support phone/WhatsApp/hours set in the admin panel (works for locked shops too). */
  async supportContact() {
    const s = await this.prisma.supportSettings.findUnique({ where: { id: 1 } });
    return { phone: s?.phone ?? null, whatsapp: s?.whatsapp ?? null, hours: s?.hoursText ?? null };
  }

  async ensurePermissionCatalog(db: Db): Promise<void> {
    await db.permission.createMany({
      data: ALL_PERMISSION_KEYS.map((key) => ({
        key,
        module: key.split('.')[0]!,
        description: PERMISSIONS[key],
      })),
      skipDuplicates: true,
    });
  }
}
