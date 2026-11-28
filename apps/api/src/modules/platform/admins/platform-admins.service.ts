import { Injectable } from '@nestjs/common';
import type { PlatformRoleName } from '@ksms/constants';
import { AppException } from '../../../common/errors/app.exception';
import type { Db } from '../../../database/db.types';
import { PrismaService } from '../../../database/prisma.service';
import { PasswordService } from '../../identity/password.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { newTemporaryPassword } from '../auth/credentials';
import { PlatformSessionService } from '../auth/platform-session.service';
import type { PlatformPrincipal, PlatformRequestMeta } from '../platform.types';
import type { CreatePlatformAdminDto, UpdatePlatformAdminDto } from './platform-admins.dto';

/** What the panel shows about an admin. Never the password hash, MFA secret or recovery codes. */
export const ADMIN_VIEW = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  mfaEnabledAt: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdById: true,
  createdAt: true,
} as const;

const cannotChangeSelf = () =>
  new AppException('CANNOT_CHANGE_SELF', 'Ask another admin to change your own account', 400);

/**
 * Platform admin accounts (ADMIN only). Invariant: there is always at least one active ADMIN. Every
 * change locks all admin rows first (see lockForChange), so two admins demoting each other at the same
 * time cannot both win.
 */
@Injectable()
export class PlatformAdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: PlatformSessionService,
    private readonly audit: PlatformAuditService,
  ) {}

  list() {
    return this.prisma.platformAdmin.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: ADMIN_VIEW,
    });
  }

  /**
   * Creates an account with a temporary password that is returned ONCE. The new admin must change it and
   * set up the authenticator at first sign-in.
   */
  async create(
    actor: PlatformPrincipal | null,
    dto: Pick<CreatePlatformAdminDto, 'email' | 'fullName' | 'role'>,
    meta: PlatformRequestMeta,
    db: Db = this.prisma,
  ) {
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const email = dto.email.trim().toLowerCase();
    const run = async (tx: Db) => {
      const existing = await tx.platformAdmin.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing)
        throw new AppException('CONFLICT', 'An admin with this email already exists', 409);
      const admin = await tx.platformAdmin.create({
        data: {
          email,
          fullName: dto.fullName.trim(),
          role: dto.role,
          passwordHash,
          mustChangePassword: true,
          createdById: actor?.adminId ?? null,
        },
        select: ADMIN_VIEW,
      });
      await this.audit.record(tx, {
        // The first admin (CLI bootstrap) has no creator: the entry is recorded against itself.
        adminId: actor?.adminId ?? admin.id,
        action: actor ? 'admin.create' : 'admin.bootstrap',
        entityType: 'platform_admin',
        entityId: admin.id,
        after: { email: admin.email, fullName: admin.fullName, role: admin.role },
        meta,
      });
      return admin;
    };
    const admin = db === this.prisma ? await this.prisma.$transaction(run) : await run(db);
    return { admin, temporaryPassword };
  }

  async update(
    actor: PlatformPrincipal,
    id: string,
    dto: UpdatePlatformAdminDto,
    meta: PlatformRequestMeta,
  ) {
    if (id === actor.adminId) throw cannotChangeSelf();
    if (dto.role === undefined && dto.isActive === undefined) {
      throw new AppException('VALIDATION_ERROR', 'Nothing to change', 400);
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lockForChange(tx, id);
      const role: PlatformRoleName = dto.role ?? before.role;
      const isActive = dto.isActive ?? before.isActive;
      const losesAdmin =
        before.role === 'ADMIN' && before.isActive && (role !== 'ADMIN' || !isActive);
      if (losesAdmin && !before.otherActiveAdmin) {
        throw new AppException('LAST_ADMIN', 'There must always be at least one active ADMIN', 409);
      }

      const after = await tx.platformAdmin.update({
        where: { id },
        data: { role, isActive },
        select: ADMIN_VIEW,
      });
      // A changed role or a disabled account takes effect at once: sessions are ended.
      if (role !== before.role || !isActive) {
        await this.sessions.revokeAllForAdmin(tx, id, isActive ? 'role_changed' : 'disabled');
      }
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'admin.update',
        entityType: 'platform_admin',
        entityId: id,
        before: { role: before.role, isActive: before.isActive },
        after: { role: after.role, isActive: after.isActive },
        reason: dto.reason,
        meta,
      });
      return after;
    });
  }

  /** Clears the authenticator: the admin enrols again at next sign-in. Ends their sessions. */
  async resetMfa(actor: PlatformPrincipal, id: string, reason: string, meta: PlatformRequestMeta) {
    if (id === actor.adminId) throw cannotChangeSelf();
    return this.prisma.$transaction(async (tx) => {
      await this.lockForChange(tx, id);
      await tx.platformAdminRecoveryCode.deleteMany({ where: { adminId: id } });
      const after = await tx.platformAdmin.update({
        where: { id },
        data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null },
        select: ADMIN_VIEW,
      });
      await this.sessions.revokeAllForAdmin(tx, id, 'mfa_reset');
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'admin.reset_mfa',
        entityType: 'platform_admin',
        entityId: id,
        reason,
        meta,
      });
      return after;
    });
  }

  /** New temporary password (returned once), lockout cleared, sessions ended. */
  async resetPassword(
    actor: PlatformPrincipal,
    id: string,
    reason: string,
    meta: PlatformRequestMeta,
  ) {
    if (id === actor.adminId) throw cannotChangeSelf();
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const admin = await this.prisma.$transaction(async (tx) => {
      await this.lockForChange(tx, id);
      const after = await tx.platformAdmin.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedLoginCount: 0,
          lastFailedLoginAt: null,
          lockedUntil: null,
        },
        select: ADMIN_VIEW,
      });
      await this.sessions.revokeAllForAdmin(tx, id, 'password_reset');
      await this.audit.record(tx, {
        adminId: actor.adminId,
        action: 'admin.reset_password',
        entityType: 'platform_admin',
        entityId: id,
        reason,
        meta,
      });
      return after;
    });
    return { admin, temporaryPassword };
  }

  /**
   * Locks EVERY admin row (there are only a handful), always in id order, then returns the target and
   * whether another active ADMIN exists. One lock order for all changes means concurrent changes queue
   * instead of deadlocking, and "the last ADMIN" cannot be removed by two changes racing.
   */
  private async lockForChange(tx: Db, id: string) {
    const rows = await tx.$queryRaw<{ id: string; role: PlatformRoleName; is_active: boolean }[]>`
      SELECT id, role::text AS role, is_active FROM platform_admins ORDER BY id FOR UPDATE`;
    const target = rows.find((r) => r.id === id);
    if (!target) throw new AppException('NOT_FOUND', 'Admin not found', 404);
    const otherActiveAdmin = rows.some((r) => r.id !== id && r.role === 'ADMIN' && r.is_active);
    return { role: target.role, isActive: target.is_active, otherActiveAdmin };
  }
}
