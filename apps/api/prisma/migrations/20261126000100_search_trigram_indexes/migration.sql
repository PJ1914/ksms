-- FIXES F10: "contains" search (ILIKE '%q%' / LIKE '%q%') could not use any index and scanned every row.
-- GIN trigram indexes let PostgreSQL find matches by index. Every column searched in the same OR gets one,
-- because a single unindexed branch forces a full scan again.
--
-- The extension lives in "public" and the operator class is schema-qualified, so this also works when
-- the migration runs with another search_path (the integration tests use one schema per run).
--
-- PRODUCTION NOTE (large tables): CREATE INDEX takes a write lock for its duration. If a table is big,
-- create each index by hand first with CREATE INDEX CONCURRENTLY ... (same names), then mark this
-- migration applied: `prisma migrate resolve --applied 20261126000100_search_trigram_indexes`.
-- See docs/database/MIGRATIONS.md.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING gin ("name" public.gin_trgm_ops) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "products_local_name_trgm_idx" ON "products" USING gin ("local_name" public.gin_trgm_ops) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "products_sku_trgm_idx" ON "products" USING gin ("sku" public.gin_trgm_ops) WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "customers_name_trgm_idx" ON "customers" USING gin ("name" public.gin_trgm_ops) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "customers_phone_trgm_idx" ON "customers" USING gin ("phone" public.gin_trgm_ops) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "customers_gstin_trgm_idx" ON "customers" USING gin ("gstin" public.gin_trgm_ops) WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "suppliers_name_trgm_idx" ON "suppliers" USING gin ("name" public.gin_trgm_ops) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "suppliers_contact_person_trgm_idx" ON "suppliers" USING gin ("contact_person" public.gin_trgm_ops) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "suppliers_phone_trgm_idx" ON "suppliers" USING gin ("phone" public.gin_trgm_ops) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "suppliers_gstin_trgm_idx" ON "suppliers" USING gin ("gstin" public.gin_trgm_ops) WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "sales_sale_number_trgm_idx" ON "sales" USING gin ("sale_number" public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "invoices_invoice_number_trgm_idx" ON "invoices" USING gin ("invoice_number" public.gin_trgm_ops);
