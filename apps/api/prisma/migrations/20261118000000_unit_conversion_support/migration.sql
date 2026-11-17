-- Phase 6: unit conversion support and the global unit list.
-- Rollback: DROP the seeded rows (if unused), then the constraints and columns named below.
-- Risk: additive only. Seed rows use ON CONFLICT DO NOTHING so re-running is safe.

ALTER TABLE "units_of_measurement"
  ADD COLUMN "is_packaging" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "standard_factor" DECIMAL(18,6);

ALTER TABLE "products"
  ADD COLUMN "min_sale_increment" DECIMAL(14,3);

-- A unit is EITHER a standard unit with a known size OR a packaging unit sized per product.
ALTER TABLE "units_of_measurement"
  ADD CONSTRAINT "units_factor_matches_kind" CHECK (
    ("is_packaging" = true AND "standard_factor" IS NULL)
    OR ("is_packaging" = false AND "standard_factor" IS NOT NULL AND "standard_factor" > 0)
  );

ALTER TABLE "products"
  ADD CONSTRAINT "products_min_sale_increment_pos" CHECK ("min_sale_increment" IS NULL OR "min_sale_increment" > 0);

-- Global units. standard_factor is relative to the canonical unit of the dimension (KG, L, PCS).
-- Packaging units are COUNT-dimension containers whose content is defined per product (1 BAG = 25 KG).
INSERT INTO "units_of_measurement" ("id", "code", "name", "dimension", "is_packaging", "standard_factor") VALUES
  (gen_random_uuid(), 'KG',      'Kilogram',  'WEIGHT', false, 1),
  (gen_random_uuid(), 'G',       'Gram',      'WEIGHT', false, 0.001),
  (gen_random_uuid(), 'MG',      'Milligram', 'WEIGHT', false, 0.000001),
  (gen_random_uuid(), 'QUINTAL', 'Quintal',   'WEIGHT', false, 100),
  (gen_random_uuid(), 'TON',     'Tonne',     'WEIGHT', false, 1000),
  (gen_random_uuid(), 'L',       'Litre',     'VOLUME', false, 1),
  (gen_random_uuid(), 'ML',      'Millilitre','VOLUME', false, 0.001),
  (gen_random_uuid(), 'PCS',     'Piece',     'COUNT',  false, 1),
  (gen_random_uuid(), 'DOZEN',   'Dozen',     'COUNT',  false, 12),
  (gen_random_uuid(), 'BAG',     'Bag',       'COUNT',  true,  NULL),
  (gen_random_uuid(), 'SACK',    'Sack',      'COUNT',  true,  NULL),
  (gen_random_uuid(), 'CARTON',  'Carton',    'COUNT',  true,  NULL),
  (gen_random_uuid(), 'BOX',     'Box',       'COUNT',  true,  NULL),
  (gen_random_uuid(), 'PACK',    'Pack',      'COUNT',  true,  NULL),
  (gen_random_uuid(), 'CAN',     'Can',       'COUNT',  true,  NULL),
  (gen_random_uuid(), 'TIN',     'Tin',       'COUNT',  true,  NULL),
  (gen_random_uuid(), 'BOTTLE',  'Bottle',    'COUNT',  true,  NULL),
  (gen_random_uuid(), 'JAR',     'Jar',       'COUNT',  true,  NULL),
  (gen_random_uuid(), 'POUCH',   'Pouch',     'COUNT',  true,  NULL),
  (gen_random_uuid(), 'CRATE',   'Crate',     'COUNT',  true,  NULL)
ON CONFLICT ("code") DO NOTHING;
