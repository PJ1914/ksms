# Phone screens (through Phase 9)

Built 2026-11-21 on top of the early slice (TD-61..64). Code: `apps/mobile/app/` (screens), `apps/mobile/src/` (shared code). Shared, tested logic (cart, request builders, form rules) lives in `packages/validation` so the phone and the API tests use the **same** code.

## How the phone works with the server

- The phone never works out money. Prices, discounts, rounding, stock and credit limits are decided by the server. While a bill is being built the screen asks `POST /sales/preview`, which runs the same pricing code as checkout, saves nothing, and also warns about low stock and credit limits.
- Every request that moves stock or money carries an **Idempotency-Key**. The same key is reused while the request is unchanged, so a retry after a bad signal cannot sell or pay twice, and a new key is made as soon as anything changes. The till keeps its key above the screen, so leaving and coming back to the bill does not lose it.
- Amounts and quantities are decimal strings everywhere in the app. Comparisons use `decimal.js` helpers, never JavaScript numbers.
- Screens show or hide buttons by permission, but the server enforces every permission.

## Screen map

| Tab / route                  | What it does                                                                                                                                                                | Needs                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Home**                     | Today at a glance: bills today, low stock, expiring in 30 days, customers owing, suppliers you owe (exact counts; each opens its list)                                      | each count needs its own read permission                      |
| **Stock**                    | Stock list with search, filters (All, Low stock, Expiring), add product                                                                                                     | `stock.read`, `product.manage`                                |
| `product/[id]`               | Product page: prices, units, barcodes, stock, batches with expiry warnings, recent movements; buttons to set opening stock, add stock, remove stock                         | `product.read`, `stock.adjust`                                |
| `stock-adjust`               | Opening stock / add / remove, in any unit, with batch and expiry for tracked products                                                                                       | `stock.adjust`                                                |
| **Billing**                  | New bill / continue the bill, held bills, today's bills                                                                                                                     | `sale.create`, `sale.read`                                    |
| `sale/new`                   | The till: items, quantity, discount, typed price, customer, live totals from the server, stock and credit warnings, split payment (cash, UPI, card, bank), khata, hold, pay | `sale.create` (+ discount / price / credit-limit permissions) |
| `sale/add-item`, `sale/scan` | Search by name, SKU or barcode, or scan with the camera; pick the unit and see the server's price for that quantity                                                         | `sale.create`                                                 |
| `sale/customer`              | Choose the customer for khata (or walk-in)                                                                                                                                  | `customer.read`                                               |
| `sale/[id]`                  | A bill: items, payments, khata, returns; cancel (with reason); return goods                                                                                                 | `sale.read`, `sale.cancel`, `sale.return`                     |
| `sale/return`                | Return goods: quantity per line, back on the shelf / damaged / expired, refund by cash, UPI or off khata                                                                    | `sale.return`                                                 |
| `held-bills`                 | Carts parked at the counter; pick one to continue, or discard                                                                                                               | `sale.create`                                                 |
| **Khata**                    | Customers with what they owe, search, "owe money" filter, add customer                                                                                                      | `customer.read`, `customer.manage`                            |
| `customer/[id]`              | A customer: balance, credit limit (change it), switch off/on, khata statement                                                                                               | `customer.read`, `ledger.read`                                |
| **More**                     | Profile, branch switcher (if more than one), links to Suppliers and Purchases, sign out                                                                                     |                                                               |
| `suppliers`, `supplier/[id]` | Suppliers with what you owe, add supplier, statement, switch off/on                                                                                                         | `supplier.read`, `supplier.manage`                            |
| `supplier/pay`               | Pay a supplier: oldest unpaid purchases are settled first, any extra stays as an advance                                                                                    | `supplier.payment`                                            |
| `purchases`, `purchase/[id]` | Purchases with filters (waiting for goods, unpaid); a purchase: receive goods, pay, send goods back, cancel                                                                 | `purchase.read`, `purchase.create`, `purchase.cancel`         |
| `purchase/new`               | Choose supplier and items (unit, quantity, price, discount, batch and expiry), freight, "goods have arrived"                                                                | `purchase.create`                                             |
| `purchase/return`            | Send goods back to the supplier, naming the batch for tracked products                                                                                                      | `purchase.cancel`                                             |
| `gst-settings`               | Turn shop GST on or off, choose default price mode (tax inclusive/exclusive), and set branch GSTIN, 2-digit state code and address                                          | `organization.read`, `organization.manage`, `branch.manage`   |

## What the phone does NOT do yet

- Charts, and exporting a report as PDF or a spreadsheet.
- Offline completed sales, collections, stock changes, or customer creation (online-first per TD-02; read cache, draft bills, and held-bill sync are live from Phase 14).
- Thermal Bluetooth printing (invoices and collection receipts can be shared via the Android share sheet on `sale/[id]` and `customer/pay`).

## Testing

- `packages/validation` unit tests (cart, forms, payloads) and `apps/mobile` unit tests (formatting, errors) run in `pnpm check` and CI.
- `apps/api/test/integration/mobile-screens.int-spec.ts` replays the requests of every screen, built by the app's own code, against a real database.
- The Android bundle is built in CI (`expo export`).
- **The screens themselves have not been exercised on a physical phone by the build.** That check belongs to the owner (see `docs/guides/PHONE_TESTING.md`).

## Screens added with Phases 11 and 12

| Screen                  | File                      | What it does                                                                                                                                                           |
| ----------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collect from a customer | `customer/pay.tsx`        | Record a khata payment, choose the mode and the collecting agent, see the receipt number and remaining due or advance                                                  |
| Add a khata entry       | `customer/adjust.tsx`     | Add what a customer took without a bill, an opening balance or a reduction (reduction and opening balance need `khata.adjust`; the button shows for `customer.manage`) |
| Reports hub             | `reports/index.tsx`       | The reports this role may open                                                                                                                                         | the `report.*` permissions                       |
| Sales                   | `reports/sales.tsx`       | Net sales, bills, GST, credit and returns for a period; by day, product, category, customer, payment mode or cashier                                                   | `report.sales` (profit columns: `report.profit`) |
| Profit and expenses     | `reports/profit.tsx`      | Revenue, gross profit, expenses, stock written off and net profit (estimates)                                                                                          | `report.profit`                                  |
| Cash flow               | `reports/cash.tsx`        | Money in and out by payment mode, daily closing differences                                                                                                            | `report.financial`                               |
| Money owed              | `reports/dues.tsx`        | What customers owe and what the shop owes suppliers                                                                                                                    | `report.financial`                               |
| Collections             | `reports/collections.tsx` | Khata collected by agent and by day                                                                                                                                    | `report.financial`                               |
| Day book                | `reports/day-book.tsx`    | Everything that happened on a day, with earlier and later day buttons                                                                                                  | `report.financial`                               |
| Purchases               | `reports/purchases.tsx`   | What was bought per day                                                                                                                                                | `report.purchases`                               |
| Stock                   | `reports/stock.tsx`       | Stock value, expired and expiring stock, fast sellers and slow stock                                                                                                   | `report.inventory`                               |
| Collections             | `collections.tsx`         | List and search receipts, reverse a receipt (owner / manager)                                                                                                          |
| Collection agents       | `collection-agents.tsx`   | Agents, their customers and totals                                                                                                                                     |
| Expenses                | `expenses.tsx`            | List, add, cancel expenses and categories                                                                                                                              |
| Cash book               | `cashbook.tsx`            | Cash in/out lines with totals, manual cash in / out                                                                                                                    |
| Daily closing           | `daily-closing.tsx`       | Expected cash, count and close the day (asks for confirmation first, it cannot be undone)                                                                              |

## Screens & offline support added with Phase 14

| Screen / component   | File                            | What it does                                                                                                                                                                             |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync & offline cache | `sync.tsx`                      | Connection/sync status, last sync time, manual **Sync now**, cached counts (products, categories, units, customers), pending queue, and **Retry / Discard** for failed held-bill uploads |
| Sync status banner   | `src/components/SyncBanner.tsx` | Live online/offline/syncing/pending/failed indicator on Home and Billing; taps through to `/sync`                                                                                        |

- **SQLite read cache (`expo-sqlite`)**: products (with conversions, prices, barcodes), categories, units, and customers refresh via `/sync/*` and back offline fallback on `sale/add-item`, `sale/scan`, `sale/customer`, and `(tabs)/khata`.
- **Draft & held bills**: the active cart persists in SQLite per `(org, user, branch)`; holding a bill saves locally and queues a `HELD_BILL_UPLOAD` outbox item uploaded idempotently (`Idempotency-Key`) with exponential backoff. Checkout remains strictly online-only (TD-02).
- **Cache clearing**: all SQLite tables are wiped on sign-out and whenever another user or shop signs in on the device.

## Screens added with Phase 15

| Screen                   | File                                  | What it does                                                                                                                                       | Needs                          |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Notifications            | `notifications.tsx`                   | In-app alerts (low stock, expiring batches), unread filter, mark read / read all, check branch alerts                                              | authenticated                  |
| Edit product & price     | `product-edit.tsx`                    | Edit product name, local name, category, status, MRP, reorder level, GST config, base selling price, and attach/remove barcodes (with camera scan) | `product.manage`               |
| Stock & Add product scan | `(tabs)/stock.tsx`, `product-new.tsx` | Camera barcode scan (`BarcodeScannerModal`) in Stock jumps to the product or opens Add product pre-filled with the scanned barcode + optional MRP  | `stock.read`, `product.manage` |
| Categories               | `categories.tsx`                      | List, add, rename and delete empty product categories                                                                                              | `category.manage`              |
| Collection receipt       | `customer/pay.tsx`                    | Added **Share receipt** via Android share sheet on the collection confirmation screen                                                              | `collection.create`            |

## Staff and roles (More tab, "Team")

All of it uses the existing server endpoints (`/employees`, `/roles`, `/invitations`, `/branches`, `/auth/accept-invitation`); the server decides who may do what, the phone only hides what a role cannot use.

| Screen                  | File               | What it does                                                                                                                          | Needs                                 |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Staff                   | `staff.tsx`        | People, their roles, invitations waiting to be used (cancel one), links to invite and to roles                                        | `employee.read` (`invitation.manage`) |
| Staff member            | `staff/[id].tsx`   | Change role and branches, switch off or on, unlock sign-in. The owner and your own account cannot be changed                          | `employee.manage`                     |
| Invite someone          | `staff-invite.tsx` | Mobile number, role, branches; shows the one-time code (72 hours, shown once) with a Share button                                     | `invitation.manage`                   |
| Roles                   | `roles.tsx`        | Every role, what it covers by section, how many people hold it                                                                        | `role.read`                           |
| Role                    | `role-edit.tsx`    | Make or change a role by ticking plain-English permissions in sections; delete an unused custom role. Owner role is read-only         | `role.manage`                         |
| Join with an invitation | `login.tsx`        | "I have an invitation code": code, name, password. Someone who already has an account with that number enters their existing password | none (public)                         |

An owner who works alone can choose "No, I work alone" on the More tab (or on the Staff screen): the Team group is then hidden. The choice is a display setting kept on the phone per shop (`src/prefs/staff-pref.ts`), not a permission, and "I have staff now" brings the options back. Other roles with the permission always see the Team group.

## Calculator (Home, quick actions)

`app/calculator.tsx`, engine in `src/utils/calc.ts` (exact decimal maths, no floats). Shop-style percent
(`200 + 18%` = 236, `500 − 10%` = 450, `200 × 5%` = 10), × ÷ before + −, Indian number grouping, a tape of the
last 20 results, GST add/remove at 5/12/18/28% with the CGST/SGST split, and "customer gives" change. It runs
entirely on the phone, with no network and no data stored. It replaced the "Collect money" quick action on Home;
collecting money is still done from a customer's page in Khata.
