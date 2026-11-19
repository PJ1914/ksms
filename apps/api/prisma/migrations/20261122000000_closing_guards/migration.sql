-- Phase 12 audit: the database itself protects a closed cash day.
-- Rollback: DROP TRIGGER daily_closings_closed_immutable, daily_closings_no_truncate ON "daily_closings";
--           DROP TRIGGER cashbook_entries_closed_day ON "cashbook_entries";
--           DROP FUNCTION ksms_closed_day_immutable(), ksms_cashbook_closed_day().
-- Risk: none for existing rows (triggers act on new writes only).

-- 1. A CLOSED daily closing is history: it cannot be edited or deleted. (An unfinished one may still be closed:
--    only rows that are already CLOSED are protected.)
CREATE OR REPLACE FUNCTION ksms_closed_day_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'a closed daily closing cannot be changed or deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER daily_closings_closed_immutable
  BEFORE UPDATE OR DELETE ON "daily_closings"
  FOR EACH ROW EXECUTE FUNCTION ksms_closed_day_immutable();
CREATE TRIGGER daily_closings_no_truncate
  BEFORE TRUNCATE ON "daily_closings"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();

-- 2. No cash line can be added to a day that is already closed. The register row is share-locked first, so a
--    closing in progress (which holds it exclusively) and a new line queue up instead of racing: a line can never
--    slip in after the day's figures were taken.
CREATE OR REPLACE FUNCTION ksms_cashbook_closed_day() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM "cash_registers" WHERE "id" = NEW."register_id" FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM "daily_closings"
    WHERE "register_id" = NEW."register_id"
      AND "business_date" = NEW."business_date"
      AND "status" = 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'the cash register is already closed for %', NEW."business_date"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cashbook_entries_closed_day
  BEFORE INSERT ON "cashbook_entries"
  FOR EACH ROW EXECUTE FUNCTION ksms_cashbook_closed_day();
