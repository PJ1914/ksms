-- FIXES F15: an Idempotency-Key is replayed only to the user who first sent it.
-- Nullable so keys stored before this migration keep working until they expire (24 h).
ALTER TABLE "idempotency_records" ADD COLUMN "user_id" UUID;
