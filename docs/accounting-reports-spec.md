# Accounting Reports Architecture Spec

> Status: planning-only architecture spec.
> This document defines how Last Say can evolve from transaction review into
> scoped management reporting. It does not implement schema, API routes, or UI.

## Stage 0 Intent

Last Say should stay a local-first finance data server where external AI
operators prepare data, humans review it, and the tool preserves durable state:
rules, corrections, imports, and report mappings. The accounting-report work is
not a rewrite and not a compliance accounting system. It is an additive path from
reviewed transactions toward scoped management statements with explicit coverage
warnings.

The first production-quality outcome is not "perfect accounting." It is a
trusted workflow that can say:

- what data is included;
- what data is missing or stale;
- how transactions were mapped into report lines;
- what humans reviewed or corrected;
- which reports are partial, unreconciled, or complete.

## Hard Invariants

- The app remains a local SQLite + REST API + Web UI tool.
- The server must not call an LLM. AI work remains external and follows the
  self-contained Last Say Skill under `.claude/skills/last-say-ops/`.
- Real financial data in `data/`, `uploads/`, and `outputs/` must not be
  committed, copied into public docs, or exposed in screenshots.
- Existing transaction amount, date, source, and dedupe semantics must remain
  stable.
- Human-editable fields remain allowlisted by `lib/constants.js`.
- `correction_log` remains append-only.
- Existing import, rule application, and review flows must keep working.
- Reports are derived views over imported transactions, reviewed mappings,
  balance snapshots, and future manual adjustments.
- The product must not claim GAAP, IFRS, tax, audit, or statutory compliance.

## Repo Reality Evidence

These facts were checked against the current repo and must be rechecked before
any implementation phase, especially because the working tree currently contains
uncommitted UI/import changes unrelated to this planning file.

| Area | Current evidence | Planning implication |
|---|---|---|
| Developer rules | `AGENTS.md` defines the tool as CRUD/import/rule application only; external AI handles bill parsing, classification, websearch, and rule maintenance. | Accounting reports must not introduce server-side AI. |
| External AI contract | `.claude/skills/last-say-ops/` is self-contained and documents current API routes, ledger CSV schema, rule contract, and correction loop. | Any new operator fields or APIs require Skill reference updates in the same phase. |
| Runtime | `package.json` uses Next.js, React, `node:sqlite`, and `node --test`; `FINANCE_DB_PATH` can point tests at a non-real DB. | Tests and demos must use temp/demo DB paths, never `data/finance.sqlite`. |
| Existing schema | `lib/db.js` creates `accounts`, `sources`, `classification_rules`, `transactions`, `transaction_sources`, `tags`, `transaction_tags`, and append-only `correction_log`. | New report tables should be additive; do not replace `transactions`. |
| Existing migrations | `lib/db.js` runs an idempotent `migrateSchema(db)` (internal, not exported) with `ALTER TABLE` checks via `initializeDatabase`/`getDb`, but has no versioned migration ledger. | Multi-table accounting work needs a migration convention before schema growth. Do not call `migrateSchema` directly — it is not in `module.exports`; trigger it through `initializeDatabase`/`getDb`. |
| Current account model | `accounts` has `name`, `institution`, `account_type`, and `masked_number`. | It is not enough for statement reporting; account kind, role, entity, active flag, and currency are needed. |
| Transaction model | `transactions` already has transaction date/month, statement month, source type, flow type, amount/inflow/outflow, category, confidence, reason, memo, balance, account, classification source, rule id, and reviewed flag. | Phase 1 P&L can start from reviewed transaction rows plus report-line mappings. |
| Category constants | `lib/constants.js` defines 14 user-facing categories and only `category_primary`/`memo` as editable. | Accounting report lines must be separate from user-facing categories. |
| Current reporting logic | `lib/queries/transactions.js` computes summary, breakdown, trend, balance history, monthly comparison, top movers, and fixed baseline from transaction rows. | Existing query style and spend exclusion rules should be reused, not duplicated ad hoc in UI. |
| Existing API routes | `app/api/*` currently exposes health, meta, import, summary, transactions, corrections, rules, spending, breakdown, trend, and balance history. | New report APIs should live under `app/api/reports/*` and delegate to query modules. |
| Existing UI surfaces | `app/(app)` routes and `components/*` already provide overview, transactions, trend, rules, corrections, sidebar, and shadcn-style primitives. | Add a Reports section instead of overloading the existing overview. |
| Existing tests | `test/normalize.test.js`, `test/import-dedupe.test.js`, `test/query-month-all.test.js`, and `test/reviewed-on-correction.test.js` use `node --test` patterns. | Report work should add black-box query/API tests using temp DBs. |

## Planning Skill Routing

This planning pass used `dev-skill-routing` as the routing entrypoint:

- Specification quality: `method-plan`.
- Test strategy: `testing-best-practices`.
- UI/UX planning: `taste-skill` plus the existing shadcn-style component
  surface, but UI images are not the source of truth for this work.

The implementation source of truth is this spec, the behavior contracts, and
the actual repo. Generated UI concept images, if any, are optional reference
material only and must not drive accounting logic, schema, API behavior, or
acceptance tests.

## Product Doctrine

### What The Reports Are

The reports are management statements for personal, household, project, or small
business decision-making:

- Balance Sheet: what the entity owns and owes as of a date.
- Income Statement: what the entity earned and spent over a period.
- Cash Flow Statement: how included cash changed over a period.

Every report must disclose its scope and coverage. A partial report is useful if
it is honest. An unlabeled partial report is worse than no report.

### What The Reports Are Not

- Not tax filing output.
- Not GAAP/IFRS statements.
- Not an audit trail sufficient for external assurance.
- Not a replacement for professional bookkeeping when statutory compliance is
  required.
- Not a reason to mutate original imported transaction facts.

### Statement Responsibility Matrix

| Statement | Question answered | Primary data needed | Current ledger can support | Blocks complete status |
|---|---|---|---|---|
| Management P&L / income statement | What did the entity earn and spend during the period? | Reviewed transactions plus report-line mappings. | Partially: current transactions/categories/confidence/review state are enough for a scoped first P&L after mappings exist. | Unmapped rows, low-confidence unreviewed rows, unresolved card payments/transfers/loan principal. |
| Balance sheet / net worth | What does the entity own and owe as of a date? | Account register plus explicit balance snapshots. | Weakly: current `accounts` and transaction running balances are hints only. | Missing required accounts, missing/stale snapshots, invalid account roles, equation mismatch. |
| Direct-method cash flow | How did included cash change during the period? | Beginning/ending cash snapshots, cash account transactions, transfer matches, cash-flow classes. | Partially: bank/cash rows and balances help, but snapshots and transfer matches are required. | Missing beginning/ending cash, unmatched one-sided transfers, reconciliation delta, unresolved cash-flow mappings. |

Development order follows this matrix: P&L first, then account register and
balance snapshots, then transfer matching and cash flow. Cash flow must not be
implemented by renaming the existing net-cash summary.

## Reporting Scope And Coverage Model

Every report response includes a coverage object:

```json
{
  "status": "complete | partial | unreconciled",
  "entity": "personal",
  "period": "2026-06",
  "as_of_date": "2026-06-30",
  "basis": "cash | card_accrual_management | accrual",
  "included_accounts": [],
  "missing_required_accounts": [],
  "stale_balance_accounts": [],
  "unmapped_transaction_count": 0,
  "unreviewed_transaction_count": 0,
  "unmatched_transfer_count": 0,
  "notes": []
}
```

Coverage status rules:

- `complete`: all required accounts for the selected entity/scope have current
  snapshots or reconciled beginning/ending balances, no blocking unmapped rows,
  and no blocking unmatched transfers for the report type.
- `partial`: enough data exists to compute a scoped statement, but one or more
  required accounts, mappings, or snapshots are missing.
- `unreconciled`: required arithmetic checks do not tie out, or transfer matching
  leaves blocking differences.

The UI must show this object near the report title, not hidden in a secondary
drawer.

## Accounting Logic Decisions

### Reporting Entity

An entity is the reporting boundary. Examples:

- `personal`
- `household`
- `business`
- `client-workspace`
- `project:<name>`

Default decision: entity-aware from day one, with `personal` as the default
entity for existing data.

### Basis

Supported basis labels:

- `cash`: only cash movements from included cash/bank/e-wallet accounts.
- `card_accrual_management`: expenses from credit card charges are recognized in
  the P&L at transaction date, while card payments are not counted as expenses.
- `accrual`: future opt-in mode requiring manual adjustments or imported
  receivables/payables/prepaids/depreciation/tax liabilities.

Do not fake accrual output from cash-only data.

### Credit Cards

- A credit card charge can be an expense in the management P&L.
- A credit card payment is a liability settlement and must not be counted as a
  second expense.
- Cash flow must still include the bank cash movement when the card payment is
  paid, or reconciliation will fail.
- Phase 3 default: do not allocate card payments back to original purchase
  categories. Show them as cash outflows settling card liability, with category
  detail staying in the P&L.

### Transfers

- Bank-to-bank and own-account transfers are eliminated from income statement
  expense/revenue.
- Cash flow should eliminate internal transfers when both sides are in scope.
- If only one side is imported, mark the report partial or unreconciled rather
  than pretending the cash movement is external spending.

### Loans And Investments

- Loan principal repayment is not an expense.
- Loan interest and fees can be expenses.
- Investment purchases are asset reclassification plus investing cash outflow,
  not expenses.
- Realized gains/losses require explicit mapping or future investment-lot
  support; do not infer them from cash transfer rows alone.

## Target Data Concepts

### Account Register

Existing `accounts` should be extended additively unless migration risk grows.
Required semantics:

- reporting entity;
- account kind: cash, bank, credit_card, loan, investment, e_wallet,
  receivable, payable, fixed_asset, equity, other;
- normal balance: debit or credit;
- currency;
- active flag;
- report role: asset, liability, equity, income, expense, contra;
- institution/name/masked number from current account model.

### Chart Of Accounts

The management chart of accounts is separate from the current 14 user-facing
categories.

Minimum groups:

- Assets: cash, bank deposits, receivables, investments, fixed assets, other.
- Liabilities: credit cards, loans, payables, taxes payable, other.
- Equity / net worth: opening balance, owner contribution, owner draw, retained
  earnings.
- Income: salary, business revenue, interest income, refunds/gains, other.
- Expenses: food, daily living, housing, transportation, subscriptions,
  insurance, medical, education, fees/taxes, business operating expenses.
- Transfer / clearing: internal transfer, credit-card payment, investment trade
  clearing.

### Report-Line Mapping

`category_primary` remains the human-friendly review category. Reports use a
separate mapping because accounting statements need different semantics.

Example mapping outputs:

- `income:salary`
- `income:business_revenue`
- `expense:food`
- `expense:fees_taxes`
- `asset:cash`
- `liability:credit_card`
- `transfer:internal`
- `cash_flow:operating`
- `cash_flow:investing`
- `cash_flow:financing`
- `excluded`

Default decision: report-line mapping can be rule-based, but those rules must be
separate from merchant classification rules so merchant category memory does not
corrupt accounting semantics.

### Balance Snapshots

Balance sheet and cash flow should use explicit balance snapshots rather than
inferring all balances from transaction rows.

Snapshots need:

- account id;
- entity id;
- as-of date;
- statement month when available;
- balance amount in cents;
- currency;
- source id or manual source note;
- stale/current status.

## Data Source Maps

### Reports Overview

| Display field | Source | Exists now? | Notes |
|---|---|---|---|
| Entity selector | Future `reporting_entities` plus default `personal` | No | Phase 0/1 foundation. |
| Period selector | Existing `transaction_month` and future snapshots | Yes/partial | Current UI already has month data. |
| Latest net worth | Future balance sheet query | No | Requires snapshots and account roles. |
| Period net income | Future income statement query | Partial | Can start from reviewed transactions plus mapping. |
| Cash movement | Existing `getSummary().netCashMovement`, future cash flow query | Partial | Current number is not a statement. |
| Coverage badge | Future coverage builder | No | Must be shared across report APIs. |

### Income Statement

| Output field | Source | Exists now? | Notes |
|---|---|---|---|
| Revenue lines | `transactions` plus `transaction_report_mappings` | Partial | Existing categories are insufficient. |
| Expense lines | `transactions` plus `transaction_report_mappings` | Partial | Must exclude transfers/card payments/principal. |
| Net income | Revenue minus expenses/gains/losses | No | Derived query. |
| Reviewed/unreviewed counts | `transactions.reviewed`, `classification_source`, `ai_confidence` | Yes | Use current review model. |
| Unmapped rows | Future mapping table left join | No | Drives review queue. |
| Coverage | Shared coverage builder | No | Must disclose partial scope. |

### Balance Sheet

| Output field | Source | Exists now? | Notes |
|---|---|---|---|
| Assets | Account roles plus latest snapshots | No | Current `accounts.account_type` is not enough. |
| Liabilities | Account roles plus latest snapshots | No | Credit card and loan balances required. |
| Equity / net worth | Assets minus liabilities plus future equity entries | No | First release can derive net worth. |
| Equation check | Report query arithmetic | No | Must be visible. |
| Missing accounts | Entity/account register | No | Requires required-account semantics. |
| Stale balances | Snapshot as-of date vs report date | No | Requires stale threshold policy. |

### Cash Flow Statement

| Output field | Source | Exists now? | Notes |
|---|---|---|---|
| Beginning cash | Cash account snapshots | No | Do not infer without validation. |
| Operating cash flow | Cash transaction rows plus mappings | Partial | Needs cash account roles and flow classes. |
| Investing cash flow | Cash rows mapped to investing | No | Needs investment/asset mapping. |
| Financing cash flow | Cash rows mapped to financing | No | Needs loan/equity mapping. |
| Ending cash | Cash account snapshots | No | Required for reconciliation. |
| Unmatched transfers | Future `transfer_matches` | No | Drives review queue. |
| Reconciliation delta | Beginning + net change - ending | No | Must block complete status if non-zero. |

### Review Queue

| Review item | Source | Exists now? | Notes |
|---|---|---|---|
| Unreviewed classifications | `transactions.reviewed`, `ai_confidence` | Yes | Existing needs-review flow. |
| Unmapped report lines | Future mapping table | No | Separate from category review. |
| Missing balance snapshots | Future snapshots/account register | No | Must not require fake rows. |
| Stale account balances | Future snapshots | No | Based on statement/as-of date. |
| Unmatched transfers | Future `transfer_matches` | No | Needs matching algorithm. |

## Target Owner Architecture

The implementation should keep route handlers thin and put report logic in query
or service modules.

```text
lib/
  reporting/
    coverage.js              # shared coverage/status helpers
    money.js                 # cents arithmetic helpers if needed
    report-lines.js          # mapping constants and validation
    transfer-matching.js     # pure matching candidates/scoring
  queries/
    reports/
      income-statement.js
      balance-sheet.js
      cash-flow.js
      coverage.js
app/
  api/
    reports/
      income-statement/route.js
      balance-sheet/route.js
      cash-flow/route.js
      coverage/route.js
components/
  reports/
    ReportsShell.jsx
    CoverageBadge.jsx
    IncomeStatement.jsx
    BalanceSheet.jsx
    CashFlowStatement.jsx
    ReportReviewQueue.jsx
```

Rules:

- Routes parse HTTP inputs and return JSON only.
- Query modules own SQL.
- Pure report helpers must not call `getDb()`.
- Components consume API responses; they must not duplicate accounting math.
- New shared abstractions need at least two consumers or a clear Phase 2+
  consumer listed in this spec.

## Architecture Coverage Matrix

| Dimension | Coverage in this spec | Required action |
|---|---|---|
| Data persistence | Covered through additive tables and snapshots. | Add migration convention before creating report tables. |
| Data asset independence | Covered. Reports have mappings/snapshots/runs instead of embedding data in UI. | Do not store report JSON only in browser state. |
| Schema self-containment | Partially covered. | Each report table must carry enough fields for common queries without fragile multi-hop joins. |
| Service boundary | Covered. | Keep report SQL in `lib/queries/reports/*`; keep pure helpers side-effect free. |
| Config | Minimal impact. | Use existing `FINANCE_DB_PATH` for tests and demos. |
| Error handling | Covered at API level. | Return JSON `{error}` envelopes consistent with existing API helpers. |
| Security/privacy | Covered. | Never use real DB for tests/screenshots; no server-side AI calls. |
| Testing | Covered below. | Add query/API tests per phase. |
| UI/UX reliability | Covered. | Reports need empty, partial, unreconciled, and complete states. |
| Performance | Spike required. | Benchmark report queries with larger demo data before claiming scale. |
| Deployment | Local-first only. | No external service dependencies in core report flow. |

## Behavior Contracts Required

Before implementing each behavior-changing phase, create or update contract
artifacts under `docs/contracts/` or an equivalent repo-local location. The
contract content should be produced with the `change-contract` workflow, not
copied into this architecture spec.

Required contracts:

- `report-coverage-contract.md`: coverage statuses, missing/stale/unreviewed
  semantics, and UI states.
- `management-pl-contract.md`: income statement basis, exclusions, card-payment
  handling, and net-income examples.
- `balance-sheet-contract.md`: account roles, snapshot freshness, and balance
  sheet equation behavior.
- `transfer-matching-contract.md`: candidate scoring, user confirmation,
  unmatched handling, and reconciliation effects.
- `cash-flow-contract.md`: direct-method cash flow, beginning/ending cash,
  transfer elimination, and reconciliation deltas.
- `reporting-operator-contract.md`: external AI responsibilities and
  required confidence/reason/note fields when new operator APIs are introduced.

No Phase 1+ implementation should be accepted with only "preserve existing
behavior" as the behavior contract.

Current contract files:

| Contract | Primary report/workflow owner |
|---|---|
| `docs/contracts/report-coverage-contract.md` | Shared report status and blockers. |
| `docs/contracts/management-pl-contract.md` | P&L / income statement. |
| `docs/contracts/balance-sheet-contract.md` | Balance sheet / net worth statement. |
| `docs/contracts/transfer-matching-contract.md` | Internal transfer review and effects. |
| `docs/contracts/cash-flow-contract.md` | Direct-method cash flow. |
| `docs/contracts/reporting-operator-contract.md` | External AI and human review loop. |

## Proposed Additive Schema Direction

Do not replace the current ledger. Add tables/columns in phases.

Likely additions:

- `schema_migrations` or a repo-approved migration ledger.
- `reporting_entities`
- additive columns on `accounts`: `entity_id`, `account_kind`,
  `normal_balance`, `currency`, `active`, `report_role`
- `account_balance_snapshots`
- `report_lines`
- `transaction_report_mappings`
- `report_mapping_rules`
- `transfer_matches`
- `manual_journal_entries`
- `report_runs`

Open implementation choice:

- If extending `accounts` makes migration risk high, add a `financial_accounts`
  sidecar table keyed to `accounts.id` instead. Default remains additive columns
  on `accounts`.

## External AI Contract Additions

When implementation reaches report mapping and snapshots, the Last Say
Skill must be updated so an external AI operator can provide:

- entity;
- account identity;
- account kind;
- statement period and statement ending balance;
- report line candidate;
- cash flow class;
- transfer candidate key;
- principal/interest/fee/tax/income/expense/internal-transfer/asset-purchase
  flags;
- confidence;
- one human-readable reason per AI-created mapping;
- note text for every AI-created mapping rule.

AI can propose mappings and transfer candidates, but humans must be able to
review and correct them. Corrections should write append-only evidence, following
the existing `correction_log` pattern.

## End-To-End Operating Flow

This section describes the intended real-world workflow. It covers both the
current bookkeeping product and the future accounting-report extension.

### Inputs A User May Give The AI Operator

| Input | Examples | AI responsibility | Tool persistence |
|---|---|---|---|
| Credit card statements | CSV, Excel export, PDF text, screenshots converted to text | Inspect statement format, identify current-period rows, classify merchant transactions, produce ledger CSV, propose merchant rules. | Current `transactions`, `sources`, `classification_rules`. |
| Bank account statements | CSV, Excel export, current transaction list, monthly statement | Identify inflows/outflows, running balances, transfer rows, ending balance if present. | Current `transactions`; future `account_balance_snapshots`. |
| Current transaction exports | "Current month unbilled" card transactions plus official statement | De-duplicate against imported statement rows, preserve source context, flag provisional rows when final statement is not available. | Current dedupe/import model; future source status. |
| Account list | Bank, card, loan, brokerage, wallet, masked number | Normalize account identity, propose account kind, entity, currency, active status. | Future account metadata on `accounts` or sidecar. |
| Balance snapshots | Statement ending balance, loan balance, brokerage cash, wallet balance | Extract as-of date and source note; flag missing or stale balances. | Future `account_balance_snapshots`. |
| Business/personal context | "This card is mostly business", "this account is household", project name | Assign entity and identify mixed-use accounts that need review. | Future `reporting_entities`; future transaction allocation if needed. |
| Known transfers | "This bank row pays this card", "this is moving cash to savings" | Propose transfer candidate keys and confidence. | Future `transfer_matches`. |
| User corrections | UI edits, correction log summaries, rule override history | Read correction patterns and improve rules/mapping rules. | Existing `correction_log`; future report mapping correction log or extension. |
| Chart-of-account preferences | Custom business expense groups, owner draw labels | Map categories to report lines without changing original transaction facts. | Future `report_lines` and mapping rules. |

The AI operator may use spreadsheet viewers, local file reads, and API calls to
understand user-provided files. It must not create a blind parser that bypasses
the judgment steps in the Last Say Skill. Unknown bank formats require manual
format inspection before transformation.

### AI Operator Flow

1. Preflight:
   - Read `.claude/skills/last-say-ops/SKILL.md` and its routed references.
   - Call `GET /api/health`, `GET /api/meta`, and `GET /api/rules`.
   - Confirm the target entity, period, and whether the files are official
     statements or provisional current transactions.

2. Source understanding:
   - Identify headers, amount signs, statement period, card/account identity,
     balance fields, and any rows that are not transaction rows.
   - Preserve original merchant/account text. Do not "fix" imported names in
     source fields.

3. Classification and rule preparation:
   - Use `GET /api/rules/normalize` for every merchant/rule key.
   - Apply existing rules mentally before creating new ones.
   - For uncovered merchant rows, classify with calibrated confidence and one
     human-readable reason per row.
   - Create rules only above the configured confidence threshold and with
     meaningful `note`.

4. Reporting metadata preparation:
   - Assign proposed entity/account kind/report line/cash-flow class.
   - Extract balance snapshots when the statement provides an ending balance.
   - Propose transfer candidates when both sides are visible.
   - Mark low-confidence mappings for human review instead of forcing them into
     complete reports.

5. Tool writes:
   - Current: write ledger CSV and call `POST /api/import-ledger`.
   - Current: call `POST /api/rules` for merchant category rules.
   - Future Phase 1+: write report-line mappings or mapping rules through
     dedicated report APIs.
   - Future Phase 2+: write account metadata and balance snapshots.
   - Future Phase 3+: write transfer candidates/matches.

6. User handoff:
   - Report imported rows, rules applied, new rules created, low-confidence list,
     missing accounts, stale balances, and unmatched transfers.
   - Send the user to the relevant UI queue, not to raw DB details.

7. Feedback loop:
   - User confirms or corrects UI items.
   - The tool appends correction evidence.
   - AI later reads corrections and improves merchant rules, report mapping
     rules, account mappings, or transfer matching hints.

### Tool Write Path

| Phase | Current or future API | Purpose | Human review requirement |
|---|---|---|---|
| Current | `POST /api/import-ledger` | Persist normalized ledger rows. | Low confidence appears in transaction review. |
| Current | `POST /api/rules` | Persist merchant category rules. | Rules show note/confidence and can be disabled/edited. |
| Current | `PATCH /api/transactions/:id` | Human edits category/memo and marks reviewed. | Writes append-only correction evidence. |
| Current | `POST /api/transactions/review` | Human confirms rows without field changes. | Marks rows reviewed. |
| Phase 1 | `POST /api/reports/mappings` | Persist transaction-to-report-line mappings. | Low-confidence mappings go to report review queue. |
| Phase 1 | `POST /api/reports/mapping-rules` | Persist report mapping rules separate from merchant category rules. | Must show note, confidence, and override stats. |
| Phase 2 | `PATCH /api/accounts/:id/reporting` | Persist account kind/entity/currency/report role. | Inferred values require visible review state. |
| Phase 2 | `POST /api/accounts/:id/balance-snapshots` | Persist statement/manual balance snapshots. | Manual snapshots require source note. |
| Phase 3 | `POST /api/reports/transfer-candidates` | Persist AI-proposed transfer candidates. | Low-score candidates cannot auto-confirm. |
| Phase 3 | `PATCH /api/reports/transfer-matches/:id` | Human confirms/rejects transfer matches. | Affects cash-flow coverage/reconciliation. |

Future endpoints are conceptual until their phase contracts are written. They
should follow the existing JSON error-envelope style and use `FINANCE_DB_PATH`
in tests.

## UI/UX Blueprint

The accounting-report UI is an operational review tool, not a marketing page.
It should optimize repeated review, drill-down, coverage awareness, and quick
confirmation. Use existing shadcn-style primitives first: `Sidebar`, `Tabs`,
`Card`, `Table`, `Badge`, `Alert`, `Empty`, `Skeleton`, `Dialog`, `Sheet`,
`Select`, `Checkbox`, `Textarea`, `Tooltip`, and `sonner`.

Current UI baseline:

- Keep the existing app shell: fixed left `Sidebar`, compact header, `Finance
  Viewer` eyebrow, page `h1`, right-side month selector, and transaction search.
- Keep the global `AIBanner` pattern for AI review work instead of introducing a
  separate alert style.
- Use the current light background, pale cyan sidebar, teal primary/active
  states, amber warning, and red danger semantics from `app/globals.css`.
- Use `rounded-xl` shadcn-style cards and tables with thin borders/rings,
  compact spacing, pill badges, and small lucide-style icons.
- Treat report screens as new routes inside the existing product, not as a
  separate enterprise SaaS dashboard.
- Do not copy the accidental browser-rendered serif font state. Dashboard
  typography should use the app's intended sans-serif token once the font token
  issue is fixed.

The UI/UX is not a single Reports dashboard. The minimum product experience is
a connected loop across six surfaces:

| Surface | User decision it supports | Required outcome |
|---|---|---|
| AI import intake | Which files, entity, accounts, period, and official/provisional status are being processed. | The user can see the scope before any data is written. |
| Parsing preview | Whether rows, signs, duplicates, low-confidence items, and proposed rules look sane. | The user can stop bad imports before they pollute the ledger. |
| Human review queue | Which AI classifications, report mappings, balances, and transfer matches need action. | The user can confirm, correct, or defer without losing context. |
| Reports overview | Whether P&L, balance sheet, and cash flow are complete, partial, or unreconciled. | The user reads numbers with visible coverage and blockers. |
| Report drill-down | Which transactions, mappings, and corrections produced a report line. | The user can trace and fix a number from statement to source rows. |
| Mobile review | Whether quick repeated corrections are possible away from desktop. | The user can clear review work with one-handed bottom-sheet actions. |

### Navigation Model

Primary app sections:

- Overview: current bookkeeping overview and month/all-period summary.
- Transactions: current transaction ledger and AI classification review.
- Reports: new management statements and coverage status.
- Report Review: can be a Reports tab first; later can become a sidebar item if
  review volume justifies it.
- Rules: current merchant rules plus future report mapping rules as separate
  tabs.
- Corrections: current correction history, later including report mapping and
  transfer review evidence.

Do not bury report blockers inside a single report page. If the balance sheet is
partial because a card balance is missing, the report page and review queue both
need to show the blocker.

### Desktop Reports Experience

Desktop layout:

- Left sidebar keeps the existing app navigation pattern.
- Page header contains compact filters:
  - entity selector;
  - period/as-of selector;
  - basis selector;
  - account scope selector;
  - refresh/recompute action if report runs are cached later.
- The coverage badge sits beside the report title.
- Tabs: Overview, Income Statement, Balance Sheet, Cash Flow, Review.
- Top row uses compact status cards:
  - coverage percent;
  - unmapped rows;
  - unmatched transfers;
  - stale balances;
  - latest import date.
- Main area uses statement tables, not decorative chart cards.
- Right rail or secondary panel can show coverage distribution and blockers.

Desktop review queue:

- Use dense table layout with tabs for:
  - unmapped report lines;
  - unmatched transfers;
  - stale/missing balances;
  - low-confidence transactions.
- Each row shows:
  - source account;
  - date/as-of date;
  - amount;
  - AI suggestion;
  - confidence;
  - blocker status;
  - one-click confirm;
  - edit/reclassify action.
- Bulk actions are allowed only when the selected rows share a safe operation.
- Row detail expands inline or opens a `Sheet`, preserving table position.

### Mobile Reports Experience

Mobile layout:

- Keep page headers short.
- Use stacked report cards for Overview, Income Statement, Balance Sheet, and
  Cash Flow.
- Each card shows:
  - title;
  - coverage status badge;
  - one key number;
  - one blocker line;
  - progress bar only when it helps scanning.
- Move detailed statement tables behind tap-through screens or horizontal
  sections; do not squeeze desktop tables into mobile.
- Review actions use a bottom-sheet style:
  - transaction/account summary;
  - AI reason;
  - confidence;
  - category selector;
  - report-line selector;
  - confirm button;
  - create rule action;
  - link to related rows/corrections.
- Mobile review should support one-handed repeated confirmation. Primary action
  stays visible near the bottom.

### Required UI States

Every report screen must have:

- Loading state with layout-shaped skeletons.
- Empty state explaining what to import next.
- Partial state listing missing data without hiding computed values.
- Unreconciled state showing the arithmetic or transfer blocker.
- Complete state showing the checks that passed.
- Error state with retry and no data loss.

### User Operations

The user should be able to:

- Select entity, period, basis, and account scope.
- Import statements through the AI-assisted workflow.
- See whether a report is complete, partial, or unreconciled before reading
  numbers.
- Drill from any report line to the underlying transactions.
- Confirm a low-confidence transaction without editing it.
- Edit transaction category/memo using the existing review path.
- Confirm or correct a report-line mapping.
- Confirm, reject, or edit a transfer match.
- Add a missing balance snapshot with source note.
- Mark an account as intentionally excluded from the current scope.
- Create a merchant classification rule from a reviewed transaction.
- Create a report mapping rule from repeated mapping corrections.
- Return to the report and see coverage improve after review.

### Linkage With Current Bookkeeping Features

| Current feature | How reports should connect |
|---|---|
| Month/all-period selector | Reports use the same month concept, but balance sheet also needs as-of date. |
| Overview monthly cards | Reports Overview can reuse current summary as sanity context, but statement numbers come from report queries. |
| Transactions list | Every report line and blocker must drill down to filtered transactions. |
| Needs-review queue | Existing low-confidence transaction review remains; report review adds unmapped lines, stale balances, and unmatched transfers. |
| Merchant category rules | Keep as merchant/category memory only. Do not use them directly as accounting report rules. |
| Correction log | Existing correction evidence teaches merchant rules; future mapping/transfer corrections should follow the same append-only pattern. |
| Rules manager | Add separate tabs or sections for merchant rules and report mapping rules. |
| Category breakdown | Can be shown beside P&L, but report lines remain the statement source of truth. |
| Balance history | Becomes a weak input signal only; balance sheet completeness depends on snapshots. |
| Demo seed | Must include anonymized report scenarios so UI can show complete/partial/unreconciled states safely. |

## UI Implementation Constraints

- Use existing shadcn-style components before creating custom primitives.
- Do not add a marketing hero page for reports.
- Do not use purple/blue AI-glow aesthetics or decorative blob backgrounds.
- Keep desktop pages dense but readable; keep mobile pages optimized for scanning.
- Use semantic status colors for complete/partial/unreconciled/error states.
- Do not show exact real merchant/account data in screenshots or public docs.
- Numbers should use tabular/monospace styling where comparison matters.
- Use `Sheet`/`Dialog` with accessible titles for detail and edit flows.
- Use `Badge` for statuses, `Alert` for blockers, `Empty` for empty states, and
  `Skeleton` for loading states.

## Work Packages

### Phase 0: Contracts, Fixtures, And Migration Convention

Goal:

- Make the reporting work executable without touching real data or production
  schema.

Files likely touched:

- `docs/accounting-reports-spec.md`
- `docs/contracts/*.md`
- `test/fixtures/reporting/*.csv` or generated anonymized fixture builders
- `scripts/seed-demo.js` only if demo data needs reporting examples
- `lib/db.js` or a new migration helper if migration convention is introduced

Files not to touch:

- `data/finance.sqlite`
- real `uploads/` and `outputs/`
- current import amount/date/source semantics

Implementation constraints:

- Use anonymized demo data only.
- Define acceptance examples before adding report APIs.
- If a migration ledger is added, it must coexist with existing
  `migrateSchema(db)` (internal, triggered via `initializeDatabase`/`getDb`,
  not exported) and existing DBs.

Validation:

```powershell
# Windows PowerShell
git diff --check -- docs/accounting-reports-spec.md docs/contracts
$env:FINANCE_DB_PATH="data/reporting-phase0.test.sqlite"; npm test -- test/normalize.test.js test/import-dedupe.test.js
```

```bash
# macOS / Linux (bash, zsh) — bare VAR=val works in POSIX shells
git diff --check -- docs/accounting-reports-spec.md docs/contracts
FINANCE_DB_PATH=data/reporting-phase0.test.sqlite npm test -- test/normalize.test.js test/import-dedupe.test.js
```

Done when:

- Contracts exist for report coverage, P&L, balance sheet, transfer matching,
  cash flow, and the external AI operator flow.
- End-to-end AI operator flow, human review responsibilities, and PC/mobile UI
  states are documented.
- Demo/fixture data covers at least checking, savings, credit card, loan, and
  investment account examples.
- No real data path is used.

Out of scope:

- No report UI.
- No report API.
- No balance sheet or cash flow computation.

### Phase 1: Scoped Management P&L

Goal:

- Produce a scoped income statement from reviewed transaction rows plus
  report-line mappings.

Current owner:

- `transactions` and existing summary/breakdown queries.

Target owner:

- `lib/queries/reports/income-statement.js`
- `lib/reporting/coverage.js`
- `app/api/reports/income-statement/route.js`
- `components/reports/IncomeStatement.jsx`

Files likely touched:

- `lib/db.js`
- `lib/reporting/report-lines.js`
- `lib/queries/reports/income-statement.js`
- `app/api/reports/income-statement/route.js`
- `components/reports/*`
- `app/(app)/reports/page.js`
- `components/AppSidebar.jsx`
- `components/TransactionTable.jsx` only if adding report-line drilldown or
  report-mapping review affordances to existing transaction review
- `components/Overview.jsx` only if adding report entrypoints or report coverage
  summary to the current overview
- Last Say Skill references if external AI is asked to create mappings
- `test/reporting-income-statement.test.js`

Compatibility rules:

- Existing `/api/summary`, `/api/breakdown`, `/api/transactions`, and overview
  UI must continue to work.
- Existing `category_primary` remains editable and user-facing.
- Report mapping must not mutate original transaction amount/date/source fields.
- Credit-card payments and internal transfers are excluded from P&L expenses.
- Transaction review remains the place to fix merchant categories; report review
  handles statement mapping blockers.

Validation:

```powershell
# Windows PowerShell
$env:FINANCE_DB_PATH="data/reporting-phase1.test.sqlite"; npm test -- test/reporting-income-statement.test.js test/import-dedupe.test.js test/reviewed-on-correction.test.js
npm run build
# If UI is implemented in this phase, capture desktop and mobile screenshots
# against a demo DB and verify partial/empty/complete states.
```

```bash
# macOS / Linux (bash, zsh)
FINANCE_DB_PATH=data/reporting-phase1.test.sqlite npm test -- test/reporting-income-statement.test.js test/import-dedupe.test.js test/reviewed-on-correction.test.js
npm run build
# If UI is implemented in this phase, capture desktop and mobile screenshots
# against a demo DB and verify partial/empty/complete states.
```

Done when:

- API returns revenue, expenses, net income, unmapped count, unreviewed count,
  and coverage.
- Desktop UI shows report tabs, coverage near the title, P&L table, and drilldown
  to transactions.
- Mobile UI shows compact report cards and a review detail sheet for unmapped
  rows.
- UI shows complete, partial, empty, and unmapped states.
- Acceptance examples prove card payments are not double-counted as expenses.

Out of scope:

- Balance sheet.
- Cash flow statement.
- Accrual adjustments.

### Phase 2: Account Register And Balance Snapshots

Goal:

- Add account semantics and balance snapshots, then compute a scoped balance
  sheet.

Target owner:

- `lib/queries/reports/balance-sheet.js`
- account metadata queries or helpers
- `app/api/reports/balance-sheet/route.js`
- `components/reports/BalanceSheet.jsx`

Files likely touched:

- `lib/db.js`
- `lib/queries/reports/balance-sheet.js`
- `app/api/reports/balance-sheet/route.js`
- `components/reports/*`
- account metadata review UI, either under Reports Review or a dedicated account
  settings surface
- Last Say Skill references for statement ending balances
- `test/reporting-balance-sheet.test.js`

Compatibility rules:

- Existing imported accounts remain valid.
- Existing transactions can default to `personal` entity and inferred account
  kind, but inferred values must be reviewable.
- Balance sheet completeness depends on snapshots, not transaction inference.
- Current balance-history UI remains a transaction-derived trend and must not be
  relabeled as a complete balance sheet.

Validation:

```powershell
# Windows PowerShell
$env:FINANCE_DB_PATH="data/reporting-phase2.test.sqlite"; npm test -- test/reporting-balance-sheet.test.js test/reporting-income-statement.test.js
npm run build
```

```bash
# macOS / Linux (bash, zsh)
FINANCE_DB_PATH=data/reporting-phase2.test.sqlite npm test -- test/reporting-balance-sheet.test.js test/reporting-income-statement.test.js
npm run build
```

Done when:

- Balance sheet returns assets, liabilities, net worth/equity, equation check,
  stale balance list, and missing account list.
- Partial balance sheet is visibly labeled partial.
- PC and mobile UI expose missing/stale balance review actions.
- No current transaction review behavior regresses.

Out of scope:

- Transfer matching.
- Cash flow statement.
- Manual journal entries.

### Phase 3: Transfer Matching And Cash Flow

Goal:

- Match internal transfers and produce direct-method cash flow with
  reconciliation.

Target owner:

- `lib/reporting/transfer-matching.js`
- `lib/queries/reports/cash-flow.js`
- `app/api/reports/cash-flow/route.js`
- `components/reports/CashFlowStatement.jsx`
- `components/reports/ReportReviewQueue.jsx`

Files likely touched:

- `lib/db.js`
- `lib/reporting/transfer-matching.js`
- `lib/queries/reports/cash-flow.js`
- `app/api/reports/cash-flow/route.js`
- `components/reports/*`
- `test/reporting-cash-flow.test.js`
- `test/transfer-matching.test.js`

Compatibility rules:

- Internal transfer elimination must not change the source transaction rows.
- Cash flow must reconcile beginning and ending cash or return `unreconciled`.
- Transfer matches should be reviewable; do not silently auto-confirm low-score
  matches.
- Current transaction filters for transfers/card payments remain available for
  audit drilldown.

Validation:

```powershell
# Windows PowerShell
$env:FINANCE_DB_PATH="data/reporting-phase3.test.sqlite"; npm test -- test/transfer-matching.test.js test/reporting-cash-flow.test.js test/reporting-balance-sheet.test.js
npm run build
```

```bash
# macOS / Linux (bash, zsh)
FINANCE_DB_PATH=data/reporting-phase3.test.sqlite npm test -- test/transfer-matching.test.js test/reporting-cash-flow.test.js test/reporting-balance-sheet.test.js
npm run build
```

Done when:

- Cash flow returns beginning cash, operating/investing/financing sections,
  ending cash, reconciliation delta, and unmatched transfers.
- One-sided transfers make coverage partial or unreconciled.
- Card payments are cash movements but not P&L expenses.
- PC and mobile review flows allow confirm/reject/edit transfer matches.

Out of scope:

- Allocating card payments back to original merchant categories.
- Investment lot accounting.
- Full accrual accounting.

### Phase 4: Accrual Adjustments

Goal:

- Add opt-in manual journal entries and accrual adjustments after cash/card
  reporting is stable.

Target owner:

- `manual_journal_entries`
- future journal-entry query/API/UI modules
- report queries that accept basis `accrual`

Compatibility rules:

- Cash and card-accrual management reports must still be available.
- Manual entries require explicit source notes and review trail.
- Accrual basis must be labeled opt-in.

Validation:

```powershell
# Windows PowerShell
$env:FINANCE_DB_PATH="data/reporting-phase4.test.sqlite"; npm test -- test/manual-journal-entries.test.js test/reporting-income-statement.test.js test/reporting-balance-sheet.test.js
npm run build
```

```bash
# macOS / Linux (bash, zsh)
FINANCE_DB_PATH=data/reporting-phase4.test.sqlite npm test -- test/manual-journal-entries.test.js test/reporting-income-statement.test.js test/reporting-balance-sheet.test.js
npm run build
```

Done when:

- Receivables, payables, prepaids, depreciation, tax liabilities, and manual
  adjusting entries can affect reports with visible provenance.

Out of scope:

- Tax filing automation.
- Audit-grade accounting controls.
- Multi-currency remeasurement unless Phase 4 explicitly expands scope.

## Acceptance Examples

Minimum examples for Phase 0 fixtures and Phase 1-3 tests:

1. Credit card charge plus payment:
   - Card restaurant charge: NT$1,000.
   - Bank payment to card: NT$1,000.
   - P&L expense: NT$1,000 once.
   - Cash flow includes the bank cash outflow once.
   - No double-counted expense.

2. Bank-to-bank transfer:
   - Checking outflow NT$5,000.
   - Savings inflow NT$5,000 within the match window.
   - Income statement excludes both.
   - Cash flow eliminates both when both accounts are in scope.

3. One-sided transfer:
   - Checking outflow NT$5,000 with no imported receiving account.
   - Report status is `partial` or `unreconciled`.
   - UI shows unmatched transfer.

4. Loan payment split:
   - Principal NT$9,000 and interest NT$1,000.
   - Principal is not an expense.
   - Interest is an expense and cash outflow.

5. Investment purchase:
   - Brokerage cash outflow NT$20,000.
   - Not an expense.
   - Classified as investing cash outflow or asset reclassification depending
     on account scope.

6. Missing credit card account:
   - Bank and cash accounts imported, card statement missing.
   - Income statement can be scoped partial.
   - Balance sheet cannot be complete.

7. Stale balance:
   - Last snapshot is before the selected as-of date beyond policy threshold.
   - Balance sheet shows stale account and does not claim complete coverage.

## Testing Strategy

Follow the existing `node --test` style and use temp DBs through
`FINANCE_DB_PATH`.

Test layers:

- Pure unit tests for report-line validation, coverage status selection, and
  transfer candidate scoring.
- Query integration tests using a real SQLite temp DB initialized by the app
  schema.
- API contract tests for `/api/reports/*` response shape and error envelopes.
- Component or browser tests only for critical UI states: empty, partial,
  complete, unreconciled, and review-needed.
- Responsive UI evidence for desktop and mobile report flows when UI is changed:
  at minimum one desktop screenshot and one mobile screenshot per new report
  surface using anonymized demo data.
- Drilldown tests or manual evidence proving that report rows can navigate to
  the underlying transaction filters without losing entity/period context.

Test rules:

- Prefer black-box tests through public query/API functions.
- Do not mock internal report helpers.
- Stub only architectural boundaries such as filesystem input fixtures.
- Each test owns its fixture data or DB path.
- Use realistic anonymized finance examples, not `"foo"` rows.
- Keep full end-to-end/browser tests few and focused.
- Never point visual tests or demo screenshots at `data/finance.sqlite`.

## Spike Requirements

### SPIKE: Transfer Matching Algorithm

- Assumption: date window, opposite direction, amount equality, account roles,
  and counterparty/name hints are enough for useful candidates.
- Risk: many-to-one payments, delayed settlements, split transfers, and card
  payments can create false matches.
- Validation: build fixture cases and score candidates without writing matches.
- Blocks: Phase 3.
- Fallback: require manual transfer linking before cash flow can be complete.

### SPIKE: Balance Snapshot Import Formats

- Assumption: bank/credit-card statements expose ending balance and as-of date in
  parseable locations.
- Risk: some CSV exports contain only transaction-level running balance or no
  ending balance.
- Validation: test against anonymized examples of supported bank/card formats.
- Blocks: Phase 2 completeness claims.
- Fallback: allow manual snapshot entry with source note.

### SPIKE: Entity And Account Mapping

- Assumption: account-level entity defaults cover most personal/business splits.
- Risk: mixed-use accounts require transaction-level allocation.
- Validation: define examples for shared credit cards and mixed business/personal
  bank accounts.
- Blocks: entity-complete reporting.
- Fallback: single default entity plus explicit partial warning.

### SPIKE: Multi-Currency

- Assumption: storing currency metadata now is enough; conversion can wait.
- Risk: mixed-currency net worth is misleading without FX rates and valuation
  date.
- Validation: fixture with TWD and USD accounts.
- Blocks: complete multi-currency balance sheet.
- Fallback: group by currency and mark consolidated total unavailable.

### SPIKE: Query Performance

- Assumption: SQLite aggregation over local transaction tables is sufficient for
  personal/small-business scale.
- Risk: report joins over mappings, snapshots, transfer candidates, and tags may
  slow down at larger row counts.
- Validation: generate anonymized fixture DB with at least 100k transactions and
  benchmark report queries.
- Blocks: public performance claims.
- Fallback: add indexes and report-run cache table.

## Open Decisions

- D1: Extend existing `accounts` or add `financial_accounts`.
  Default: extend `accounts` with additive columns unless migration risk grows.
- D2: Personal-only first or entity-aware from day one.
  Default: entity-aware from day one; default entity is `personal`.
- D3: Rule-based report-line mapping.
  Default: yes, but use separate `report_mapping_rules`, not
  `classification_rules`.
- D4: Multi-currency in first reporting release.
  Default: store currency metadata now; convert/report multi-currency later.
- D5: Allocate credit-card payments back to original purchase categories.
  Default: no in Phase 3. Show payment as cash-flow settlement and rely on P&L
  for expense category detail.
- D6: Versioned migrations.
  Default: introduce the smallest migration ledger before adding multiple report
  tables, while preserving existing `migrateSchema(db)` compatibility. Note:
  `migrateSchema` is internal (not in `module.exports`); it runs through
  `initializeDatabase`/`getDb`. Any migration ledger must hook into that same
  path rather than calling `migrateSchema` directly.

## Execution Readiness Verdict

Verdict: Ready for Phase 0. Phase 1-4 are conditionally executable only after
their prerequisite contracts, fixtures, and spikes are completed.

Blockers before Phase 1 implementation:

- Create the Phase 1 behavior contract.
- Add anonymized acceptance fixtures.
- Decide the migration convention.
- Define the initial report-line taxonomy and mapping API.

Execution risks:

- Skipping coverage status will make partial reports look authoritative.
- Reusing `category_primary` as accounting report lines will mix UX categories
  with statement semantics.
- Inferring balance sheet values from transaction rows will create false
  completeness.
- Auto-matching transfers without human review can corrupt cash flow.
- Adding report APIs without updating the Last Say Skill will leave external
  AI operators using stale contracts.

Repo checks to rerun before each phase:

```powershell
git status --short
rg -n "CREATE TABLE|ALTER TABLE|migrateSchema" lib/db.js
rg -n "EDITABLE_FIELDS|STANDARD_CATEGORIES" lib/constants.js .claude/skills/last-say-ops
rg -n "summary|transactions|corrections|rules|balance-history" app/api lib/queries
npm test
npm run build
```
