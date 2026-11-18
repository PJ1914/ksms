-- Phase 9: sales and POS (checkout, credit sales, held bills, cancellation, returns) and minimal customers.
-- Rollback: drop the triggers, index and constraints named below, then the added columns (nothing else depends on them).
-- Risk: additive only. New columns have defaults, so existing rows (there are none yet) stay valid.

-- 1. Exact partial returns and refunds.
ALTER TABLE "sales"
  ADD COLUMN "returned_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "refunded_total" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "sale_items"
  ADD COLUMN "returned_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "sale_return_items"
  ADD COLUMN "batch_id" UUID;

-- 2. Rules the database enforces no matter which code path writes the row.
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_returns_valid" CHECK (
    "returned_total" >= 0 AND "returned_total" <= "total"
    AND "refunded_total" >= 0 AND "refunded_total" <= "paid_total"
    AND "subtotal" >= 0 AND "round_off" BETWEEN -1 AND 1
  );
ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_returns_valid" CHECK ("returned_amount" >= 0 AND "returned_amount" <= "line_total");
ALTER TABLE "sale_returns"
  ADD CONSTRAINT "sale_returns_valid" CHECK ("total" >= 0 AND "subtotal" >= 0);

-- 3. One live customer per mobile number in a shop (the number is how a kirana finds its customers).
CREATE UNIQUE INDEX "customers_org_phone_unique"
  ON "customers" ("organization_id", "phone") WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL;

-- 4. Sale history is never deleted (sales, sale_items, invoices and payments are already protected).
CREATE TRIGGER sale_returns_no_delete
  BEFORE DELETE ON "sale_returns"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER sale_return_items_no_delete
  BEFORE DELETE ON "sale_return_items"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER sale_payments_no_delete
  BEFORE DELETE ON "sale_payments"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER customers_no_delete
  BEFORE DELETE ON "customers"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
