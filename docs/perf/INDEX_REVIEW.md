# Index review (FIXES F22, 2026-11-26)

**Outcome: no index added or dropped.** The rules in FIXES.md are "a dropped index needs proof it is unused or
fully covered" and "an added index needs a 2x gain on its target query". Neither can be shown yet.

## What was measured

`node scripts/perf/index-usage.js apps/api` against production (read-only `pg_stat_user_indexes`):

| Table                 | Live rows |
| --------------------- | --------- |
| products              | 72        |
| sales / sale_items    | 24 / 34   |
| stock_movements       | 115       |
| payments              | 29        |
| customers / suppliers | 5 / 2     |
| inventory_batches     | 0         |

| Candidate from FIXES F22                                                                           | Scans                              | Verdict                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `products_organization_id_status_idx`                                                              | 0                                  | keep: tables this small are always read by sequential scan, so 0 scans says nothing                                          |
| `customers_organization_id_name_idx`                                                               | 331                                | keep: used (customer list ordered by name)                                                                                   |
| `suppliers_organization_id_name_idx` vs `suppliers_org_name_unique`                                | 0 vs 615                           | keep both for now: the unique index enforces one live name per shop, the plain one serves `ORDER BY name`; revisit with data |
| `inventory_batches_organization_id_expiry_date_idx` vs partial `inventory_batches_open_expiry_idx` | 207 vs 0                           | keep: no batches exist yet                                                                                                   |
| add `sale_items(sale_id, product_id)`                                                              | `sale_items_sale_id_idx` 955 scans | not needed: the sale-id index already serves the report joins                                                                |
| add `payments(organization_id, paid_at)`                                                           | branch index 9 scans               | not needed: reports filter by branch, covered by `(organization_id, branch_id, paid_at)`                                     |

74 of 169 indexes have 0 scans, which is expected at this size and is not evidence for dropping them.

## When to look again

Re-run `scripts/perf/index-usage.js` after about three months of real trading, or once `sales` passes
~20,000 rows. Then, for each candidate, compare `EXPLAIN (ANALYZE, BUFFERS)` before and after on a copy (a Neon
branch), ship each add or drop as its own small migration, and check `sales` / `stock_movements` insert latency
stays within 5%. The search and deep-page measurements behind F10 and F12 are in `scripts/perf/search-plans.js`
and `scripts/perf/deep-pages.js` (they run on a throwaway schema and drop it afterwards).
