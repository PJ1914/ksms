# Finance workflow: expenses, cashbook, daily closing (Phase 12)

## The cash register

Every branch has one cash register. **Every** money movement of the branch is one line in the append-only cash book (`cashbook_entries`) on that register: sale receipts, customer collections, supplier payments, refunds, expenses, reversals and manual cash in/out. Each line has a **business date**, a payment method (cash, UPI, card, bank, other) and a signed amount (money in is positive).

## Expenses

An expense (category, amount, method, optional date up to 30 days back) writes the `Expense` row, a negative cash book line and an audit row in one transaction, and is idempotent. Cancelling an expense never deletes it: it marks it cancelled and adds a reversing cash book line **dated today** (or the next open day), never into the original day, because that day may already be closed (TD-119).

## Manual cash in / out

`POST /cashbook/entries` (permission `cashbook.manage`): a positive amount with kind `CASH_IN` or `CASH_OUT`, a description, and an optional date up to 7 days back. It is refused on a closed day.

## Daily closing

At the end of the day the owner counts the cash and closes the day (`closing.manage`):

- **Opening cash** = the cash counted at the last closing before this day + the cash movements of every earlier day that was never closed (TD-118).
- **Expected cash** = opening cash + the day's cash movements (only the CASH method; UPI, card and bank are shown but are not in the drawer).
- **Difference** = counted cash − expected cash (negative = short, positive = excess).
- Days must be closed in order; closing is final (`409 DAY_ALREADY_CLOSED` if repeated).

The register row is locked while closing, and a cash line share-locks it, so a line and a closing never race: each line is either in the closing's figures or booked after it.

## After the day is closed

The shop can keep trading. A sale, collection, refund or reversal made "now" is booked on the **next business day**. A line that names the closed date on purpose is refused. A closed closing cannot be edited or deleted, and the database refuses a cash line on a closed day (TD-120).

## Reconciliation (`GET /finance/reconciliation`)

Every list must be empty (`consistent: true`):

1. every expense has exactly one cash book line of minus its amount;
2. every cancelled expense has one reversing line of plus its amount;
3. cash in / cash out lines have the right sign;
4. every closing's opening cash follows the rule above, its expected cash equals opening + the day's cash, and its difference equals counted − expected.

## Permissions

| Permission        | Allows                                                          |
| ----------------- | --------------------------------------------------------------- |
| `expense.read`    | View expenses and categories                                    |
| `expense.create`  | Record and cancel expenses, manage categories                   |
| `cashbook.read`   | View the cash book, closing preview and history, reconciliation |
| `cashbook.manage` | Manual cash in / out                                            |
| `closing.manage`  | Close the day                                                   |

## Known limits (open)

- Cash in the drawer is tracked per branch register; there is no till-by-till or shift handover.
- There is no way to "reopen" a closed day. A mistake is corrected with a reversing line on today's date.
- Reports (profit, day book by period) arrive in Phase 13.
