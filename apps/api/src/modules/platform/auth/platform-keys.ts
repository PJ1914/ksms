import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../../common/errors/app.exception';
import { ENV, type Env } from '../../../config/config.module';

/**
 * The platform plane's keys. Both are required in production (env.ts); elsewhere, without them the
 * whole /admin/v1 surface answers 503 PLATFORM_DISABLED instead of running with weak defaults.
 */
@Injectable()
export class PlatformKeys {
  private readonly jwt: Uint8Array | null;
  private readonly mfa: Buffer | null;

  constructor(@Inject(ENV) env: Env) {
    this.jwt = env.PLATFORM_JWT_SECRET ? new TextEncoder().encode(env.PLATFORM_JWT_SECRET) : null;
    this.mfa = env.PLATFORM_MFA_KEY ? Buffer.from(env.PLATFORM_MFA_KEY, 'base64') : null;
  }

  get enabled(): boolean {
    return this.jwt !== null && this.mfa !== null;
  }

  jwtKey(): Uint8Array {
    if (!this.jwt) throw disabled();
    return this.jwt;
  }

  mfaKey(): Buffer {
    if (!this.mfa) throw disabled();
    return this.mfa;
  }
}

const disabled = () =>
  new AppException('PLATFORM_DISABLED', 'The admin panel is not configured on this server', 503);
