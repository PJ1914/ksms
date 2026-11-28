import { Injectable } from '@nestjs/common';
import type { PlatformRoleName } from '@ksms/constants';
import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../database/prisma.service';
import { PasswordService } from '../../identity/password.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import type { PlatformRequestMeta } from '../platform.types';
import { newRecoveryCode, normaliseRecoveryCode, RECOVERY_CODE_COUNT } from './credentials';
import { PlatformKeys } from './platform-keys';
import { PlatformLockoutService } from './platform-lockout.service';
import { PlatformSessionService, sha256 } from './platform-session.service';
import {
  PLATFORM_ACCESS_TTL_SECONDS,
  PLATFORM_MFA_TOKEN_TTL_SECONDS,
  PlatformTokenService,
} from './platform-token.service';
import { open, seal } from './secret-box';
import { base32Decode, base32Encode, matchingStep, newTotpSecret, otpauthUri } from './totp';

const ISSUER_LABEL = 'Yapaaram Admin';

/** Same answer for unknown email, wrong password, disabled or locked account: nothing to enumerate. */
const badCredentials = () =>
  new AppException('PLATFORM_UNAUTHORIZED', 'Invalid email or password', 401);
const mfaInvalid = () => new AppException('MFA_INVALID', 'That code is not valid', 401);

const ADMIN_PROFILE = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  mustChangePassword: true,
  mfaEnabledAt: true,
  lastLoginAt: true,
} as const;

const fingerprint = (passwordHash: string) => sha256(passwordHash).slice(0, 24);

/**
 * Sign-in for platform admins (ADR-001): password step → short-lived mfaToken → authenticator code (or
 * a recovery code) → session. Admins without MFA are walked through enrolment first; there is no way to
 * get a session without a second factor.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: PlatformTokenService,
    private readonly sessions: PlatformSessionService,
    private readonly lockout: PlatformLockoutService,
    private readonly audit: PlatformAuditService,
    private readonly keys: PlatformKeys,
  ) {}

  async login(email: string, password: string, meta: PlatformRequestMeta) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        passwordHash: true,
        isActive: true,
        lockedUntil: true,
        mfaEnabledAt: true,
      },
    });
    // Always run a hash check so timing does not reveal whether the email exists.
    const ok = await this.passwords.verifyOrDummy(admin?.passwordHash, password);
    if (!admin || !admin.isActive || this.lockout.isLocked(admin)) throw badCredentials();
    if (!ok) {
      await this.lockout.recordFailure(admin.id, 'password', meta);
      throw badCredentials();
    }
    // The failure count is NOT reset here: only a full sign-in (with the second factor) resets it.
    const mfaToken = await this.tokens.signMfa({
      sub: admin.id,
      pwf: fingerprint(admin.passwordHash),
    });
    return {
      step: admin.mfaEnabledAt ? ('MFA_VERIFY' as const) : ('MFA_SETUP' as const),
      mfaToken,
      expiresIn: PLATFORM_MFA_TOKEN_TTL_SECONDS,
    };
  }

  /** Loads the admin behind an mfaToken; the token dies with a password change or deactivation. */
  private async fromMfaToken(mfaToken: string) {
    const claims = await this.tokens.verifyMfa(mfaToken);
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isActive: true,
        lockedUntil: true,
        mfaSecretEnc: true,
        mfaEnabledAt: true,
        role: true,
      },
    });
    if (!admin || !admin.isActive || fingerprint(admin.passwordHash) !== claims.pwf) {
      throw new AppException('MFA_TOKEN_INVALID', 'Sign in again: the login step expired', 401);
    }
    if (this.lockout.isLocked(admin)) {
      throw new AppException(
        'ADMIN_LOCKED',
        'Too many wrong attempts. Try again in 15 minutes.',
        403,
      );
    }
    return admin;
  }

  /** Starts (or restarts) enrolment: a new secret for the authenticator app. Only before MFA is on. */
  async mfaSetup(mfaToken: string) {
    const admin = await this.fromMfaToken(mfaToken);
    if (admin.mfaEnabledAt) {
      throw new AppException('MFA_ALREADY_ENABLED', 'Two-step sign-in is already set up', 409);
    }
    const secret = base32Encode(newTotpSecret());
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { mfaSecretEnc: seal(this.keys.mfaKey(), secret), mfaLastStep: null },
      select: { id: true },
    });
    return { secret, otpauthUri: otpauthUri(secret, admin.email, ISSUER_LABEL) };
  }

  /** Finishes enrolment with a first code; returns the session and the recovery codes (shown once). */
  async mfaConfirm(mfaToken: string, code: string, meta: PlatformRequestMeta) {
    const admin = await this.fromMfaToken(mfaToken);
    if (admin.mfaEnabledAt) {
      throw new AppException('MFA_ALREADY_ENABLED', 'Two-step sign-in is already set up', 409);
    }
    if (!admin.mfaSecretEnc) {
      throw new AppException('MFA_SETUP_REQUIRED', 'Start the authenticator setup first', 409);
    }
    await this.checkTotp(admin.id, admin.mfaSecretEnc, code, meta);

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    const result = await this.prisma.$transaction(async (tx) => {
      const enabled = await tx.platformAdmin.updateMany({
        where: { id: admin.id, mfaEnabledAt: null },
        data: { mfaEnabledAt: new Date() },
      });
      if (enabled.count !== 1) {
        throw new AppException('MFA_ALREADY_ENABLED', 'Two-step sign-in is already set up', 409);
      }
      await tx.platformAdminRecoveryCode.deleteMany({ where: { adminId: admin.id } });
      await tx.platformAdminRecoveryCode.createMany({
        data: recoveryCodes.map((c) => ({
          adminId: admin.id,
          codeHash: sha256(normaliseRecoveryCode(c)),
        })),
      });
      await this.audit.record(tx, {
        adminId: admin.id,
        action: 'auth.mfa_enrolled',
        entityType: 'platform_admin',
        entityId: admin.id,
        meta,
      });
      return this.startSession(tx, admin.id, admin.role, meta);
    });
    await this.lockout.reset(admin.id);
    return { ...result, recoveryCodes };
  }

  /** The normal second step: a 6-digit code from the app, or one of the recovery codes. */
  async mfaVerify(
    mfaToken: string,
    input: { code?: string; recoveryCode?: string },
    meta: PlatformRequestMeta,
  ) {
    const admin = await this.fromMfaToken(mfaToken);
    if (!admin.mfaEnabledAt || !admin.mfaSecretEnc) {
      throw new AppException('MFA_SETUP_REQUIRED', 'Set up two-step sign-in first', 409);
    }
    let usedRecovery = false;
    if (input.code) {
      await this.checkTotp(admin.id, admin.mfaSecretEnc, input.code, meta);
    } else if (input.recoveryCode) {
      const used = await this.prisma.platformAdminRecoveryCode.updateMany({
        where: {
          adminId: admin.id,
          codeHash: sha256(normaliseRecoveryCode(input.recoveryCode)),
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) {
        await this.lockout.recordFailure(admin.id, 'mfa', meta);
        throw mfaInvalid();
      }
      usedRecovery = true;
    } else {
      throw new AppException('VALIDATION_ERROR', 'Send a code or a recovery code', 400);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (usedRecovery) {
        const left = await tx.platformAdminRecoveryCode.count({
          where: { adminId: admin.id, usedAt: null },
        });
        await this.audit.record(tx, {
          adminId: admin.id,
          action: 'auth.recovery_code_used',
          entityType: 'platform_admin',
          entityId: admin.id,
          after: { remaining: left },
          meta,
        });
      }
      return this.startSession(tx, admin.id, admin.role, meta);
    });
    await this.lockout.reset(admin.id);
    return result;
  }

  /**
   * Accepts a code only if it matches now (±1 step) AND its step is newer than the last one used.
   * The step is claimed with a conditional update, so the same code cannot be used twice even by two
   * requests at the same moment.
   */
  private async checkTotp(
    adminId: string,
    secretEnc: string,
    code: string,
    meta: PlatformRequestMeta,
  ) {
    const secret = base32Decode(open(this.keys.mfaKey(), secretEnc));
    const step = matchingStep(secret, code, Date.now());
    if (step !== null) {
      const claimed = await this.prisma.platformAdmin.updateMany({
        where: { id: adminId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: BigInt(step) } }] },
        data: { mfaLastStep: BigInt(step) },
      });
      if (claimed.count === 1) return;
    }
    await this.lockout.recordFailure(adminId, 'mfa', meta);
    throw mfaInvalid();
  }

  private async startSession(
    tx: Parameters<PlatformSessionService['create']>[0],
    adminId: string,
    role: PlatformRoleName,
    meta: PlatformRequestMeta,
  ) {
    const { sessionId, refreshToken } = await this.sessions.create(tx, adminId, meta);
    const admin = await tx.platformAdmin.update({
      where: { id: adminId },
      data: { lastLoginAt: new Date() },
      select: ADMIN_PROFILE,
    });
    await this.audit.record(tx, {
      adminId,
      action: 'auth.login',
      entityType: 'platform_session',
      entityId: sessionId,
      meta,
    });
    const accessToken = await this.tokens.signAccess({ sub: adminId, sid: sessionId, role });
    return { accessToken, refreshToken, expiresIn: PLATFORM_ACCESS_TTL_SECONDS, admin };
  }

  async refresh(refreshToken: string) {
    const r = await this.sessions.rotate(refreshToken);
    const accessToken = await this.tokens.signAccess({
      sub: r.adminId,
      sid: r.sessionId,
      role: r.role,
    });
    return { accessToken, refreshToken: r.refreshToken, expiresIn: PLATFORM_ACCESS_TTL_SECONDS };
  }

  async logout(adminId: string, sessionId: string, meta: PlatformRequestMeta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.revoke(tx, sessionId, 'logout');
      await this.audit.record(tx, {
        adminId,
        action: 'auth.logout',
        entityType: 'platform_session',
        entityId: sessionId,
        meta,
      });
    });
  }

  /** Replaces the password (temporary or not) and signs out every other session. */
  async changePassword(
    adminId: string,
    sessionId: string,
    current: string,
    next: string,
    meta: PlatformRequestMeta,
  ) {
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({
      where: { id: adminId },
      select: { passwordHash: true },
    });
    if (!(await this.passwords.verify(admin.passwordHash, current))) {
      await this.lockout.recordFailure(adminId, 'password', meta);
      throw new AppException('INVALID_PASSWORD', 'Current password is wrong', 400);
    }
    if (current === next) {
      throw new AppException(
        'PASSWORD_REUSED',
        'Choose a password different from the current one',
        400,
      );
    }
    const passwordHash = await this.passwords.hash(next);
    await this.prisma.$transaction(async (tx) => {
      await tx.platformAdmin.update({
        where: { id: adminId },
        data: { passwordHash, mustChangePassword: false },
        select: { id: true },
      });
      const revoked = await this.sessions.revokeAllForAdmin(
        tx,
        adminId,
        'password_changed',
        sessionId,
      );
      await this.audit.record(tx, {
        adminId,
        action: 'auth.password_changed',
        entityType: 'platform_admin',
        entityId: adminId,
        after: { otherSessionsRevoked: revoked },
        meta,
      });
    });
    return this.me(adminId);
  }

  me(adminId: string) {
    return this.prisma.platformAdmin.findUniqueOrThrow({
      where: { id: adminId },
      select: ADMIN_PROFILE,
    });
  }
}
