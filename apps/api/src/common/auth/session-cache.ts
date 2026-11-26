import { Injectable } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import type { MemberRow } from '../tenant/member-lookup';

/** The session row the auth guard checks. */
export interface CachedSession {
  userId: string;
  organizationId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  user: { isActive: boolean; tokenVersion: number };
}

/** The membership row the tenant guard needs. */
export type CachedMember = NonNullable<MemberRow>;

export interface CachedAuth {
  session: CachedSession;
  member: CachedMember;
}

export const SESSION_CACHE_TTL_MS = 15_000;
const MAX_ENTRIES = 5000;
/**
 * After an invalidation the key is kept out of the cache for this long. It is longer than the longest
 * transaction (checkout: 60 s), so data read before that transaction commits is never cached.
 */
const QUARANTINE_MS = 65_000;

/**
 * Short-lived, in-process cache of the two rows every authenticated request needs (FIXES F7).
 *
 * Used for reads (GET/HEAD) only; writes always check the database, so a revoked session or a
 * deactivated member can never change anything. On this instance invalidation is immediate; another
 * instance may serve reads from its own cache for at most SESSION_CACHE_TTL_MS. Only positive results
 * are cached. Behind this small interface so it can become Redis later.
 */
@Injectable()
export class SessionCache {
  private readonly entries = new LRUCache<string, CachedAuth>({
    max: MAX_ENTRIES,
    ttl: SESSION_CACHE_TTL_MS,
    perf: { now: () => Date.now() }, // same clock as the quarantine checks below
  });
  private readonly quarantinedSessions = new Map<string, number>();
  private readonly quarantinedUsers = new Map<string, number>();
  private quarantinedAllUntil = 0;

  get(sessionId: string): CachedAuth | undefined {
    const hit = this.entries.get(sessionId);
    if (!hit) return undefined;
    if (this.blocked(sessionId, hit.session.userId)) {
      this.entries.delete(sessionId);
      return undefined;
    }
    return hit;
  }

  set(sessionId: string, value: CachedAuth): void {
    if (this.blocked(sessionId, value.session.userId)) return;
    this.entries.set(sessionId, value);
  }

  invalidateSession(sessionId: string): void {
    this.entries.delete(sessionId);
    this.quarantinedSessions.set(sessionId, Date.now() + QUARANTINE_MS);
  }

  invalidateUser(userId: string): void {
    for (const [key, value] of this.entries.entries()) {
      if (value.session.userId === userId) this.entries.delete(key);
    }
    this.quarantinedUsers.set(userId, Date.now() + QUARANTINE_MS);
  }

  /** For changes that affect many users at once (a branch switched off, a device revoked). */
  invalidateAll(): void {
    this.entries.clear();
    this.quarantinedAllUntil = Date.now() + QUARANTINE_MS;
  }

  /** Empties the cache without quarantine. Tests only: production code uses the invalidate methods. */
  reset(): void {
    this.entries.clear();
    this.quarantinedSessions.clear();
    this.quarantinedUsers.clear();
    this.quarantinedAllUntil = 0;
  }

  private blocked(sessionId: string, userId: string): boolean {
    const now = Date.now();
    if (this.quarantinedAllUntil > now) return true;
    return (
      this.active(this.quarantinedSessions, sessionId, now) ||
      this.active(this.quarantinedUsers, userId, now)
    );
  }

  private active(map: Map<string, number>, key: string, now: number): boolean {
    const until = map.get(key);
    if (until === undefined) return false;
    if (until > now) return true;
    map.delete(key);
    return false;
  }
}
