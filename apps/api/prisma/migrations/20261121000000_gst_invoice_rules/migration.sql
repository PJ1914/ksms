-- Phase 10 audit: database rules for GST invoices and credit notes.
-- Rollback: drop the two constraints, then restore ksms_invoice_snapshot_immutable() from migration
-- 20261117000100_integrity_constraints.
-- Risk: none for existing rows. The number-format constraints are NOT VALID, so they apply to every NEW row and are
-- not checked against rows that already exist (older "INV/2026-27/000001" style numbers stay readable).

-- 1. GST Rule 46 / 53: an invoice or credit note number is at most 16 characters of letters, digits, "-" and "/".
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_number_rule" CHECK ("invoice_number" ~ '^[A-Za-z0-9/-]{1,16}$') NOT VALID;
ALTER TABLE "sale_returns"
  ADD CONSTRAINT "sale_returns_number_rule" CHECK ("return_number" ~ '^[A-Za-z0-9/-]{1,16}$') NOT VALID;

-- 2. An issued invoice is a legal document: besides its number, series, snapshots and sale, its TYPE (tax invoice or
--    bill of supply), issue date and owner can no longer change. Only the status (issued -> cancelled) and the
--    archived PDF key may.
CREATE OR REPLACE FUNCTION ksms_invoice_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."invoice_number" IS DISTINCT FROM OLD."invoice_number"
     OR NEW."sequence_number" IS DISTINCT FROM OLD."sequence_number"
     OR NEW."series" IS DISTINCT FROM OLD."series"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
     OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
     OR NEW."branch_id" IS DISTINCT FROM OLD."branch_id"
     OR NEW."seller_snapshot" IS DISTINCT FROM OLD."seller_snapshot"
     OR NEW."buyer_snapshot" IS DISTINCT FROM OLD."buyer_snapshot"
     OR NEW."totals_snapshot" IS DISTINCT FROM OLD."totals_snapshot"
     OR NEW."sale_id" IS DISTINCT FROM OLD."sale_id" THEN
    RAISE EXCEPTION 'invoice snapshot fields are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- a cancelled invoice stays cancelled
  IF OLD."status" = 'CANCELLED' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'a cancelled invoice cannot be reopened'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
