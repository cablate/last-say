# Development And Testing

用途：記錄 Last Say 的實際開發約束、測試層次、CI／release gate與目前驗證盲點。

Last validated against repository: 2026-07-15

## 開發基本規律

1. 先讀 `AGENTS.md`、相關 contract／ADR與 [`../architecture/MODULE-MAP.md`](../architecture/MODULE-MAP.md)。
2. 修改前以 `rg`、test與必要時 CodeGraph確認 consumer／caller；CodeGraph cwd 必須是專案根目錄。
3. 不讀、不覆蓋、不 commit `data/`、`uploads/`、`outputs/`中的真實資料。
4. 任何 DB schema演進走 `lib/db/migrations/**`，保留 checksum／upgrade／newer-version語意。
5. money使用 integer minor units與 canonical currency exponent，不自行寫 `*100`。
6. human-reviewed facts、append-only logs、preview／confirmation boundary不可被重構繞過。
7. 行為變更先定義可驗證 contract，完成後回寫功能／架構／現況文件。

## 常用指令

| 指令 | 作用 | 是否碰預設真實 DB |
|---|---|---|
| `npm run lint` | ESLint，0 warnings | 否 |
| `npm test` | `node --test` 全套 tests | 若未覆寫環境，個別 test應自行隔離；建議透過 verifier |
| `npm run test:e2e` | 隔離 temp DB／port／build output，在 Chromium 執行 Data Center 與 reports 關鍵流程 | 否；`scripts/run-browser-e2e.mjs` 建立並清理隔離資源 |
| `npm run eval:skill` | 8 個固定 external AI skill案例 | 否 |
| `npm run build` | Next production build | 可能載入 DB-dependent modules；建議指定隔離 DB |
| `npm run smoke:runtime` | 隔離 runtime DB、health／transactions page／CSP | 腳本硬性拒絕非 `data/dev-verify-runtime.sqlite` |
| `npm run backup:check -- --directory <path> --max-age-hours <hours>` | 驗證最新 backup manifest、hash、SQLite integrity、foreign keys、schema與新鮮度 | 僅 read-only 開啟指定 backup |
| `npm run audit:prod` | production dependency audit，moderate以上失敗 | 否；需要 npm audit資料 |
| `npm run verify:release` | 完整 release gate | 明確不開啟 `data/finance.sqlite` |

最安全、最完整的提交前命令：

```powershell
npm run verify:release
```

## Release verifier 做什麼

`scripts/verify-release.mjs` 依序執行：

1. ESLint，禁止 warnings。
2. `npm audit --omit=dev --audit-level=moderate`。
3. `node --test`，指定 `data/dev-test.sqlite`。
4. 隔離 Chromium browser E2E，覆蓋 JPY balance、manual investment valuation與正式報表不可用狀態。
5. external AI skill eval，要求 8/8。
6. Next build，指定 `data/dev-verify-build.sqlite` 與 `.next-verify`。
7. runtime smoke，指定 `data/dev-verify-runtime.sqlite`。
8. tracked 與 untracked、未被 Git ignore 的 JS／JSX／JSON／Markdown personalized-residue scan。
9. 匿名 demo seed與跨月 automation／foundation fixture檢查。
10. 匿名 DB backup → new-path restore → integrity／row/evidence核對。
11. committed demo screenshots存在與尺寸檢查。

開始與失敗時都會清除 verifier DB與 `.next-verify`。腳本輸出明示 `realDb=data/finance.sqlite (not opened by this script)`。

## 測試覆蓋地圖

| 範圍 | 代表測試 |
|---|---|
| migration／schema | `migration-runner.test.js`、`database-foundation.test.js`、`unit-a-migrate-schema.test.js` |
| legacy import／review／rules | `import-dedupe`、`review-policy`、`reviewed-on-correction`、`rule-history-reclassification`、`learning-context` |
| management reports | `reporting-income-statement`、`report-mappings-api`、`report-mapping-rules-api` |
| contract／money／scope | `financial-contracts`、`money-decimal`、`money-presentation`、`financial-scope`、`financial-readiness` |
| typed ingestion／reverse | `financial-ingestion`、`compound-ingestion`、`ingestion-reversal` |
| cards／liabilities／commitments | `credit-card-storage`、`credit-card-installments`、`liability-storage`、`commitments` |
| investment／valuation | `investment-storage`、`investment-valuation`、`manual-investment-entry` |
| reconciliation／identity／review | `transfer-matching`、`reconciliation`、`identity-merge`、`valued-items` |
| security／errors／confirmation | `api-error-safety`、`human-confirmation`、`runtime-smoke-safety` |
| operations／operator | `backup-restore`、`backup-health`、`local-next-launcher`、`financial-operator-contract`、`foundation-demo-and-skill-eval` |
| control Phase 0 reference | `control-cash-timeline`（synthetic fixture、coverage degradation、reserve breach、runway與 safe-to-spend gate） |
| Financial Control runtime slices | `control-monthly-financial-pulse`、`control-financial-health`（query-time deterministic read models、coverage、watermark與compact Context Pack） |
| browser workflow | `e2e/data-center-and-reports.spec.js` |

## CI

`.github/workflows/ci.yml` 在 main push、所有 PR與手動觸發執行 `npm ci`、安裝 Playwright Chromium及 `npm run verify:release`，timeout 15 分鐘，同一 ref的新 run取消舊 run。`.github/workflows/codeql.yml` 在 main push／PR與每週一執行 JavaScript CodeQL。

沒有 release publish、deployment或 migration dry-run環境。

## 缺少的驗證

- 沒有 TypeScript／static typecheck；JavaScript contract靠 runtime validation與test。
- Browser E2E 目前只覆蓋一條高風險 operator 流程；尚未覆蓋完整 onboarding、mobile、多瀏覽器、所有錯誤復原與 legacy import／review UI。
- 沒有正式效能、長時間運行、large-DB、lock contention或多瀏覽器併發測試。
- 沒有可公開聲稱的 code coverage threshold。
- 沒有真實 user data驗證；這是刻意隱私限制，不應以讀真實資料補足。
- 沒有多平台 CI matrix；只有 Ubuntu + Node 22，雖然主要使用情境也包含 Windows。

## 失敗分類與記錄

驗證失敗時至少記錄：command、exit status、第一個實質 error、環境或程式分類、是否影響本次結論、建議 owner。不得修改 test或設定只為變綠。

- dependency audit因 registry不可達：環境限制；仍需在有網路 CI重跑。
- test assertion／build compile失敗：程式問題，除非有明確外部環境證據。
- `SQLITE_BUSY`：先確認是否有 dev server／CLI同時持有目標 DB，再檢查 transaction。
- real DB path guard失敗：停止，不要改 guard；改用 verifier指定的隔離 path。

## 文件驗證

Markdown不是 release verifier的完整 link checker。文件變更至少再跑：

```powershell
git diff --check
git status --short
```

並檢查新增相對連結目標、狀態標頭與 `Last validated`。功能文件中的檔案／symbol evidence須以 `Test-Path`／`rg`重新確認。

更新觸發：scripts、CI、test layout、release gate、安全 guard或已知 coverage缺口改變時更新。
