# Financial Dashboard Design QA

Status: Passed
Final result: passed
Last validated: 2026-07-21

## Scope

- Source visual: `C:\Users\User\.codex\generated_images\019f5f26-60df-7561-abe5-f3532825c598\exec-07299e6a-163a-4f6f-ad66-a233c2f3a10f.png`
- Implementation: `http://127.0.0.1:3127/control?month=2026-07&taiwan_instrument_keys=c65cbad6-e950-4895-b0f3-c8acf230866c&taiwan_leverage_factor=2`
- Protected flow: `components/TransactionTable.jsx` and its correction, review, batch-edit, API and persistence behavior.
- Browsers and sizes checked: in-app Browser at the default 1280×720 viewport and 390×844 mobile；兩者皆以正式資料 read models 驗證。
- Final real-data audit captures: `outputs/consultation-audit-2026-07-21/08-control-final.png`, `09-balance-final.png`, and `10-cashflow-final.png`.

## Target intent

The selected visual defines a compact daily dashboard, not a report or consultation document. The first screen should answer: current financial position, this month's movement, what is unresolved, asset/debt structure and whether investment risk can actually be calculated.

## Comparison passes

### Pass 1 — desktop structure and fidelity

The target image and a 1440×1024 implementation screenshot were opened together and compared for navigation, hierarchy, spacing, typography, status treatment, metric order, card layout, colors and icons.

Findings and fixes:

- **P2 — excess explanatory copy:** metric footnotes and repeated caveats made the dashboard feel like a report. Removed the repeated notes, balance footer and page footer; retained one status detail and task descriptions only.
- **P2 — first-screen density:** the original `/control` stacked five full analytical views, including a 90-day daily timeline. Replaced it with one status strip, four metrics and four action-oriented panels.
- **P2 — navigation noise:** the sidebar fetched and permanently displayed category totals alongside nine flat routes. Reduced it to five daily destinations plus one subdued data-management entry.
- **P2 — unrelated global controls:** transaction search and AI review banner appeared outside the transaction workflow. Limited both to `/transactions`.
- **P2 — semantic landmark duplication:** `SidebarInset` and the shell both rendered `<main>`. The shell content wrapper is now a `<div>`; runtime inspection confirms one `<main>` and one `<h1>`.
- **P2 — build warning:** the first draft used an unavailable Lucide icon export. Replaced it with an installed icon and rebuilt without application compile warnings.

### Pass 2 — responsive and accessibility

Findings and fixes:

- **P2 — mobile scan length:** four headline metrics initially stacked as four full-width rows. Changed them to a readable 2×2 grid at 390px, reducing page height while retaining full values.
- **P2 — control tap size:** the month control was 32px high because the shared Select size selector overrode its class. Added an equal-specificity 44px height override; the data-status control is also 44px and the mobile menu trigger is 44px.
- **Passed — overflow:** no horizontal page overflow at 1440px, 942px or 390px.
- **Passed — wrapping:** the status statement wraps normally on mobile; amounts remain visible in the 2×2 metric grid.
- **Passed — focus:** the month selector shows a visible focus ring; navigation and task rows are keyboard-reachable links.
- **Passed — semantic labels:** dashboard status and headline metrics are named regions; the page has one level-one heading.

### Pass 3 — interactions and protected workflow

- Opened and dismissed the mobile sidebar; all five daily links and the data-management link were present.
- Opened the month selector with the keyboard and confirmed the available month options.
- Followed `資料狀態` to `/data`.
- Opened `/data?tab=investments` and confirmed that `投資估值` is selected from the URL.
- Opened `/transactions?month=2026-07`; the original search, confirmation and edit controls rendered. No transaction edit or write action was performed.
- Browser console check returned no current errors.

## Data-fidelity decisions

- Live read-model values replace mock values. The dashboard no longer presents `NT$16,000` as if it were a complete monthly obligation：它明確拆成「已建檔固定生活義務」、「貸款／卡款月付」與「完整每月生存線」；後兩者缺 canonical schedule／policy 時保持未知。
- `financial_dashboard_history` excludes the current partial month and computes six completed-month averages from Monthly Pulse facts. Formal data currently returns six partial months, so the UI labels them「已確認紀錄平均」而不是穩定收入或最低必要支出。
- The owner-confirmed Taiwan holding is now a governed `00675L` position with an owner-confirmed quantity and a dated official quote. The dashboard identifies the instrument directly; a 2× leverage factor remains an explicit page-level scenario rather than a silently persisted canonical fact.
- The scenario view shows factor exposure and 10%／20% pressure losses from the current read model. Without the explicit factor parameter, the same card remains unavailable instead of guessing leverage.
- Null exposure, missing schedules and incomplete month boundaries are never rendered as zero.

## Automated verification

- `npm run lint` — passed.
- Focused dashboard/history/financial-health tests — passed, 11/11 tests.
- `npm run test:e2e -- e2e/monthly-financial-pulse.spec.js` — passed, 2/2 Chromium flows.
- `npm run build` — passed; 78 static pages generated and no application compile warnings.
- `npm run verify:release` — passed after the local consultation bundle was explicitly isolated as private `/audit/` material：Node 239/239、Chromium 7/7、Skill eval 18/18，另含 lint、production audit/build、runtime smoke、privacy scan、匿名 backup／restore rehearsal與screenshot checks。

## Remaining findings

No open P0, P1, P2 or P3 design findings from the consultation-readiness pass.

- **Known data limits, not presentation defects:** loan schedules and some month-opening cash boundaries remain incomplete; the dashboard and reports expose those limits rather than manufacturing complete answers.
- **Environment-only:** the Next.js development-tools floating control may overlap the bottom-left corner in local development screenshots; it is not product UI and is absent from production output.

## Update rule

Update this file when the dashboard hierarchy, responsive breakpoints, main navigation, protected transaction flow or selected source visual changes. Re-run the desktop/mobile comparison and interaction checks before marking the result passed again.
