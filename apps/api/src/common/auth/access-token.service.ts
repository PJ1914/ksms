import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { ENV, type Env } from '../../config/config.module';
import { AppException } from '../errors/app.exception';
import type { AccessTokenClaims } from './auth.types';

const ISSUER = 'ksms-api';
const AUDIENCE = 'ksms-app';

@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  async sign(
    claims: AccessTokenClaims,
    ttlSeconds = this.env.JWT_ACCESS_TTL_SECONDS,
  ): Promise<string> {
    return new SignJWT({ sid: claims.sid, org: claims.org, v: claims.v })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  /** Verifies signature, algorithm, issuer, audience and expiry. Throws a 401 AppException on any failure. */
  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      const { sub, sid, org, v } = payload as Record<string, unknown>;
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        typeof org !== 'string' ||
        typeof v !== 'number'
      ) {
        throw new Error('malformed claims');
      }
      return { sub, sid, org, v };
    } catch {
      throw new AppException('UNAUTHORIZED', 'Invalid or expired access token', 401);
    }
  }
}
