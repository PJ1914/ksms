-- FIXES F4: indexes so the daily retention purge finds old rows without scanning whole tables.
-- (idempotency_records(expires_at) already exists.)
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");
CREATE INDEX "user_sessions_revoked_at_idx" ON "user_sessions"("revoked_at");
CREATE INDEX "notifications_read_at_idx" ON "notifications"("read_at");
