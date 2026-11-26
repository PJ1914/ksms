-- FIXES F13: database-backed failed-login tracking and temporary lockout.
ALTER TABLE "users" ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "last_failed_login_at" TIMESTAMPTZ(3);
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMPTZ(3);
ALTER TABLE "users" ADD CONSTRAINT "users_failed_login_count_check" CHECK ("failed_login_count" >= 0);
