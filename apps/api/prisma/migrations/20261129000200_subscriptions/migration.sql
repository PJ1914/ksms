-- CreateEnum
CREATE TYPE "SubscriptionEventType" AS ENUM ('TRIAL_STARTED', 'GRANTED', 'EXTENDED', 'PLAN_CHANGED', 'LOCKED', 'UNLOCKED', 'REFUNDED', 'ADJUSTED', 'GRACE_CHANGED');

-- CreateEnum
CREATE TYPE "SubPaymentMethod" AS ENUM ('UPI', 'CASH', 'BANK', 'OTHER');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "lock_reason" TEXT,
ADD COLUMN     "lock_status" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "locked_at" TIMESTAMPTZ(3),
ADD COLUMN     "locked_by" UUID;

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "duration_discounts" JSONB NOT NULL DEFAULT '{}',
    "max_branches" INTEGER,
    "max_users" INTEGER,
    "features" JSONB NOT NULL DEFAULT '{}',
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "trial_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "grace_days" INTEGER NOT NULL DEFAULT 5,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "SubscriptionEventType" NOT NULL,
    "plan_id" UUID,
    "months" INTEGER,
    "old_ends_at" TIMESTAMPTZ(3),
    "new_ends_at" TIMESTAMPTZ(3),
    "payment_id" UUID,
    "reason" TEXT,
    "admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "SubPaymentMethod" NOT NULL,
    "reference" TEXT,
    "months" INTEGER NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "reverses_payment_id" UUID,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX "subscriptions_ends_at_idx" ON "subscriptions"("ends_at");

-- CreateIndex
CREATE INDEX "subscription_events_organization_id_created_at_idx" ON "subscription_events"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_reverses_payment_id_key" ON "subscription_payments"("reverses_payment_id");

-- CreateIndex
CREATE INDEX "subscription_payments_organization_id_received_at_idx" ON "subscription_payments"("organization_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "subscription_payments_received_at_idx" ON "subscription_payments"("received_at");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_reverses_payment_id_fkey" FOREIGN KEY ("reverses_payment_id") REFERENCES "subscription_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

