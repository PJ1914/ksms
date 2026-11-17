# Product Catalogue and Unit Conversion Engine

Phase 6. Code: `apps/api/src/modules/catalog/`. The rules live in pure functions (`domain/units.ts`, `domain/pricing.ts`, 36 unit tests) so billing and purchasing reuse exactly the same arithmetic.

## 1. Core idea

Every product has **one canonical base unit**. All stock is stored in that unit, with at most 3 decimals. Every other unit the shop uses (bags, grams, cartons...) is a **conversion factor to the base unit, stored per product**.

| Example                  | Product type | Base unit | Other units                                        |
| ------------------------ | ------------ | --------- | -------------------------------------------------- |
| Loose rice               | WEIGHT       | KG        | G (auto, 0.001), BAG (you say: 25), QUINTAL (auto) |
| Loose oil                | VOLUME       | L         | ML (auto), CAN (you say: 15)                       |
| Packaged oil, 1 L bottle | COUNT        | PCS       | CARTON (you say: 12), DOZEN (auto, 12)             |
| Milk 500 ml and Milk 1 L | COUNT        | PCS       | two separate SKUs, each with its own barcode       |

Purchasing 5 bags of 25 kg adds `5 x 25 = 125 KG` to stock; selling 2 kg and 500 g takes `2 + 0.5 = 2.5 KG` away.

## 2. Units

`units_of_measurement` is a **global** list, seeded by migration `20261118000000_unit_conversion_support` (KG, G, MG, QUINTAL, TON, L, ML, PCS, DOZEN, BAG, SACK, CARTON, BOX, PACK, CAN, TIN, BOTTLE, JAR, POUCH, CRATE). Each unit is one of two kinds, enforced by a database CHECK:

- **Standard unit**: has a `standard_factor` relative to its dimension's canonical unit (KG = 1, G = 0.001, QUINTAL = 100, L = 1, ML = 0.001, PCS = 1, DOZEN = 12). Conversion between two standard units of the same dimension is derived automatically (G to KG = 0.001; for a product whose base is G, KG = 1000).
- **Packaging unit** (`is_packaging`): no universal size. The shop must say what one contains **for that product** (1 BAG = 25 KG). They are COUNT-dimension containers usable with any product type.

## 3. The rules (all enforced server-side)

1. A **base unit** must be a standard unit of the product's own dimension (a weight product cannot have BAG or L as its base).
2. **Weight is never converted to volume** (or to count) without density. A unit of another dimension is refused with `UNIT_DIMENSION_MISMATCH`; packaging units are the only cross-dimension exception because their size is stated explicitly.
3. A standard unit's factor is derived. If the client also sends one it must agree (`CONVERSION_MISMATCH`), so a typo cannot corrupt the maths.
4. Packaging needs an explicit positive factor (`CONVERSION_FACTOR_REQUIRED`).
5. **COUNT products are sold in whole pieces** unless `allowFractional` is switched on (`FRACTIONAL_NOT_ALLOWED`). Half a dozen is fine (6 pieces); half a piece is not. A carton of a whole-piece product must also hold a whole number of pieces.
6. Quantities are converted to base units **exactly** (decimal arithmetic) and **never rounded**: half a gram of a kg product would be 0.0005 kg, finer than the 3-decimal stock precision, so it is refused (`QUANTITY_PRECISION`) instead of silently changing the amount.
7. An optional **minimum sale step** (e.g. 0.050 kg) rejects quantities that are not a multiple of it (`INCREMENT_VIOLATION`).
8. **Type and base unit cannot be edited** after creation (they define what every stock number means). A mistaken product with no history is deleted and recreated.
9. Every product always has its base unit (factor 1), which must stay sale-enabled.

## 4. Purchase and sale units

Each conversion has `isPurchaseUnit` and `isSaleUnit`. Defaults when not stated: the base unit is both; other standard units are sale units; packaging units are purchase units. Only sale-enabled units can carry a price or be quoted. Purchasing (Phase 8) will accept only purchase-enabled units.

## 5. Prices

A **price point** says "this quantity of this unit costs this much": `1 KG = 58.00`, `500 G = 30.00`. `priceForQuantity` resolves a price in a fixed, predictable order and never guesses:

1. **EXACT**: a price point for exactly this unit and quantity (500 g = 30 even though 58 x 0.5 = 29).
2. **UNIT_PRICE**: the price of 1 of this unit, multiplied (2 kg = 116).
3. **DERIVED_FROM_BASE**: the price of 1 base unit scaled by the conversion (250 g = 14.50).
4. Otherwise `PRICE_NOT_CONFIGURED`.

Amounts are rounded **half-up to paise** and the response says when rounding changed the value. Final bill rounding (round-off) and tax are Phase 10. `mrp` is stored per base unit.

`GET /products/:id/quote?unitId=&quantity=` runs the real conversion, quantity and pricing rules and is what the POS will use for previews.

## 6. History is never rewritten

- Conversions and prices on the product are **current settings only**. Purchase and sale lines (Phases 8-9) copy the factor, unit code and price at the moment of the transaction (`snapshotConversion` produces an immutable copy), so editing "1 BAG = 25 KG" to 30 later changes only future transactions.
- Every change to conversions, prices, barcodes or product fields is written to the audit log with before and after (e.g. BAG 25.000000 to 30.000000).
- A product that has stock movements, purchases or sales **cannot be deleted** (`PRODUCT_HAS_HISTORY`); mark it `DISCONTINUED`. Deleting an unused product is a soft delete that frees its barcodes (the SKU stays reserved).

## 7. API summary

| Route                                                                                    | Permission        |
| ---------------------------------------------------------------------------------------- | ----------------- |
| `GET /units`, `GET /categories`                                                          | `product.read`    |
| `POST/PATCH/DELETE /categories[/:id]`                                                    | `category.manage` |
| `GET /products` (q, categoryId, status, type, sort, order, page, pageSize, updatedSince) | `product.read`    |
| `GET /products/:id`, `/products/by-barcode/:barcode`, `/products/:id/quote`              | `product.read`    |
| `POST /products`, `PATCH/DELETE /products/:id`                                           | `product.manage`  |
| `POST/PATCH/DELETE /products/:id/conversions[/:unitId]`                                  | `product.manage`  |
| `PUT /products/:id/prices`                                                               | `product.manage`  |
| `POST/DELETE /products/:id/barcodes[/:barcodeId]`                                        | `product.manage`  |

- Money and quantities are decimal strings (`"58.00"`, `"0.500"`); JSON numbers are rejected.
- `POST /products` creates the product with its conversions, prices and barcodes **atomically**; if the SKU is omitted a unique `P` + 7 characters is generated.
- Every product has a `version`; `PATCH` accepts the version you loaded and returns `409 VERSION_CONFLICT` if another device changed it. Child changes (prices, conversions, barcodes) also bump the version, so `updatedSince` delta sync picks them up.
- Domain rule violations return **422** with the stable codes above.
- Categories nest 3 levels deep; sibling names are unique ignoring case; cycles and non-empty deletes are refused.

## 8. Not yet in this phase

- Product images (R2 upload) come with the file-storage work in Phase 15/17; `image_key` exists.
- Batch and expiry data are managed in Phase 7 (inventory); the `track_batch` / `track_expiry` switches exist now.
- GST fields (`hsn_code`, `gst_rate_percent`, `tax_mode`) are stored and validated here but used by the billing engine in Phase 10.
- Low-stock and expiring-product filters need inventory balances (Phase 7).
