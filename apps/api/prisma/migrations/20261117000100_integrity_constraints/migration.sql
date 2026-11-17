-- Integrity rules Prisma cannot express: CHECK constraints and append-only triggers.
-- Reversible by dropping the named triggers/constraints (see docs/database/MIGRATIONS.md).
-- Risk: append-only triggers block UPDATE/DELETE/TRUNCATE on history tables by design.
--       Test DB resets must use `DROP SCHEMA ... CASCADE` / migrate reset, never TRUNCATE.

-- ---------------------------------------------------------------------------
-- 1. Append-only history tables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ksms_prevent_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only (create a reversing entry instead)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER stock_movements_no_truncate
  BEFORE TRUNCATE ON "stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();

CREATE TRIGGER customer_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON "customer_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER customer_ledger_entries_no_truncate
  BEFORE TRUNCATE ON "customer_ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();

CREATE TRIGGER supplier_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON "supplier_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER supplier_ledger_entries_no_truncate
  BEFORE TRUNCATE ON "supplier_ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();

CREATE TRIGGER cashbook_entries_append_only
  BEFORE UPDATE OR DELETE ON "cashbook_entries"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER cashbook_entries_no_truncate
  BEFORE TRUNCATE ON "cashbook_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();

-- Completed sales and issued invoices are never deleted (status changes only).
CREATE TRIGGER sales_no_delete
  BEFORE DELETE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER sale_items_no_delete
  BEFORE DELETE ON "sale_items"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER invoices_no_delete
  BEFORE DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER payments_no_delete
  BEFORE DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();

-- Invoice content snapshot is immutable once issued (status/pdf_key may change).
CREATE OR REPLACE FUNCTION ksms_invoice_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."invoice_number" IS DISTINCT FROM OLD."invoice_number"
     OR NEW."sequence_number" IS DISTINCT FROM OLD."sequence_number"
     OR NEW."series" IS DISTINCT FROM OLD."series"
     OR NEW."seller_snapshot" IS DISTINCT FROM OLD."seller_snapshot"
     OR NEW."buyer_snapshot" IS DISTINCT FROM OLD."buyer_snapshot"
     OR NEW."totals_snapshot" IS DISTINCT FROM OLD."totals_snapshot"
     OR NEW."sale_id" IS DISTINCT FROM OLD."sale_id" THEN
    RAISE EXCEPTION 'invoice snapshot fields are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_snapshot_immutable
  BEFORE UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION ksms_invoice_snapshot_immutable();

-- ---------------------------------------------------------------------------
-- 2. CHECK constraints
-- ---------------------------------------------------------------------------
-- NOTE: inventory_balances.quantity_on_hand intentionally has NO >= 0 check, because an
-- audited Owner/Manager override may allow negative stock. The application's conditional
-- UPDATE enforces non-negative stock by default; reconciliation tests verify it.
ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_reserved_nonneg" CHECK ("reserved_qty" >= 0);
ALTER TABLE "inventory_batches"
  ADD CONSTRAINT "inventory_batches_qty_nonneg" CHECK ("quantity_on_hand" >= 0);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_qty_nonzero" CHECK ("quantity" <> 0),
  ADD CONSTRAINT "stock_movements_sign_matches_type" CHECK (
    ("type" IN ('OPENING','PURCHASE_RECEIPT','SALE_RETURN','ADJUSTMENT_IN','TRANSFER_IN') AND "quantity" > 0)
    OR ("type" IN ('SALE','PURCHASE_RETURN','ADJUSTMENT_OUT','DAMAGE','EXPIRY','TRANSFER_OUT') AND "quantity" < 0)
    OR "type" = 'CANCELLATION_REVERSAL'
  );

ALTER TABLE "product_unit_conversions"
  ADD CONSTRAINT "product_unit_conversions_factor_pos" CHECK ("factor_to_base" > 0);
ALTER TABLE "product_unit_prices"
  ADD CONSTRAINT "product_unit_prices_valid" CHECK ("price" >= 0 AND "quantity" > 0);
ALTER TABLE "products"
  ADD CONSTRAINT "products_valid" CHECK (
    "min_stock_level" >= 0 AND ("mrp" IS NULL OR "mrp" >= 0)
    AND ("gst_rate_percent" IS NULL OR "gst_rate_percent" BETWEEN 0 AND 100)
  );

ALTER TABLE "purchase_items"
  ADD CONSTRAINT "purchase_items_valid" CHECK (
    "quantity" > 0 AND "base_quantity" > 0 AND "conversion_factor_snapshot" > 0
    AND "received_base_quantity" >= 0 AND "received_base_quantity" <= "base_quantity"
    AND "unit_cost" >= 0 AND "discount_amount" >= 0
  );
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_valid" CHECK ("total" >= 0 AND "subtotal" >= 0 AND "discount_total" >= 0);

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_valid" CHECK (
    "total" >= 0 AND "paid_total" >= 0 AND "credit_amount" >= 0 AND "discount_total" >= 0
    AND "paid_total" + "credit_amount" = "total"
  );
ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_valid" CHECK (
    "quantity" > 0 AND "base_quantity" > 0 AND "conversion_factor_snapshot" > 0
    AND "unit_price" >= 0 AND "discount_amount" >= 0 AND "line_total" >= 0
    AND "tax_rate_percent" BETWEEN 0 AND 100
    AND "returned_base_quantity" >= 0 AND "returned_base_quantity" <= "base_quantity"
  );
ALTER TABLE "sale_payments"
  ADD CONSTRAINT "sale_payments_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "purchase_payments"
  ADD CONSTRAINT "purchase_payments_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "sale_return_items"
  ADD CONSTRAINT "sale_return_items_valid" CHECK ("quantity" > 0 AND "base_quantity" > 0 AND "line_total" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "customer_ledger_entries"
  ADD CONSTRAINT "customer_ledger_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "supplier_ledger_entries"
  ADD CONSTRAINT "supplier_ledger_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "cashbook_entries"
  ADD CONSTRAINT "cashbook_amount_nonzero" CHECK ("amount" <> 0);

ALTER TABLE "document_sequences"
  ADD CONSTRAINT "document_sequences_next_pos" CHECK ("next_number" >= 1);
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_credit_limit_nonneg" CHECK ("credit_limit" IS NULL OR "credit_limit" >= 0);

-- ---------------------------------------------------------------------------
-- 3. Extra indexes Prisma cannot declare
-- ---------------------------------------------------------------------------
-- Fast active-product lookups (excludes soft-deleted rows).
CREATE INDEX "products_active_name_idx" ON "products" ("organization_id", "name") WHERE "deleted_at" IS NULL;
-- Open batches with expiry, for FEFO and expiry alerts.
CREATE INDEX "inventory_batches_open_expiry_idx"
  ON "inventory_batches" ("organization_id", "branch_id", "product_id", "expiry_date")
  WHERE "status" = 'ACTIVE' AND "quantity_on_hand" > 0;
