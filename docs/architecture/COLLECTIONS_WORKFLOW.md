# Khata and collections workflow (Phase 11)

## What it does

A customer who owes money (khata) pays some or all of it. The shop records the payment, gets a numbered receipt (`RV/26-27/000001` style, per branch and financial year), and the customer's balance goes down. Field collectors ("collection agents") can be given customers to collect from, and every collection records who collected it.

## What one collection does (ONE database transaction)

1. Checks the amount (more than zero), the collection time and who gets the credit.
2. Takes the next gap-free receipt number.
3. Locks the customer and posts a **negative** `PAYMENT` line to the customer ledger (one writer: `CustomerLedgerService`).
4. Writes the `Payment` (direction IN, purpose `CUSTOMER_COLLECTION`).
5. Writes a `CUSTOMER_COLLECTION` cashbook line on the branch's register.
6. Writes a `CollectionRecord` when an agent is credited.
7. Writes an audit row.

If any step fails nothing is saved. A retry with the same `Idempotency-Key` returns the same receipt (header `Idempotent-Replayed: true`).

Paying more than is owed leaves a negative balance, shown as an **advance** (TD-109).

## Who is credited

| Caller                                                | Result                                         |
| ----------------------------------------------------- | ---------------------------------------------- |
| Login linked to an active agent, no `agentId`         | Credited to that agent automatically           |
| Collector naming their own agent                      | Allowed                                        |
| Collector naming another agent                        | `403 AGENT_ATTRIBUTION_FORBIDDEN`              |
| Owner / manager (`collection.assign`) naming an agent | Allowed (must be active)                       |
| No agent and no linked agent                          | Recorded at the counter, no `CollectionRecord` |

## Reversal

Receipts are never edited or deleted (TD-110). A reversal, by someone with `collection.assign`:

- locks the receipt, refuses with `409 PAYMENT_ALREADY_REVERSED` if already reversed;
- marks the original `REVERSED` and writes an `OUT` payment linked to it;
- posts a `CANCELLATION_REVERSAL` ledger line that restores the balance;
- writes a `REVERSAL` cashbook line;
- removes the receipt from the agent's totals.

## Assignments

One customer has at most one ACTIVE collector. Assigning to an agent ends the customer's previous active assignment (the customer row is locked, TD-114). An agent summary shows active customers, what those customers owe, and what was collected (reversed receipts excluded) split by payment method.

## Reconciliation (`GET /collections/reconciliation`)

Every list must be empty (`consistent: true`):

1. a customer's cached balance equals the sum of their ledger;
2. every collection has one ledger line of minus its amount;
3. every collection has one cashbook line of its amount;
4. every reversed collection has a reversing ledger line and cashbook line;
5. every `CollectionRecord` matches its payment (amount, customer, receipt number, branch).

## Permissions

| Permission          | Allows                                                 | Default roles                    |
| ------------------- | ------------------------------------------------------ | -------------------------------- |
| `collection.read`   | List and view collections, agents, summaries           | Owner, Manager, Collection Agent |
| `collection.create` | Record a collection                                    | Owner, Manager, Collection Agent |
| `collection.assign` | Manage agents and assignments; **reverse** collections | Owner, Manager                   |

## Known limits (open)

- **Collectors see every receipt of the branch**, not only their own, and may collect from any customer, not only assigned ones. Restricting this needs an owner decision.
- Deactivating an agent does not end their assignments.
- No printable receipt PDF yet (the receipt number and amounts are shown on screen).
- Reporting by agent over time arrives with Phase 13.
