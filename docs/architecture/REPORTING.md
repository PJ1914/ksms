# Reporting and dashboard (Phase 13)

Code: `apps/api/src/modules/reporting/`. Phone screens: `apps/mobile/app/reports/` and the Home tab.

Reporting is **read-only**. It owns no tables, writes nothing, and imports no other module: it runs SQL aggregates straight over the other modules' tables (layer L5 in `SYSTEM_CONTEXT.md`). Every query filters by `organization_id` and, for branch reports, `branch_id`. All amounts are decimal strings and are summed in the database or with `decimal.js`.

## Four numbers that are never mixed up

| Name                    | What it is                                                                                       | Where                     |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------- |
| **Revenue** (net sales) | What was sold, **before GST**, after discounts and returns. Not the money received.              | Sales report, Profit      |
| **Gross profit**        | Revenue less the cost of the goods sold (estimate)                                               | Profit, product breakdown |
| **Net profit**          | Gross profit less expenses and stock written off (estimate)                                      | Profit, Home              |
| **Cash flow**           | Money that actually moved in the cash book, whatever it was for. A credit sale is not cash flow. | Cash flow, Home           |

"Billed" (`billValue`) is the bill total including GST and round-off. It differs from revenue by the GST and the round-off.

## Definitions

- **A sale counts** when its status is `COMPLETED`, on the India-time day it was sold. A cancelled bill disappears from every figure (it is cancelled with everything reversed), including on the day it was originally made.
- **A return counts on the day it was made** (not the day of the original bill): its price before GST is taken off revenue, and the cost of goods that went back on the shelf (`SALEABLE`) is taken off the cost. Damaged, expired and quarantined returns keep their cost in the cost of goods sold: that is a real loss.
- **Cost of goods sold** uses the cost saved on each bill line (the average cost when it was sold), `round(cost x quantity, 2)` per line, so totals at any level add up to the paisa.
- **Stock written off** = damage, expiry and adjustment movements at cost, net of stock found (adjustments up).
- **Expenses** are the expenses of the period that are not cancelled, by expense date.
- **Purchases** count once confirmed (not draft, not cancelled), on the purchase date: `billed` is what is owed for the goods received so far, `returned` is credit given back, `net` is the difference.
- **Stock value** and **products in stock** include every product with stock on hand, even a discontinued one, the same as `GET /inventory/valuation`. Out-of-stock and low-stock counts look at live products only. Expired and expiring stock is valued at each batch's own cost.
- **Dues** are the customer and supplier balances. They belong to the whole shop, not one branch, so these two reports ignore the branch.
- **Collections** are every khata payment, including ones taken at the shop counter with no agent (shown as "Shop counter"), so the report always agrees with the cash book. Reversed receipts are not counted. "Last paid" on a customer is the latest khata payment that still stands (a reversed one does not count).
- **Day book** lists, for one day: bills, returns, purchases, goods sent back to suppliers, khata collections (with or without an agent), supplier payments and expenses. Cancelled and reversed items are left out.

## Periods

`from` and `to` are India-time dates (`YYYY-MM-DD`), both included. When left out, a report covers the last 30 days. A period may not be longer than 366 days (`400 INVALID_RANGE`), may not be reversed (`400 INVALID_RANGE`) and must be real dates (`400 INVALID_DATE`).

## API

All routes need `X-Branch-Id` and a permission. A role without the permission gets `403`; without a login, `401`.

| Route                                                                                  | Permission         | What it answers                                                                                             |
| -------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `GET /reports/dashboard`                                                               | `report.financial` | Today's money, dues and (if the role may see them) sales, stock and profit. Others are `null`               |
| `GET /reports/sales/summary?groupBy=day\|week\|month`                                  | `report.sales`     | Bills, billed, discounts, GST, credit, returns and net sales, per bucket and in total                       |
| `GET /reports/sales/breakdown?by=product\|category\|customer\|payment_method\|cashier` | `report.sales`     | The same sales split; product and category are net of returns. Cost and profit columns need `report.profit` |
| `GET /reports/purchases/summary`, `/purchases/breakdown`                               | `report.purchases` | Purchases per day/week/month, and per supplier                                                              |
| `GET /reports/inventory/summary`                                                       | `report.inventory` | Stock value, in stock, out of stock, low stock, expired and expiring stock, value by category               |
| `GET /reports/inventory/movers?kind=fast\|slow&days=`                                  | `report.inventory` | Best sellers, or shelf stock that sells least and the money tied up in it                                   |
| `GET /reports/finance/profit`                                                          | `report.profit`    | Revenue, cost, gross profit, expenses (by category), stock written off, net profit                          |
| `GET /reports/finance/cash-flow`                                                       | `report.financial` | Cash book money in and out by mode, by kind and by day; closing differences                                 |
| `GET /reports/finance/outstanding?party=customers\|suppliers`                          | `report.financial` | Who owes the shop and whom the shop owes                                                                    |
| `GET /reports/finance/collections`                                                     | `report.financial` | Khata collections by agent and by day                                                                       |
| `GET /reports/finance/day-book?date=`                                                  | `report.financial` | Everything that happened on a day, oldest first                                                             |

A product that was sold and fully returned in the same period is not listed with zeros. On the phone, the home tile "Expired or expiring in 30 days" counts both kinds of batch (it uses the stock screen's list), while the Stock report shows expired and expiring-soon separately.

Cashiers hold none of these permissions. Managers and the Owner hold all of them. The home screen is built from the same services as the reports, so the two cannot disagree.

## Proof that the reports agree with the books

`apps/api/test/integration/reporting.int-spec.ts` builds a busy shop (GST and non-GST goods, credit, split payments, a cancelled bill, two returns, expenses, a stock write-off, a purchase, a supplier payment, a reversed collection) and checks every figure two ways: against totals worked out by hand, and against independent SQL over the raw tables. Examples: the series add up to the totals for day, week and month; the product and category breakdowns net to the same revenue as the summary; payment modes plus credit equal what was billed; stock value equals `/inventory/valuation`; dues equal the customer and supplier balances; the cash flow totals equal the cash book and add up by mode, kind and day; the home screen equals the reports.

## Speed

Measured with 50,000 bills (150,000 lines) spread over a year, against the shared Neon database in Singapore (so each figure includes the network trip): the slowest report was 1.5 s (yearly summary by month), a year of sales by product 1.0 s, profit for the year 1.2 s, the home screen 1.4 s. No materialized views or new indexes were needed (TD-127).

## Not included (on purpose)

- Aged dues (30/60/90 days) and per-supplier aging: need the oldest unpaid bill, not just the balance.
- Reports across all branches at once: choose a branch (the Owner can switch).
- Exporting a report as PDF or spreadsheet; scheduled or emailed reports; charts.
- GST returns (GSTR-1 / 3B): these need the accountant's review (see the Phase 10 audit).
- Profit for a single customer or supplier.

## Things to keep in mind

- Cost is a moving average **estimate**; a bill sold before the cost was known (opening stock at zero cost) shows a full margin.
- The cash book dates a sale made after the evening close on the next business day (Phase 12, TD-119), while the sales report dates it on the day it was made. Cash flow and sales can therefore differ for a late-night day.
- A collection made for an earlier date is dated by when it was recorded in the cash book, while the collections report uses the collection time on the receipt (audit item O5).
