-- Support (ADMIN_PANEL.md Phase D): rules Prisma cannot express and seed rows.
-- Reversible by dropping the named triggers/constraints and deleting the seed rows.
-- Risk: ticket_messages becomes append-only.

ALTER TABLE "ticket_messages"
  ADD CONSTRAINT "ticket_messages_sender_type_check"
    CHECK ("sender_type" IN ('VENDOR', 'STAFF', 'ADMIN', 'SUPPORT', 'SYSTEM')),
  ADD CONSTRAINT "ticket_messages_body_check" CHECK (length("body") BETWEEN 1 AND 5000);
ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_subject_check" CHECK (length("subject") BETWEEN 3 AND 200);
ALTER TABLE "support_settings"
  ADD CONSTRAINT "support_settings_single_row_check" CHECK ("id" = 1);

CREATE TRIGGER ticket_messages_append_only
  BEFORE UPDATE OR DELETE ON "ticket_messages"
  FOR EACH ROW EXECUTE FUNCTION ksms_prevent_modification();
CREATE TRIGGER ticket_messages_no_truncate
  BEFORE TRUNCATE ON "ticket_messages"
  FOR EACH STATEMENT EXECUTE FUNCTION ksms_prevent_modification();

-- The single settings row, empty until the admin fills it in.
INSERT INTO "support_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- New shop permissions (Owner has every permission; staff only if the owner grants them).
INSERT INTO "permissions" ("id", "key", "module", "description") VALUES
  (gen_random_uuid(), 'support.create', 'support', 'Raise support tickets and see your own'),
  (gen_random_uuid(), 'support.read', 'support', 'See every support ticket of the shop')
ON CONFLICT ("key") DO NOTHING;
