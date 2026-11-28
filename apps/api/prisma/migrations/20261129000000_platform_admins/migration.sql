-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('ADMIN', 'SUPPORT');

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "mfa_secret_enc" TEXT,
    "mfa_enabled_at" TIMESTAMPTZ(3),
    "mfa_last_step" BIGINT,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "last_failed_login_at" TIMESTAMPTZ(3),
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_recovery_codes" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_sessions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "previous_token_hash" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,

    CONSTRAINT "platform_admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "organization_id" UUID,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "before_data" JSONB,
    "after_data" JSONB,
    "reason" TEXT,
    "ip_address" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_recovery_codes_code_hash_key" ON "platform_admin_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "platform_admin_recovery_codes_admin_id_idx" ON "platform_admin_recovery_codes"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_sessions_refresh_token_hash_key" ON "platform_admin_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "platform_admin_sessions_admin_id_idx" ON "platform_admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "platform_admin_sessions_previous_token_hash_idx" ON "platform_admin_sessions"("previous_token_hash");

-- CreateIndex
CREATE INDEX "platform_audit_logs_organization_id_created_at_idx" ON "platform_audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_audit_logs_admin_id_created_at_idx" ON "platform_audit_logs"("admin_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_admin_recovery_codes" ADD CONSTRAINT "platform_admin_recovery_codes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

