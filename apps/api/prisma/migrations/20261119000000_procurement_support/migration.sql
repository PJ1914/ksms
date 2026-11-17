-- Phase 8: procurement support (suppliers, purchases, receipts, returns, supplier payments).
-- Rollback: drop the triggers, indexes, constraints and then the columns named below (nothing else depends on them yet).
-- Risk: additive only. New columns have defaults, so existing rows (there are none in production yet) stay valid.

-- 1. Exact partial receipts and returns: each purchase line remembers what was billed and returned so far.
ALTER TABLE "purchase_items"
  ADD COLUMN "allocated_extra" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "billed_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "returned_base_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN "returned_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "purchases"
  ADD COLUMN "billed_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "returned_total" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "purchase_return_items"
  ADD COLUMN "purchase_item_id" UUID;

-- 2. Payments to suppliers point at a real supplier.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Rules the database enforces no matter which code path writes the row.
ALTER TABLE "purchase_items"
  ADD CONSTRAINT "purchase_items_billing_valid" CHECK (
    "allocated_extra" >= 0 AND "billed_amount" >= 0 AND "returned_amount" >= 0
    AND "returned_base_quantity" >= 0
    AND "returned_base_quantity" <= "received_base_quantity"
    AND "returned_amount" <= "billed_amount"
  );
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_billing_valid" CHECK (
    "billed_total" >= 0 AND "returned_total" >= 0 AND "returned_total" <= "billed_total"
    AND "additional_costs" >= 0
  );
ALTER TABLE "purchase_return_items"
  ADD CONSTRAINT "purchase_return_items_valid" CHECK ("quantity" > 0 AND "base_quantity" > 0 AND "line_total" >= 0);
ALTER TABLE "purchase_returns"
  ADD CONSTRAINT "purchase_returns_total_nonneg" CHECK ("total" >= 0);
ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_valid" CHECK ("payment_terms_days" IS NULL OR "payment_terms_days" BETWEEN 0 AND 365);

-- 4. One live supplier per name (ignoring case) in a shop: stops accidental duplicates.
CREATE UNIQUE INDEX "suppliers_org_name_unique"
  ON "suppliers" ("organization_id", lower("name")) WHERE "deleted_at" IS NULL;

-- 5. Purchases and returns are never deleted (cancel or return instead).
CREATE TRIGGER purchases_no_delete
  BEFORE DELETE ON "purchases"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
-- Lines of a DRAFT can be replaced while editing; once a purchase is confirmed or received its lines are permanent.
CREATE OR REPLACE FUNCTION ksms_purchase_item_delete_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "purchases" WHERE "id" = OLD."purchase_id" AND "status" <> 'DRAFT') THEN
    RAISE EXCEPTION 'Lines of a purchase that is no longer a draft cannot be deleted'
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_items_delete_guard
  BEFORE DELETE ON "purchase_items"
  FOR EACH ROW EXECUTE FUNCTION ksms_purchase_item_delete_guard();
CREATE TRIGGER purchase_returns_no_delete
  BEFORE DELETE ON "purchase_returns"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER purchase_return_items_no_delete
  BEFORE DELETE ON "purchase_return_items"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER purchase_payments_no_delete
  BEFORE DELETE ON "purchase_payments"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER suppliers_no_delete
  BEFORE DELETE ON "suppliers"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
