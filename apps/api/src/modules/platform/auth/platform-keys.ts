import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../../common/errors/app.exception';
import { ENV, type Env } from '../../../config/config.module';

/**
 * The platform plane's keys. Without BOTH of them the whole /admin/v1 surface answers 503
 * PLATFORM_DISABLED (nothing runs with weak defaults) while the shop API keeps working; a warning is
 * logged once at start-up so a forgotten key is easy to spot.
 */
@Injectable()
export class PlatformKeys {
  private readonly jwt: Uint8Array | null;
  private readonly mfa: Buffer | null;

  constructor(@Inject(ENV) env: Env) {
    this.jwt = env.PLATFORM_JWT_SECRET ? new TextEncoder().encode(env.PLATFORM_JWT_SECRET) : null;
    this.mfa = env.PLATFORM_MFA_KEY ? Buffer.from(env.PLATFORM_MFA_KEY, 'base64') : null;
    if (!this.enabled && env.NODE_ENV !== 'test') {
      new Logger(PlatformKeys.name).warn(
        'Admin panel API is OFF: set PLATFORM_JWT_SECRET and PLATFORM_MFA_KEY to turn it on.',
      );
    }
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
