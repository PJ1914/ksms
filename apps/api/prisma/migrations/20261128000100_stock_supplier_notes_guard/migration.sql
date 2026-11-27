-- Stock supplier notes are history: block UPDATE/DELETE/TRUNCATE (reuses ksms_prevent_modification()).
-- Risk: none for existing data; the table is new and empty.
CREATE TRIGGER stock_supplier_notes_append_only
  BEFORE UPDATE OR DELETE ON "stock_supplier_notes"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER stock_supplier_notes_no_truncate
  BEFORE TRUNCATE ON "stock_supplier_notes"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();
