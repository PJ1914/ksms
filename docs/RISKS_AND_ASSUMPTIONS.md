# Risks and Assumptions

## 1. Assumptions (not confirmed; each should be accepted or corrected)

| ID   | Assumption                                                                                                                                 | Needed by |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| A-01 | One organization, one branch, one cash register for launch; schema is multi-branch ready                                                   | Phase 2   |
| A-02 | Stock valuation uses moving weighted average only                                                                                          | Phase 7   |
| A-03 | Invoice series per branch per financial year (Apr–Mar), format e.g. `INV/26-27/000123` (GST allows at most 16 characters)                  | Phase 10  |
| A-04 | Shop is GST-registered under regular scheme (not composition) when GST invoices are enabled; composition-scheme shops issue Bill of Supply | Phase 10  |
| A-05 | Prices stored per unit; tax-inclusive vs exclusive is a shop-level default with per-product override                                       | Phase 10  |
| A-06 | Discounts: line-level and bill-level; max discount % per role is configurable                                                              | Phase 9   |
| A-07 | Customer credit has an optional per-customer credit limit; exceeding it needs manager override                                             | Phase 11  |
| A-08 | Cash payments by collection agents are handed over to the shop; agent cash-in-hand tracking is out of scope initially                      | Phase 11  |
| A-09 | Single currency INR; single timezone Asia/Kolkata for display, UTC in storage                                                              | All       |
| A-10 | Receipts/invoices printed via Android share/print or PDF initially; Bluetooth thermal printing is future                                   | Phase 15  |
| A-11 | Barcode scanning uses camera; no external scanner hardware required                                                                        | Phase 15  |
| A-12 | Android only; no iOS or web client                                                                                                         | All       |
| A-13 | Shop volume is small (hundreds of sales/day, a few thousand SKUs); Neon free/low tier acceptable initially                                 | Phase 17  |
| A-14 | Online connectivity at the counter is generally available; outages block checkout (with clear UI)                                          | Phase 14  |
| A-15 | Data retention: financial records retained at least 8 years **[verify with accountant]**                                                   | Phase 17  |

## 2. Questions needing your decision

1. Is the shop GST-registered? Regular or composition scheme? Do you need GST invoices at launch or only later?
2. Do you want negative stock ever allowed (e.g., when goods arrived but the purchase isn't entered yet)? Who may override?
3. Are customer credit limits required?
4. Are collection agents' cash handovers to be tracked?
5. Can cashiers give discounts? Up to what limit?
6. Should price changes apply to existing stock immediately (selling price) — yes by default; confirm.
7. Loose items: what's the minimum sale increment (e.g., 50 g)? Rounding rule for totals (nearest ₹1 or paise)?
8. Do you want Telugu/Hindi invoice text at launch or English only?
9. Do you have Expo, GitHub, Neon, Google Cloud, Cloudflare and Firebase accounts, and who pays for them?
10. Do you have two physical Android devices for testing, and which Android versions?
11. Is Docker Desktop acceptable on this machine, or should we use a Neon dev branch (TD-10)?
12. Do you want the early mobile vertical slice (TD-12)?

### Default answers adopted (owner has no preference; revisit any time)

| Q    | Default adopted                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Design for GST (regular scheme) but ship with GST **off by default**; normal invoices work first; accountant review before turning on GST in production |
| 2    | Negative stock **blocked**; only Owner/Manager can override, always audited                                                                             |
| 3    | Optional per-customer credit limit, off by default                                                                                                      |
| 4    | Agent cash handover tracking deferred                                                                                                                   |
| 5    | Cashier discount capped at a configurable % (default 5%); higher needs Manager                                                                          |
| 6    | Price changes apply to future sales only; past invoices never change                                                                                    |
| 7    | Loose-item minimum increment configurable per product (default 50 g / 50 ml); totals rounded to nearest ₹1 as a visible round-off line                  |
| 8    | English only at launch                                                                                                                                  |
| 9–10 | You will create free accounts when a phase needs them (Expo, GitHub, Neon first); I'll give step-by-step help. Testing can begin with one Android phone |
| 11   | Neon dev branch, no Docker (TD-10)                                                                                                                      |
| 12   | Early mobile slice approved by default (TD-12), TD-04 and TD-06 accepted                                                                                |

## 3. Risks

| ID                                    | Risk                                                                                              | Likelihood | Impact   | Mitigation                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01                                  | Android toolchain missing locally (SDK, emulator, EAS); Expo dev builds need native compilation   | High       | Medium   | Install Android Studio or use EAS cloud builds; do vertical slice early (TD-12)                                                                                                                                                                                                             |
| R-02                                  | Scope is very large for the quality bar                                                           | High       | High     | Strict phase gates; defer non-core features; thin slices                                                                                                                                                                                                                                    |
| R-03                                  | GST rule errors cause compliance problems                                                         | Medium     | High     | Configurable rates, snapshots, accountant review before production                                                                                                                                                                                                                          |
| R-04                                  | Stock/ledger drift from bugs                                                                      | Medium     | High     | Append-only design, reconciliation tests, nightly reconcile job                                                                                                                                                                                                                             |
| R-05                                  | Concurrent oversell / duplicate sale                                                              | Medium     | High     | DB-level conditional updates, idempotency keys, concurrency tests                                                                                                                                                                                                                           |
| R-06                                  | Cloud Run cold starts and Neon scale-to-zero latency at checkout                                  | Medium     | Medium   | Min instance 1, Neon autosuspend tuned, connection pooling, measure in Phase 17                                                                                                                                                                                                             |
| R-07 (RESOLVED in Phase 4, see TD-32) | Prisma + Neon pooled connections: transaction mode limits interactive transactions/advisory locks | Medium     | High     | Verify before relying on `FOR UPDATE` via pooled URL; Phase 1 design: row locks and `pg_advisory_xact_lock` inside a transaction are safe on the pooled URL; session-level features are forbidden. Must be proven by a concurrency test in Phase 4, else checkout uses the direct URL (ADR) |
| R-08                                  | Unit-conversion mistakes (loose vs packaged)                                                      | Medium     | High     | Pure domain module, property tests, snapshots on lines                                                                                                                                                                                                                                      |
| R-09                                  | Floating-point/Decimal leakage across API boundary                                                | Medium     | High     | Decimals serialized as strings; lint rule/tests forbidding `number` money                                                                                                                                                                                                                   |
| R-10                                  | Backup not restorable                                                                             | Low        | Critical | Scheduled restore drills; documented procedure                                                                                                                                                                                                                                              |
| R-11                                  | Secrets leakage in repo or app bundle                                                             | Low        | Critical | `.env.example` only, secret scanning in CI, server-held credentials only                                                                                                                                                                                                                    |
| R-12                                  | Dependency/version mismatches (Node 24 vs Expo/Prisma/Nest support)                               | Medium     | Medium   | Pin Node LTS, verify versions at install time (TD-09)                                                                                                                                                                                                                                       |
| R-13                                  | Single developer/agent knowledge drift between phases                                             | Medium     | Medium   | Docs kept in sync; ADRs; AGENTS.md                                                                                                                                                                                                                                                          |
| R-14                                  | Data loss from device-only drafts                                                                 | Low        | Low      | Drafts are non-financial; clear UI warnings                                                                                                                                                                                                                                                 |
| R-15                                  | Free-tier limits (Neon, R2, Cloud Run)                                                            | Low        | Medium   | Monitor usage; budget alerts                                                                                                                                                                                                                                                                |

## 4. Items to resolve before implementation begins

Answers to §2 Q1–Q5, Q9, Q11; verification of R-07; confirmation of TD-04, TD-06, TD-12.
