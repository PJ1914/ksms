import type { PlatformRoleName } from '@ksms/constants';
import type { AppRequest } from '../../common/auth/auth.types';

/** The signed-in admin/support user of the platform plane. Role comes from the DB on every request. */
export interface PlatformPrincipal {
  adminId: string;
  sessionId: string;
  role: PlatformRoleName;
}

export type PlatformRequest = AppRequest & { platform?: PlatformPrincipal };

/** Request facts recorded with audit entries and sessions. */
export interface PlatformRequestMeta {
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

export const platformMeta = (req: PlatformRequest): PlatformRequestMeta => ({
  ipAddress: req.ip,
  userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  correlationId: req.id,
});
