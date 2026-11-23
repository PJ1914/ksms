# Test Results

## Phase 4 — Backend foundation (2026-11-18)

| Suite                                                | Result                                      |
| ---------------------------------------------------- | ------------------------------------------- |
| API unit (`pnpm test`)                               | 6 / 6 pass                                  |
| API e2e, DB mocked                                   | 29 / 29 pass (foundation 27 + rate limit 2) |
| API integration, **real Neon via pooled URL**        | 4 / 4 pass                                  |
| Packages (validation 4, api-client 2) and mobile (3) | 9 / 9 pass                                  |
| Mutation check: ignore session revocation            | caught (1 failing test)                     |
| Mutation check: skip branch-assignment check         | caught (1 failing test)                     |

Integration evidence (risk R-07, `pooled-locking.int-spec.ts`), through the same pooled URL the API uses:

- 25 concurrent `SELECT … FOR UPDATE` read-modify-write transactions → counter exactly 25 (no lost updates).
- 20 concurrent conditional decrements on stock 5 → exactly 5 succeed, stock ends at 0 (no oversell).
- 15 concurrent `pg_advisory_xact_lock` sections → exactly 15 increments.
- Failed transaction rolls back completely.

Finding: Prisma's default transaction start timeout (2 s) is too short when checkouts queue behind a lock on a remote database. The API now sets `maxWait` 15 s / `timeout` 20 s (`TRANSACTION_OPTIONS`).

Manual run against Neon: `/health/ready` → `{"data":{"status":"ok","database":"up"}}`; unauthenticated `/context` → 401 standard error with echoed correlation id; Swagger lists all routes; a fake bearer token never appears in logs.

Not verified: Swagger UI rendering in a browser; GitHub Actions (account billing lock, see phase report).

## Phase 5 — Authentication, users and RBAC (2026-11-18)

| Suite                                                                         | Result                                                                            |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Unit (API 9, validation 17, api-client 2, mobile 3)                           | 31 / 31 pass                                                                      |
| API e2e, DB mocked (foundation + RBAC default-deny + rate limit)              | 37 / 37 pass                                                                      |
| **Identity integration on a real PostgreSQL schema** (all migrations applied) | **42 / 42 pass** (about 4.5 min against remote Neon; seconds on a local database) |
| `pnpm check`                                                                  | exit 0                                                                            |

The integration suite covers: owner registration (atomic setup, duplicate and rollback, validation, phone formats), login (phone or email, no account enumeration), refresh rotation and theft detection, concurrent refresh, expired sessions, logout, password change, devices, invitations (one-time code, hashed, expiry, revoke, concurrent acceptance, multi-shop accounts), RBAC for Cashier, Manager and Collection Agent, custom roles with immediate effect, privilege escalation, Owner and system role protection, deactivation (immediate sign-out), branch assignment, organization settings, **cross-organization isolation (shop A against shop B across every route)**, the audit trail, and database-level audit immutability. Credential rate limiting is tested separately.

Mutation checks (a rule is deliberately broken, a test must fail, then the code is restored byte-for-byte):

| Broken rule                                                     | Caught by               |
| --------------------------------------------------------------- | ----------------------- |
| Employee lookups ignore the organization (cross-tenant leak)    | cross-organization test |
| Privilege-escalation check removed                              | escalation test         |
| Deactivation does not revoke sessions                           | deactivation test       |
| Routes without a permission policy allowed (fail open)          | default-deny test       |
| Reuse of a rotated refresh token no longer revokes              | rotation test           |
| (Phase 4) session revocation ignored; branch assignment ignored | foundation tests        |

Cleanup verified: no leftover test schemas in Neon, and the real tables still hold 0 rows.

## Phase 6 — Product catalogue and unit conversion (2026-11-18)

| Suite                                                                            | Result                             |
| -------------------------------------------------------------------------------- | ---------------------------------- |
| Conversion and pricing engine unit tests (pure functions)                        | 36 / 36 pass                       |
| All other unit tests (API 9, validation 17, api-client 2, mobile 3)              | 31 / 31 pass                       |
| API e2e, DB mocked                                                               | 37 / 37 pass                       |
| **Catalogue integration on a real PostgreSQL schema** (all 3 migrations applied) | **48 / 48 pass** (see note)        |
| Identity integration (unchanged)                                                 | 42 / 42 pass in the previous phase |

Note: the first full catalogue run passed 44 of 48; the four failures were mistakes in the test data (a one-letter product name, a barcode prefix typo, and pricing a weight product in pieces), not product defects. After fixing the tests, the affected groups were re-run (29 / 29) and the other 19 tests had already passed. The complete suite runs again in CI on a clean PostgreSQL 17.

The catalogue integration suite covers the specification's examples (loose rice with 25 kg bags and 500 g price point, loose oil with a 15 L can, packaged oil with a carton of 12 and whole-pieces-only, milk 500 ml and 1 L as separate SKUs, the 50 g sale step), 24 rule-violation cases, SKU and barcode uniqueness and scanning, versioned edits, conversion and price changes with audit before/after, atomic price replacement, history protection, search (name, SKU, barcode prefix), filters, server-side pagination and sorting, delta sync, the category tree, permissions for Cashier / Collection Agent / Manager, and **cross-organization isolation across every route**.

Mutation checks (a rule is deliberately broken, a test must fail, then the code is restored byte-for-byte):

| Broken rule                                                         | Caught by                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Weight to volume conversion allowed (both dimension checks removed) | engine unit tests (a single removed check is covered by the second layer, by design) |
| Fractional quantity rounded instead of refused                      | engine unit tests                                                                    |
| Fractional pieces allowed for whole-number products                 | engine unit tests                                                                    |
| Exact price point ignored                                           | pricing unit tests                                                                   |
| Price rounding changed from half-up to truncation                   | pricing unit tests                                                                   |
| Product lookups ignore the organization (cross-tenant leak)         | cross-organization integration test                                                  |
| History check on deletion disabled                                  | history integration test                                                             |
| Version conflict check disabled                                     | versioning integration test                                                          |

Two of my first mutation attempts were invalid (a syntax error from a wrong edit); they were redone correctly and are not counted above.

Not yet verifiable in this phase: that **sale and purchase lines keep their own conversion snapshot**. The engine produces an immutable snapshot (tested), but no purchase or sale lines exist yet. This is re-verified end to end in Phases 8 and 9.

Neon after the run: migration applied, 20 global units seeded, no leftover test schemas, real tables still empty.

## Phase 7 — Inventory engine (2026-11-18)

| Suite                                                                         | Result           |
| ----------------------------------------------------------------------------- | ---------------- |
| Stock rules unit tests (weighted average, FEFO allocation, expiry, valuation) | 15 / 15 pass     |
| All API unit tests (including the above)                                      | 60 / 60 pass     |
| Other unit tests (validation 17, api-client 2, mobile 3)                      | 22 / 22 pass     |
| API e2e, DB mocked                                                            | 37 / 37 pass     |
| **Inventory integration on a real PostgreSQL schema (Neon)**                  | **26 / 26 pass** |

The first integration run failed because hand-written SQL (row locks, idempotency claims) ran in the default `public` schema instead of the isolated test schema. This was a test-setup defect: the database connection now sets `search_path` for test schemas, and a new test proves raw SQL runs inside the test schema. The real tables were checked and were never written to.

The inventory suite covers the specification example (opening 100 kg at 50, purchase 25 at 60, sale 2, damage 1 → 122 kg, average 52, value 6344, cost of goods 104.00), opening stock entered in bags, opening stock locked after real activity, negative-stock refusal and the audited override (shop setting + permission + reason), **20 simultaneous sales of the last 5 units (exactly 5 succeed, never below zero)**, mixed concurrent receipts and sales, concurrent weighted average, FEFO and expired-stock handling, concurrent sales of a batch-tracked product, idempotent retries (including 5 simultaneous double-taps applied once), validation, stock views (low stock, valuation, expiring, cost hidden from cashiers), reconciliation detecting a tampered balance, permissions, branch isolation, **cross-organization isolation**, and append-only movements with audit.

Mutation checks (a rule is deliberately broken, a test must fail, then the code is restored byte-for-byte):

| Broken rule                                              | Caught by                                  |
| -------------------------------------------------------- | ------------------------------------------ |
| FEFO order reversed (latest expiry sold first)           | stock rules unit tests (2 failures)        |
| Expired batches no longer skipped when selling           | stock rules unit tests                     |
| Balance row lock (`FOR UPDATE`) removed                  | concurrency integration tests (5 failures) |
| Negative-stock check removed                             | negative-stock integration tests (3)       |
| Idempotency claim ignored (duplicates run again)         | idempotency integration tests (2)          |
| Organization filter removed from the stock balances list | isolation integration tests (2)            |

One mutation attempt (idempotency) was invalid at first because it stopped the code compiling; it was redone correctly and is counted above.

Neon after the runs: no leftover test schemas, real tables still empty.

## Early mobile slice: sign-in and products on the phone (2026-11-18)

| Suite                                                                                       | Result          |
| ------------------------------------------------------------------------------------------- | --------------- |
| Quick-add product rules (shared `@ksms/validation`: name and price checks, payload builder) | 11 / 11 pass    |
| Mobile error messages (wrong password, field errors, rate limit, offline)                   | 6 / 6 pass      |
| **Mobile flow on a real PostgreSQL schema**: the app's exact calls, end to end              | **1 / 1 pass**  |
| Android bundle (`expo export`)                                                              | builds          |
| All other suites                                                                            | unchanged, pass |

The flow test creates a shop with the phone number as typed (`+91 …`). It then checks that:

- a second registration with the same number is refused;
- a wrong password is refused, and sign-in with the right one works;
- an app restart gets a new session from the stored refresh token;
- the product list is empty at first;
- one product of each kind (kg, litre, piece) is added using the app's own payload builder;
- the list shows unit and price as decimal strings in name order, and search and paging work;
- a price with 3 decimals is refused by the server;
- after sign-out the token stops working.

The API was also started on the PC and answered on the Wi-Fi address (`/health` ok, database up).

Not verified by me: the screens themselves on a physical phone. That needs you, with Expo Go (see `docs/guides/PHONE_TESTING.md`). There are no automated screen tests yet; component tests come with the UI phase.

## Phase 8: Procurement and suppliers (2026-11-19)

| Suite                                                                                                       | Result             |
| ----------------------------------------------------------------------------------------------------------- | ------------------ |
| Purchase money rules (freight sharing, discount, tax, round-off, exact partial billing), pure functions     | 23 / 23 pass       |
| Calendar-date check added to the stock rules                                                                | 8 / 8 pass         |
| All API unit tests                                                                                          | 91 / 91 pass       |
| Other unit tests (validation 28, api-client 2, mobile 9)                                                    | 39 / 39 pass       |
| API e2e, DB mocked                                                                                          | 37 / 37 pass       |
| **Procurement integration on a real PostgreSQL schema** (all 4 migrations applied)                          | **34 / 34 pass**   |
| **All six integration suites together** (identity, catalogue, inventory, mobile flow, locking, procurement) | **155 / 155 pass** |

Mistakes found while testing, all in my own tests and fixed: a wrong field name for a batch's quantity (twice), and a quantity with four decimals that is correctly refused by request validation before the unit rules run. Two of my own sums were also wrong (a round-off example and a return credit); the program's figures were right. One real defect was found and fixed in the stock engine: an impossible date such as `2026-02-31` reached the database and caused a server error; it is now refused with `EXPIRY_INVALID`.

The procurement suite covers: the specification example (5 bags of 25 kg at 1400 gives 125 kg at 56.00/kg and 7000.00 owed); weighted-average cost across purchases; draft, edit, confirm, receive and cancel; freight shared across items; discounts, tax and round-off for GST and non-GST shops; **partial receipts that add up to the exact total** (7 bags at 1000.01 received in four parts); an all-or-nothing receipt when one line fails; batch and expiry on receipt; 15 refusal cases; duplicate supplier bills; purchase returns (exact partial credits, goods already sold, batch required, unreceived purchases); payments (oldest first, chosen purchases, advances, reversals, cashbook lines); retries with the same key for create, receive, payment and return; **10 simultaneous payments, 3 simultaneous receipts of one purchase, 5 simultaneous double-taps, 12 simultaneous purchase numbers, and receipts, returns and payments racing together**; permissions (cashier refused, manager allowed); **another shop and another branch can never see or change these records**; database protection against edits and deletes; and the audit trail. After every money scenario the reconciliation check (stock, purchases, returns, payments, supplier balances) must report "consistent".

Mutation checks (a rule is deliberately broken, a test must fail, then the code is restored byte-for-byte; all 13 were caught):

| Broken rule                                          | Caught by                               |
| ---------------------------------------------------- | --------------------------------------- |
| Round-off no longer added with the last receipt      | round-off and partial receipt tests     |
| A receipt posts nothing to the supplier ledger       | specification and partial receipt tests |
| Over-receipt check removed                           | partial receipt test                    |
| Supplier row lock removed                            | simultaneous payments and racing tests  |
| Purchase row lock removed                            | simultaneous receipt test               |
| Return credit always zero                            | purchase return test                    |
| Explicit allocation may exceed what is outstanding   | allocation test                         |
| Payments not applied to the oldest purchase first    | oldest-first test                       |
| Reversal does not restore the supplier balance       | reversal test                           |
| Supplier lookup ignores the shop (cross-tenant leak) | cross-shop test                         |
| Purchase lookup ignores the branch                   | cross-branch test                       |
| Idempotency key ignored on purchase create           | retry and double-tap tests              |
| Document counter does not advance                    | numbering test                          |

Neon after the runs: the new migration is applied and `migrate diff` reports no difference from the schema; no leftover test schemas; the real tables hold only the shop and owner account created from the phone (1 organization, 1 user) and no purchases, suppliers or stock yet.

Not verified: the screens. This phase is server-side only; the mobile screens for suppliers and purchases come in the UI phase.

## Phase 8 audit follow-ups (2026-11-19)

An external AI review of Phases 0 to 8 reported five defects and some documentation gaps. Each claim was checked against the code, and for every defect a test was written FIRST and run to see it fail before the fix.

| Claim                                                                                                  | Verdict                                                                                                                                  | Evidence                                                        |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Returning a whole purchase with a negative round-off crashes; with a positive one it leaves money owed | **Confirmed, critical.** Server error (HTTP 500) from a database rule; fixed (TD-75)                                                     | 4 new tests; the first failed with `Received: 500`              |
| Supplier payments create a second cash register ("Main Counter") beside "Main Register"                | **Confirmed.** Fixed (TD-76)                                                                                                             | New test (failed with 2 registers)                              |
| Payment reversal is not branch-scoped                                                                  | **Confirmed, and worse than reported:** a manager of the first branch could reverse a payment made in another branch. Fixed (TD-77)      | New test (failed: got 201, expected 404)                        |
| Stock-movement `to` filter drops same-day entries and ignores India time                               | **Confirmed.** Fixed for movements, ledger, payments and purchases; impossible dates are now a clean 400 (TD-78)                         | New tests (failed: 0 movements instead of 1); 12 new unit tests |
| The tenant guard does not check that the branch is still active                                        | **Confirmed.** Fixed (TD-79)                                                                                                             | New test (failed: got 200, expected 403)                        |
| Module-boundary rule promised in the architecture document was never added                             | **Confirmed.** Added as a test over the real imports (TD-80). It was proven by adding forbidden imports in 5 forms, all of which fail it | `architecture.spec.ts`, 11 tests                                |
| Migrations log stops at Phase 6; schema document says register "Main"                                  | **Confirmed.** Both corrected                                                                                                            | docs                                                            |

Mistakes of my own found while doing this: the first version of the boundary test could not fail (a stray invisible character had been written into its search pattern, so it matched no imports); it was found by deliberately adding a forbidden import and seeing the test still pass, then fixed and re-proved. Three older tests called the reversal route without a branch, which the fix now correctly refuses; they were updated.

| Suite                                                                    | Result         |
| ------------------------------------------------------------------------ | -------------- |
| API unit tests (112: money rules, dates 12, module boundaries 11, stock) | 112 / 112 pass |
| Other unit tests (validation 28, api-client 2, mobile 9)                 | 39 / 39 pass   |
| API e2e, DB mocked                                                       | 37 / 37 pass   |
| All six integration suites together, real PostgreSQL                     | 164 / 164 pass |

Not verified by me: nothing new beyond the above. The review also noted that it could not run the end-to-end or integration suites in its own sandbox; both were run here.

Design note (not a defect, flagged for the owner): suppliers belong to the whole shop, so the supplier statement and the supplier payment list show every branch's entries to anyone with `supplier.read`. Purchases, returns and payment reversal are branch-scoped.

## Phase 9: Sales and POS engine (2026-11-20)

| Suite                                                                                          | Result             |
| ---------------------------------------------------------------------------------------------- | ------------------ |
| Sale money rules (discount sharing, rounding to the rupee, payments vs credit), pure functions | 19 / 19 pass       |
| Time-ordered ids (bill lines keep the order they were rung up)                                 | 3 / 3 pass         |
| All API unit tests                                                                             | 137 / 137 pass     |
| Other unit tests (validation 28, api-client 2, mobile 9)                                       | 39 / 39 pass       |
| API e2e, DB mocked                                                                             | 37 / 37 pass       |
| **Sales integration on a real PostgreSQL schema** (all 5 migrations applied)                   | **32 / 32 pass**   |
| **All seven integration suites together**                                                      | **196 / 196 pass** |

Two real defects were found by the first run and fixed:

1. **Bill lines came back in random order.** Line ids were random, and lines are listed by id. Ids are now time-ordered (UUID v7), so a bill always lists items in the order they were rung up.
2. **The credit limit never stopped the owner.** The owner implicitly holds every permission, including "override credit limit", so the limit was silently bypassed on every owner sale. Going over a limit must now be asked for on the bill (`overrideCreditLimit: true`) **and** be allowed; the override is audited.

The other two failures of that run were the same two defects seen from other tests.

The suite covers:

- **Checkout:** a walk-in cash bill (prices from the catalogue, stock out at average cost, one cashbook line, one register); the 500 g pack price and kilo price; rounding to the rupee; split payment; refused overpaid and unpaid walk-in bills (nothing saved); 7 refused line cases.
- **Credit:** the credit limit, with rollback on refusal; part payments; the explicit and audited override (refused for everyone without asking, refused for a cashier who asks); switched-off customers.
- **Discounts and prices:** the bill discount shared exactly; the 5% cashier limit, which a manager may exceed; the discount and price-override permissions, with the override audited.
- **Stock:** never oversold, and a refused bill uses no bill number; FEFO and expired stock.
- **Concurrency:**
  - 20 counters selling the last 5 units (exactly 5 bills, numbers unique and consecutive);
  - 5 double-taps (one bill, one movement, one payment);
  - 10 credit bills at once for one customer;
  - 10 credit bills for different products;
  - **credit bills for one customer in five branches at once**.
- **Held bills:** park, change, discard and close at checkout, with no stock effect.
- **Cancellation:** stock goes back to its batch at its cost, payments are refunded and credit is removed; who may cancel, and the earlier-day rule.
- **Returns:** exact partial refunds with round-off; damaged goods stay out of stock; credit bills are refunded to the account and never as unpaid cash; walk-in rules; goods go back into their batch; permissions and retries.
- **Customers:** one per mobile number, versioned edits, search.
- **Access and isolation:** another shop and another branch cannot see or touch bills; GST shops are refused.
- **History:** database protection against edits and deletes, and the audit trail.

After every money scenario, both the sales and the inventory reconciliations must report "consistent".

Mutation checks (a rule is deliberately broken, a test must fail, then the code is restored byte-for-byte). All 15 were caught:

| Broken rule                                         | Caught by                                   |
| --------------------------------------------------- | ------------------------------------------- |
| Credit limit never checked                          | credit limit tests                          |
| Customer row lock removed                           | **five branches at once** (3 runs out of 3) |
| Credit-limit override taken without being asked for | explicit override test                      |
| Cashier discount limit not enforced                 | discount limit test                         |
| Price override allowed without permission           | price override test                         |
| Walk-in bill may be left unpaid                     | refused-bill test                           |
| Payments may exceed the bill                        | refused-bill test                           |
| Checkout ignores the idempotency key                | double-tap test                             |
| Cash refund may exceed what was paid                | credit-bill refund test                     |
| Round-off never settled on the last return          | exact partial returns test                  |
| Damaged goods put back on sale                      | exact partial returns test                  |
| Cancellation keeps the credit on the account        | cancellation test                           |
| Anyone may cancel an old bill                       | earlier-day test                            |
| Sale lookup ignores the branch                      | cross-branch test                           |
| Bill view ignores the shop (cross-tenant leak)      | cross-shop test                             |

Two of my own test gaps were found this way and closed. First, removing the customer lock was NOT caught at first: the bills in my concurrency test also queued on the same product's stock lock, and then on the branch's bill counter, which hid the missing customer lock. A cross-branch test now proves the customer lock on its own. Second, one break attempt was invalid (it did not compile) and was redone.

Neon after the runs: the new migration is applied and `migrate diff` reports no difference from the schema; there are no leftover test schemas, and the real tables hold only the owner's shop (no products, sales or customers yet).

Not verified: the screens. This phase is server-side; the POS screens (with offline billing) come in the UI and sync phases.

## Phone screens through Phase 9 (2026-11-21)

| Suite                                                                                                   | Result         |
| ------------------------------------------------------------------------------------------------------- | -------------- |
| Cart, payments, idempotency-key and held-bill logic (shared package)                                    | 26 / 26 pass   |
| Form rules and request builders: customers, suppliers, stock, purchases, payments, returns (shared)     | 26 / 26 pass   |
| All shared-package tests (validation)                                                                   | 80 / 80 pass   |
| Phone app unit tests (money formatting and helpers, error messages, dates, quantities, product form)    | 25 / 25 pass   |
| Cart preview endpoint on a real database (agrees with checkout, saves nothing, warns, same permissions) | 4 / 4 pass     |
| **Phone screens contract on a real database** (the requests of every screen, built by the app's code)   | **7 / 7 pass** |
| Android bundle (`expo export`) with all 26 screens                                                      | builds         |
| TypeScript strict and lint on the app                                                                   | clean          |

What the contract test replays, in the order the screens do it: opening, adding and removing stock with a retried request; the till (build cart, preview, split payment, checkout, retry with the same key replayed, new key after a change, credit-limit refusal and the explicit override); a held bill parked and resumed; cancelling a bill; returning goods; the customer and supplier forms and statements; paying a supplier; a purchase received at once, part paid, partly returned, saved as a draft then received, and cancelled; and the paging fields every list screen reads.

**Not verified:** the screens themselves on a physical phone (layout, keyboard behaviour, camera permission, scanning). The build has no phone or emulator; the owner's walk-through in `docs/guides/PHONE_TESTING.md` is the check. Barcode scanning in particular is untested on a device.

Known gaps of this pass: no offline billing, no customer payments (Phase 11), no product price editing on the phone, no printing.

## Phase 10: Billing and GST (2026-11-19)

| Suite                                                                                                                 | Result             |
| --------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Sale & GST tax engine unit tests (`sale-math.spec.ts`: inclusive, exclusive, intra-state CGST/SGST, inter-state IGST) | 26 / 26 pass       |
| Sale & GST tax property/fuzz unit tests (`sale-math.property.spec.ts`: over 2,000 generated bills + worked examples)  | 12 / 12 pass       |
| Invoice PDF 1.4 generator unit tests (`invoice-pdf.spec.ts`: line counts 1–150, page breaks, IST date, escaping)      | 17 / 17 pass       |
| Exception filter unit tests (`all-exceptions.filter.spec.ts`: `422`, `409`, `503 SERVER_TOO_SLOW`, safe `500`)        | 7 / 7 pass         |
| Shared form & payload builders (`@ksms/validation`: product GST/HSN, customer GSTIN/stateCode)                        | 84 / 84 pass       |
| Shared API client unit tests (`@ksms/api-client`)                                                                     | 2 / 2 pass         |
| All API unit tests (13 suites)                                                                                        | 180 / 180 pass     |
| Mobile unit tests (4 suites)                                                                                          | 26 / 26 pass       |
| API end-to-end tests (`test:e2e`: 2 suites)                                                                           | 37 / 37 pass       |
| **All integration suites on real PostgreSQL** (`test:int`: 9 suites incl. `gst-audit.int-spec.ts` 9 probes)           | **218 / 218 pass** |
| Mobile bundle export (`@ksms/mobile export:check`)                                                                    | 1,362 modules OK   |

The Phase 10 tests and audit hardening cover:

- **Tax engine (`computeSale`):** GST off (`0.00` tax regardless of product settings); GST on with `INCLUSIVE` pricing (`tax = round(afterDiscount * rate / (100 + rate))`, `taxable = afterDiscount - tax`); GST on with `EXCLUSIVE` pricing (`tax = round(afterDiscount * rate / 100)`, `net = taxable + tax`); intra-state split (`CGST = floor(tax / 2)` to 2 decimals, `SGST = tax - CGST`, never losing an odd paisa); inter-state `IGST`; line and bill discounts applied before tax; invalid tax rates (`< 0` or `> 100`) refused; `PRODUCT_GST_RATE_MISSING` enforced when a GST-registered shop bills a taxable product without an explicit GST rate.
- **Branch GST completeness:** a GST-enabled shop without branch `gstin` and 2-digit `stateCode` is refused with `422 BRANCH_GST_INCOMPLETE`.
- **Invoice numbering & types (16-char GST limit & DB rules):** atomic creation of an `invoices` row on every sale using `DocumentNumberService` and DB `CHECK` constraints (`20261121000000_gst_invoice_rules`):
  - `NORMAL` invoice in series `B` (`B/2026-27/000001`) when `org.gstEnabled = false`;
  - `GST` Tax Invoice in series `INV` (`INV/26-27/000001`, max 16 chars) when `org.gstEnabled = true` and `taxTotal > 0`;
  - `BILL_OF_SUPPLY` in series `BOS` (`BOS/26-27/000001`, max 16 chars) when `org.gstEnabled = true` and all items are exempt (`taxTotal == 0`).
- **Immutable snapshots & cancellation:** `sellerSnapshot`, `buyerSnapshot`, and `totalsSnapshot` are persisted at issue time and protected by the `ksms_invoice_snapshot_immutable` DB trigger; cancelling a sale marks its invoice `CANCELLED`.
- **Invoice endpoints, multi-page PDF & resilience:** `GET /invoices`, `GET /invoices/:id`, and `GET /invoices/:id/pdf` (returns paginated `%PDF-1.4` binary with `application/pdf`, IST dates, line wrapping, and reverse-charge line), cross-branch/cross-organization isolation (`404`), and 60s checkout timeout (`503 SERVER_TOO_SLOW`).
- **Reconciliation (`GET /sales/reconciliation`):** verifies every sale has an invoice with matching number and status, and every sale's `taxable_total`, `cgst_total`, `sgst_total`, and `igst_total` match the sum of its lines.

## Phase 11: Khata and Collections (2026-11-19)

| Suite                                                                                     | Result           |
| ----------------------------------------------------------------------------------------- | ---------------- |
| Workspace checks (`pnpm check`: format, lint, typecheck, 293 unit tests across 23 suites) | 293 / 293 pass   |
| API end-to-end tests (`test:e2e`: 2 suites)                                               | 37 / 37 pass     |
| **Collections integration on real PostgreSQL** (`collections.int-spec.ts`)                | **5 / 5 pass**   |
| Mobile bundle export (`@ksms/mobile export:check`)                                        | 1,365 modules OK |

Only `collections.int-spec.ts` was re-run for Phase 11 (no shared code outside the new module changed); the other integration suites were last run in Phase 10 (218 / 218).

The Phase 11 tests cover:

- **Customer payments & khata reduction:** partial payments and overpayments (advance balance) via `POST /customers/:id/payments` and `POST /collections`, gap-free `RV/<FY>/<number>` receipt numbers, append-only `customer_ledger_entries`, `cashbook_entries` (`CUSTOMER_COLLECTION`), and `Idempotency-Key` replay safety.
- **Concurrency:** 5 simultaneous collections against one customer get 5 distinct receipt numbers and reconcile to the exact balance.
- **Agents, assignments & attribution:** agent create/read/update, assigning and reassigning customers (the previous active assignment ends; a duplicate gets `409 ASSIGNMENT_ALREADY_ACTIVE`), automatic attribution for a linked `Collection Agent` login, and the agent summary (assigned outstanding, count, total, by method).
- **Reversals:** the original becomes `REVERSED`, an `OUT` payment, a `CANCELLATION_REVERSAL` ledger line and a `REVERSAL` cashbook line are written, agent totals exclude it, and a second reversal answers `409 PAYMENT_ALREADY_REVERSED`.
- **Isolation & permissions:** another shop or another branch gets `404`; a `Cashier` gets `403`; `GET /collections/reconciliation` reports `consistent: true` after every scenario.

### Phase 11 audit (found by reading the code, each fix proved by a test)

| #   | Severity | Finding                                                                                                             | Fix (decision)                                                                                   |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A1  | High     | A collector (`collection.create`) could **reverse any receipt**, including their own                                | Reversal needs `collection.assign` (TD-110)                                                      |
| A2  | High     | A collector could record a collection **under another agent**, spoofing attribution                                 | `403 AGENT_ATTRIBUTION_FORBIDDEN` unless the caller has `collection.assign` (TD-112)             |
| A3  | Medium   | The caller-chosen `collectedAt` picked the receipt numbering year and could be far in the future or far in the past | Numbered by the day of issue; the time must be within 7 days back and not in the future (TD-113) |
| A4  | Medium   | Two simultaneous reversals of one receipt: the second answered a bare **500**                                       | Receipt row locked first; the second answers `409` (TD-111)                                      |
| A5  | Medium   | Two simultaneous assignments of one customer could leave **two ACTIVE collectors**                                  | Customer row locked while assigning (TD-114)                                                     |
| A6  | Low      | An impossible start date such as `2026-13-45` answered **500**                                                      | `422 START_DATE_INVALID`                                                                         |
| A7  | Low      | The agent screen had no way to assign or remove customers; the agent picker showed for roles that do not need it    | Assign / remove UI on the agent screen; picker only for `collection.assign`                      |
| A8  | Low      | Phase 11 had no workflow document, decisions or error codes                                                         | `COLLECTIONS_WORKFLOW.md`, TD-108 to TD-114, error table                                         |

Left open (documented in `COLLECTIONS_WORKFLOW.md`): collectors see every receipt of the branch and may collect from any customer; deactivating an agent does not end their assignments; no printable receipt PDF.

## Phase 12: Supplier Ledger and Finance (2026-11-19)

| Suite                                                                                      | Result           |
| ------------------------------------------------------------------------------------------ | ---------------- |
| Workspace checks (`pnpm check`: format, lint, typecheck, 297 unit tests across 4 packages) | 297 / 297 pass   |
| **Finance integration on real PostgreSQL** (`finance.int-spec.ts`)                         | **3 / 3 pass**   |
| Mobile bundle export (`@ksms/mobile export:check`)                                         | 1,368 modules OK |

The Phase 12 tests cover:

- **Closing math (`closing-math.spec.ts`):** `expectedCash = openingCash + netCashMovements`, `difference = actualCash - expectedCash` (exact, excess, and short).
- **Expense categories & expenses:** `GET/POST/PATCH /expense-categories` (duplicate name `409 EXPENSE_CATEGORY_EXISTS`), `GET/POST /expenses` and `POST /expenses/:id/cancel` with `Idempotency-Key` replay safety, append-only `cashbook_entries` (`EXPENSE` and `REVERSAL`), and `409 EXPENSE_ALREADY_CANCELLED` on duplicate cancellation.
- **Cashbook & manual entries:** `GET /cashbook` (with `totalIn`, `totalOut`, `net`, `cashNet` summary) and `POST /cashbook/entries` (`CASH_IN` / `CASH_OUT`).
- **Daily closing & closed-day lock:** `GET /closings/preview` carries over the prior closed day's `actualCash` as `openingCash`; `POST /closings` locks the register so 3 simultaneous close attempts yield 1 `201` and 2 `409 DAY_ALREADY_CLOSED`; closed days refuse further cashbook entries (`409 DAY_ALREADY_CLOSED`).
- **Isolation & permissions:** cross-org and cross-branch requests return `404`; `Cashier` returns `403`; `GET /finance/reconciliation` reports `consistent: true`.

### Phase 11 and 12 audit (2026-11-19)

Full report: `docs/audits/PHASE_11_12_AUDIT.md`. Nine probes on a real database, each run before the fix (all failed) and after (all pass).

| Suite                                                                | Result                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Workspace checks (`pnpm check`: format, lint, typecheck, unit tests) | 297 / 297 pass (api 184, validation 84, mobile 26, api-client 3) |
| **All integration suites on real PostgreSQL** (13 suites)            | **235 / 235 pass**                                               |
| End-to-end tests (`test:e2e`)                                        | 37 / 37 pass                                                     |
| Mobile bundle export                                                 | 1,368 modules OK                                                 |
| New: `finance-audit.int-spec.ts`                                     | 7 / 7 pass                                                       |
| New: `collections-audit.int-spec.ts`                                 | 2 / 2 pass                                                       |

## Phase 13: Reporting and Dashboard (2026-11-23)

| Suite                                                                            | Result                                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Workspace checks (`pnpm check`: format, lint, typecheck, unit tests)             | 311 / 311 pass (api 194, validation 84, mobile 30, api-client 3)                                           |
| **All integration suites on real PostgreSQL** (14 suites)                        | **242 / 242 pass** (identity suite re-run alone after a transient `503` from the shared database: 42 / 42) |
| End-to-end tests (`test:e2e`)                                                    | 37 / 37 pass                                                                                               |
| Mobile bundle export                                                             | 1,380 modules OK (run once locally; from now on only CI and Expo cloud build the app)                      |
| New: `report-math.spec.ts` (periods, rounding, percentages)                      | 10 / 10 pass                                                                                               |
| New: `period.spec.ts` (phone report periods)                                     | 4 / 4 pass                                                                                                 |
| New: `reporting.int-spec.ts` (reports reconcile to the books, plus audit probes) | 7 / 7 pass (re-run after the audit fixes; the other 13 suites are unchanged since the full run above)      |

`reporting.int-spec.ts` builds one busy GST shop and checks each report against figures worked out by hand (revenue 400.00, cost 210.00, gross profit 190.00, net profit 140.00) and against independent SQL over the raw tables: summaries, series (day, week, month), product and category breakdowns, payment modes plus credit, profit, cash flow, purchases, stock value against `/inventory/valuation`, dues, collections, the day book, and the home screen against the reports. It also checks role limits (cashier 403, no profit columns without `report.profit`), isolation between shops and branches, a cancelled bill vanishing from every figure, and that bad requests are 400s.

Speed (temporary probe, not kept): 50,000 bills over a year on the shared Neon database, slowest report 1.5 s including the network trip (see `docs/architecture/REPORTING.md`).
