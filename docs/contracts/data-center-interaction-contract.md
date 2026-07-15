---
schema_version: behavior-contract/v1
id: finance.data-center.interaction-stabilization
title: 財務資料中心金額、帳戶、投資與報表可用性契約
status: active
owner_surface: ui-api
last_validated_against_repository: 2026-07-15
change_context:
  type: bugfix-and-feature
  reason: 修正零位小數幣別錯算，補齊人工建立財務資料的必要入口，並停止用靜態 readiness 文字冒充正式報表。
  non_goals:
    - 不新增或改寫 canonical database schema。
    - 不把人工投資輸入擴張成完整券商交易、成本法或稅務系統。
    - 不在尚無正式 query 時推導資產負債表或現金流量表數字。
    - 不改變 external AI structured-ingestion 與人類確認邊界。
---

# 財務資料中心互動穩定化契約

## Behavior Boundary

本契約擁有瀏覽器端 major-unit 金額輸入／minor-unit 顯示、帳戶建立選項、人工投資估值資料入口，以及未完成報表的誠實可用性呈現。Canonical money、account、source、holding、quote 與 FX semantics 仍由既有 finance contracts、validators 與 typed queries 擁有。

## Consumers And Entrypoints

- `components/finance-data/AccountRegister.jsx`、`ObligationRegister.jsx`、`InvestmentRegister.jsx`。
- `components/reports/ReportsView.jsx`。
- `lib/finance/money/presentation.js`。
- `/api/finance/accounts`、`/balance-snapshots`、`/credit-cards`、`/liabilities`、`/commitments`。
- `/api/finance/investments/instruments` 與 bounded manual holding／quote／FX endpoints。

## Inputs And State

- UI 金額輸入以帳戶或表單選定幣別解讀；minor-unit exponent 必須呼叫 `lib/finance/money/decimal.js#currencyExponent`，不得在 component 內複製 `* 100`。
- JPY exponent 為 0；目前其餘支援幣別 exponent 為 2。輸入超過 exponent 的小數位直接拒絕，不得靜默四捨五入。
- 新帳戶可選 canonical `account_kind` 與 `SUPPORTED_CURRENCIES`；既有帳戶的 kind／currency 在此 UI 視為 identity，不可就地更改。
- Card／liability 金額幣別由所選帳戶帶入；一般 commitment 必須明確選幣別。
- 人工 investment entry 必須保存 `manual_note` source，authority=`user_confirmed`、review_state=`confirmed`。

## Outputs And Side Effects

- Major amount 轉換為 canonical decimal integer string；顯示則從 integer minor units 精確格式化，不經 binary float。
- 人工 holding、market quote、FX quote 的 source 與 typed fact 必須在同一 DB transaction 成功或回滾。
- 新增 investment fact 後重新取得 inventory；缺 quote／FX 時仍顯示既有 readiness gap，不湊估值。
- Balance Sheet／Cash Flow tab 只顯示「正式報表尚未實作」與前往 Data Center 的下一步，不顯示資料推論、靜態狀態表或財務數字。

## UI States

- 金額欄位具可見 label、幣別、對應 `inputMode`、submit error 的 `role=alert`。
- Investment dialogs 具 loading、empty-account／empty-instrument、saving、error 與 success-refresh 狀態。
- 未完成報表具明確 unavailable title、原因、目前可做的動作；不可使用「部分可用」暗示已執行正式 statement query。

## Invariants

- Money canonical value 永遠是 integer minor-unit string；不得由 UI 傳 float。
- 手動 quote／holding currency 必須等於 instrument identity；投資帳戶本身可包含不同報價幣別的工具，否則 fail closed。
- Source evidence 不得因第二步失敗留下 orphan row。
- Existing typed APIs、authority、review、append-only change log 與 readiness semantics 不變。
- P&L 仍是唯一已 data-backed 的 statement UI；此切片不宣稱 Balance Sheet／Cash Flow 完成。

## Acceptance Examples

1. Given JPY 帳戶輸入 `123456`，when 建立 balance snapshot，then payload amount_minor=`123456` 且畫面顯示 ¥123,456；輸入 `123.4` 時拒絕。
2. Given USD 帳戶輸入 `12.34`，then payload amount_minor=`1234` 且顯示 US$12.34。
3. Given 使用者建立 loan／payable／investment 帳戶，then UI 提供 canonical kind 與 currency，不需繞過 UI。
4. Given USD loan account，when 建立 liability，then label、payload 與格式化皆為 USD。
5. Given investment account、instrument 與人工持倉資料，when commit 成功，then source + holding 同時存在；任一 validation 失敗時兩者都不存在。
6. Given 使用者切到 Balance Sheet 或 Cash Flow，then UI 明示正式報表尚未實作並連到 `/data`，不呈現靜態 readiness rows。

## Test Mapping

```yaml
test_mapping:
  unit:
    - test/money-presentation.test.js
    - test/manual-investment-entry.test.js
  contract:
    - test/data-center-ui-contract.test.js
  browser:
    - e2e/data-center-and-reports.spec.js
```

## Evidence

- Canonical exponent：`lib/finance/money/decimal.js`、`test/money-decimal.test.js`。
- Canonical enums：`lib/finance/contracts/enums.js`。
- Typed investment owners：`lib/queries/finance/investments.js`、`lib/queries/finance/sources.js`。
- Existing static statement readiness：`components/reports/ReportsView.jsx`（本切片移除）。

## Intentional Changes

- Account create UI 從 4 種擴充為完整 canonical account kinds，並可選幣別。
- Existing account kind／currency 在 Data Center editor 改為唯讀。
- Investment UI 從 read-only inventory 擴充為 bounded manual valuation setup。
- Balance Sheet／Cash Flow 從靜態 readiness preview 改為 honest unavailable state。

## Open Questions

- 完整 investment trade／cash-leg UI 是否需要，留待 owner 以實際使用流程決定；不阻擋本切片。

## Update Trigger

Currency exponent／input semantics、account create options、manual investment authority／atomicity、report availability或external-AI boundary改變時更新。
