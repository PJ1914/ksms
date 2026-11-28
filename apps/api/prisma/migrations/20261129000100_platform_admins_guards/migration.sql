-- Platform control plane (ADR-001): rules Prisma cannot express.
-- Reversible by dropping the named triggers/constraints (see docs/database/MIGRATIONS.md).
-- Risk: platform_audit_logs becomes append-only by design (correct with a new entry, never edit).

-- 1. The platform audit log is append-only, like every other history table.
CREATE TRIGGER platform_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "platform_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER platform_audit_logs_no_truncate
  BEFORE TRUNCATE ON "platform_audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();

-- 2. Emails are stored lower-cased, so the unique index is case-insensitive in practice.
ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_email_lower_check" CHECK ("email" = lower("email") AND length("email") BETWEEN 3 AND 254);
ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_failed_login_count_check" CHECK ("failed_login_count" >= 0);
ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_mfa_last_step_check" CHECK ("mfa_last_step" IS NULL OR "mfa_last_step" >= 0);

-- 3. Live sessions per admin (the guard looks sessions up by id; this serves "revoke all for admin").
CREATE INDEX "platform_admin_sessions_admin_live_idx"
  ON "platform_admin_sessions" ("admin_id") WHERE "revoked_at" IS NULL;
