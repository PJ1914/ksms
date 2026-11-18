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

- Receive payments from customers (collections, receipts, agents): Phase 11.
- Money totals, profit and reports on Home: Phase 13.
- Working without internet (offline billing and sync): the sync phase.
- Editing a product's prices and units, categories, expenses, cashbook and daily closing.
- Thermal Bluetooth printing (invoices can be shared via the Android share sheet on `sale/[id]`).

## Testing

- `packages/validation` unit tests (cart, forms, payloads) and `apps/mobile` unit tests (formatting, errors) run in `pnpm check` and CI.
- `apps/api/test/integration/mobile-screens.int-spec.ts` replays the requests of every screen, built by the app's own code, against a real database.
- The Android bundle is built in CI (`expo export`).
- **The screens themselves have not been exercised on a physical phone by the build.** That check belongs to the owner (see `docs/guides/PHONE_TESTING.md`).
