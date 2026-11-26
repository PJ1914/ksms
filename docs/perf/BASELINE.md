# Performance baseline and results (FIXES.md, 2026-11-26)

## How these were measured, and what was not

- **Database plans**: `EXPLAIN (ANALYZE, BUFFERS)` on a throwaway schema inside the production Neon project
  (Singapore), all migrations applied, seeded with 50,000 products / 20,000 customers in one shop. Scripts:
  `scripts/perf/search-plans.js`, `scripts/perf/deep-pages.js` (they drop their schema afterwards).
- **Query counts**: from the code paths (each query is a line in the service), confirmed by the integration
  tests that exercise them.
- **Not done**: the HTTP load test (k6 / autocannon p50/p95 per endpoint) from "How to measure". The
  development PC sits in India, ~70 ms from the Singapore database, has no free disk for a local Postgres,
  and its runs would measure the network rather than the code. Run it from a machine next to the database
  (or on Render) before quoting latency gains; the database-side numbers below are the reliable part.

## Results

| Fix                        | Before                                                                      | After                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| F2 gzip                    | 200-product sync page (synthetic but realistic fields): 140 KB              | 4.3 KB (-97 %); real catalogues are less repetitive, expect 80-95 %. Bodies under 1 KB and PDFs are not compressed (e2e test) |
| F7 auth cache              | 2 queries per authenticated request (session + membership)                  | 0 on a cache hit for GET/HEAD (e2e test asserts no session/member query); writes unchanged                                    |
| F8 checkout pricing        | 1 full product load per bill line (conversions, prices, barcodes, category) | 1 query per bill                                                                                                              |
| F9 stock issue             | ~5 queries per untracked product, more with batches (20-product bill ~100)  | 6-7 per bill whatever its length                                                                                              |
| F10 search, 50k products   | name/local name/SKU: 32.5 ms seq scan; API list shape 33.7 ms               | 0.16 ms (BitmapOr over trigram indexes); API list shape 1.2 ms                                                                |
| F10 writes                 | 500 product inserts 95 ms                                                   | 106 ms (+11 %, network noise of the same order)                                                                               |
| F11 category filter        | all categories of the shop loaded per request                               | 1 recursive query                                                                                                             |
| F12 deep page (row 49,975) | OFFSET: 43.5 ms                                                             | keyset: 0.10 ms (= page 1)                                                                                                    |
| F12 totals                 | `count(*)` 12.4 ms on 50k                                                   | capped count 3.3 ms                                                                                                           |
| F3 pool                    | pg default 10 connections, no connect timeout                               | 5 per instance, 10 s connect timeout                                                                                          |
| F4 storage                 | idempotency keys (full sale JSON), sessions, notifications never deleted    | purged daily in batches of 1,000                                                                                              |
| F6 logs                    | one line per health probe                                                   | none                                                                                                                          |
