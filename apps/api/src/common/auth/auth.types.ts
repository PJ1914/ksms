import type { Request } from 'express';

/** Claims inside a short-lived access token. Permissions are NOT embedded (looked up per request). */
export interface AccessTokenClaims {
  sub: string; // user id
  sid: string; // session id
  org: string; // organization id
  v: number; // user's tokenVersion at issue time
}

export interface Principal {
  userId: string;
  sessionId: string;
  organizationId: string;
}

export interface TenantContext {
  organizationId: string;
  branchId: string | null;
  memberId: string;
  roleId: string;
  userId: string;
}

export type AppRequest = Request & {
  id?: string;
  principal?: Principal;
  tenant?: TenantContext;
};
