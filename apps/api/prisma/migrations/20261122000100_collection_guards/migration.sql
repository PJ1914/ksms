-- Phase 11 audit: two collection rules that were only checked in application code are now enforced by the database,
-- so two requests arriving at the same moment cannot both succeed.
-- Rollback: DROP INDEX "collection_agents_one_per_user"; DROP INDEX "collection_assignments_one_active_per_customer";
-- Risk: the migration fails (changing nothing) if existing data already breaks a rule; fix that data first.

-- 1. A login is linked to at most one (non-deleted) collection agent, so attribution is never ambiguous.
CREATE UNIQUE INDEX "collection_agents_one_per_user"
  ON "collection_agents" ("organization_id", "user_id")
  WHERE "user_id" IS NOT NULL AND "deleted_at" IS NULL;

-- 2. A customer has at most one ACTIVE collector.
CREATE UNIQUE INDEX "collection_assignments_one_active_per_customer"
  ON "collection_assignments" ("organization_id", "customer_id")
  WHERE "status" = 'ACTIVE';
