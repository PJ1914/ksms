-- Subscriptions (ADMIN_PANEL.md Phase B): rules Prisma cannot express, plan seed and the go-live backfill.
-- Reversible by dropping the named triggers/constraints/indexes; seed rows can be deleted while no
-- subscription references them. Risk: subscription_events and subscription_payments become append-only.

-- 1. Value rules.
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_lock_status_check" CHECK ("lock_status" IN ('NONE', 'LOCKED'));
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_grace_days_check" CHECK ("grace_days" BETWEEN 0 AND 30),
  ADD CONSTRAINT "subscriptions_dates_check" CHECK ("ends_at" >= "starts_at"),
  ADD CONSTRAINT "subscriptions_version_check" CHECK ("version" >= 1);
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_price_check" CHECK ("monthly_price" >= 0),
  ADD CONSTRAINT "plans_limits_check" CHECK (("max_branches" IS NULL OR "max_branches" >= 1) AND ("max_users" IS NULL OR "max_users" >= 1)),
  ADD CONSTRAINT "plans_trial_days_check" CHECK ("trial_days" IS NULL OR "trial_days" BETWEEN 1 AND 365);
ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_amount_check" CHECK ("amount" <> 0),
  ADD CONSTRAINT "subscription_payments_months_check" CHECK ("months" BETWEEN -120 AND 120),
  -- A refund (negative) must point at the payment it reverses; a payment (positive) must not.
  ADD CONSTRAINT "subscription_payments_reversal_check" CHECK (("amount" < 0) = ("reverses_payment_id" IS NOT NULL));

-- 2. The same UPI/bank reference cannot be recorded twice for one shop (double entry of one payment).
CREATE UNIQUE INDEX "subscription_payments_org_method_reference_key"
  ON "subscription_payments" ("organization_id", "method", "reference")
  WHERE "reference" IS NOT NULL AND "reverses_payment_id" IS NULL;

-- 3. History is append-only.
CREATE TRIGGER subscription_events_append_only
  BEFORE UPDATE OR DELETE ON "subscription_events"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER subscription_events_no_truncate
  BEFORE TRUNCATE ON "subscription_events"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER subscription_payments_append_only
  BEFORE UPDATE OR DELETE ON "subscription_payments"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER subscription_payments_no_truncate
  BEFORE TRUNCATE ON "subscription_payments"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();

-- 4. Plans (ADMIN_PANEL.md decisions 3 and 4). Prices are editable later in the admin panel.
--    TRIAL gets Pro limits for 14 days so new shops see everything.
INSERT INTO "plans" ("id", "code", "name", "monthly_price", "duration_discounts", "max_branches", "max_users", "features", "is_trial", "trial_days", "updated_at")
VALUES
  (gen_random_uuid(), 'TRIAL', 'Free trial', 0, '{}', 3, 10, '{"all": true}', true, 14, now()),
  (gen_random_uuid(), 'BASIC', 'Basic', 299.00, '{"3": "5", "6": "10", "9": "12", "12": "15"}', 1, 3, '{}', false, NULL, now()),
  (gen_random_uuid(), 'PRO', 'Pro', 599.00, '{"3": "5", "6": "10", "9": "12", "12": "15"}', 3, 10, '{"all": true}', false, NULL, now())
ON CONFLICT ("code") DO NOTHING;

-- 5. Go-live backfill (decision 5): every existing shop gets 30 days of Pro, grace 5, so nobody is
--    locked out on deploy day. Recorded as a system GRANTED event with reason LEGACY.
WITH pro AS (SELECT "id" FROM "plans" WHERE "code" = 'PRO'),
created AS (
  INSERT INTO "subscriptions" ("id", "organization_id", "plan_id", "starts_at", "ends_at", "grace_days", "updated_at")
  SELECT gen_random_uuid(), o."id", pro."id", now(), now() + interval '30 days', 5, now()
  FROM "organizations" o CROSS JOIN pro
  WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."organization_id" = o."id")
  RETURNING "organization_id", "plan_id", "ends_at"
)
INSERT INTO "subscription_events" ("id", "organization_id", "type", "plan_id", "new_ends_at", "reason")
SELECT gen_random_uuid(), c."organization_id", 'GRANTED', c."plan_id", c."ends_at", 'LEGACY'
FROM created c;
