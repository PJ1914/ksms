import { Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { PLATFORM_ROLES, type PlatformRoleName } from '@ksms/constants';
import { AppException } from '../../../common/errors/app.exception';
import { PlatformKeys } from './platform-keys';

/**
 * Admin tokens. Different issuer, audiences AND secret from shop tokens (AccessTokenService), so a shop
 * token is never valid here and an admin token is never valid on the shop API (ADR-001).
 */
const ISSUER = 'ksms-admin';
const ACCESS_AUDIENCE = 'ksms-admin-app';
const MFA_AUDIENCE = 'ksms-admin-mfa';

export const PLATFORM_ACCESS_TTL_SECONDS = 15 * 60;
export const PLATFORM_MFA_TOKEN_TTL_SECONDS = 5 * 60;

export interface PlatformAccessClaims {
  sub: string; // admin id
  sid: string; // platform session id
  role: PlatformRoleName;
}

export interface MfaTokenClaims {
  sub: string; // admin id
  /** Fingerprint of the password hash: a password reset kills every outstanding mfaToken. */
  pwf: string;
}

@Injectable()
export class PlatformTokenService {
  constructor(private readonly keys: PlatformKeys) {}

  signAccess(c: PlatformAccessClaims): Promise<string> {
    return new SignJWT({ sid: c.sid, role: c.role, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.sub)
      .setIssuer(ISSUER)
      .setAudience(ACCESS_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${PLATFORM_ACCESS_TTL_SECONDS}s`)
      .sign(this.keys.jwtKey());
  }

  async verifyAccess(token: string): Promise<PlatformAccessClaims> {
    const key = this.keys.jwtKey();
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: ACCESS_AUDIENCE,
      });
      const { sub, sid, role, typ } = payload as Record<string, unknown>;
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        typ !== 'access' ||
        !PLATFORM_ROLES.includes(role as PlatformRoleName)
      ) {
        throw new Error('malformed claims');
      }
      return { sub, sid, role: role as PlatformRoleName };
    } catch {
      throw new AppException('PLATFORM_UNAUTHORIZED', 'Invalid or expired admin token', 401);
    }
  }

  /** Short-lived, purpose-bound token proving the password step passed; only good for the MFA step. */
  signMfa(c: MfaTokenClaims): Promise<string> {
    return new SignJWT({ pwf: c.pwf, typ: 'mfa' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.sub)
      .setIssuer(ISSUER)
      .setAudience(MFA_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${PLATFORM_MFA_TOKEN_TTL_SECONDS}s`)
      .sign(this.keys.jwtKey());
  }

  async verifyMfa(token: string): Promise<MfaTokenClaims> {
    const key = this.keys.jwtKey();
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: MFA_AUDIENCE,
      });
      const { sub, pwf, typ } = payload as Record<string, unknown>;
      if (typeof sub !== 'string' || typeof pwf !== 'string' || typ !== 'mfa') {
        throw new Error('malformed claims');
      }
      return { sub, pwf };
    } catch {
      throw new AppException('MFA_TOKEN_INVALID', 'Sign in again: the login step expired', 401);
    }
  }
}
