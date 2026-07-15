---
schema_version: behavior-contract/v1
id: finance.foundation.core
title: 財務資料核心語意與身分
status: active
owner_surface: shared
change_context:
  type: feature
  reason: 為帳戶、來源、金額、權威、範圍與稽核建立跨 bounded context 的最小共用語意。
  non_goals:
    - 不建立 universal financial record、EAV 或任意 JSON canonical storage。
    - 不把所有財務活動強迫轉為複式分錄。
    - 不改既有交易正規化、去重或人工分類語意。
---

# 財務資料核心契約

## Behavior Boundary

本契約擁有 reporting entity、institution、account、source、money、currency、authority、review、scope、source expectation、version 與 append-only operational audit 的共用語意。各 typed bounded context 擁有自己的 canonical facts；無法安全套用共用語意的資料必須回 `unsupported` 或另立 context。

## Consumers And Entrypoints

- `lib/finance/contracts/*`、`lib/queries/finance/entities.js`、`institutions.js`、`accounts.js`、`sources.js`。
- `GET /api/finance/capabilities`、typed entity/account/source APIs。
- `reporting_entities`、`institutions`、`institution_aliases`、既有 `accounts` 的 additive columns、`account_aliases`、既有 `sources` 的 additive columns。
- `scope_attestations`、`source_expectations`、`source_expectation_goals`、`data_change_log`。
- Balance、card、liability、commitment、investment、valued-item、reconciliation 與 readiness contexts。

## Inputs And State

- Money 以帶 ISO 4217 currency 的 integer minor units 表示；API 超過 JavaScript safe integer 時使用 canonical decimal integer string。
- Quantity、price、rate、FX 使用經 validator 正規化的 decimal string，禁止 canonical float／SQLite `REAL`。
- Identity 對外使用 immutable random stable key；顯示名稱、來源 alias、masked hint 不可單獨當 canonical identity。
- Authority enum：`official`、`institution_export`、`user_confirmed`、`ai_researched`、`ai_inferred`、`estimated`。
- Record status：`provisional`、`posted`、`confirmed`、`superseded`、`reversed`、`archived`；review state 與 version 必須明列。

## Outputs And Side Effects

- Capability registry 回傳同一份 runtime enum/schema source，不由 UI 或 Skill 複製猜測。
- Metadata update 使用 optimistic version；stale version 回 stable `VERSION_CONFLICT`。
- 重要 mutation 同 transaction 更新 typed state、source link、review task（需要時）與 append-only `data_change_log`。
- Duplicate identity 先阻擋並列入 review；有 downstream facts 的 merge 只能走 typed impact preview、有效 human confirmation 與 atomic commit。
- 新 resource、到期 attestation 或 source conflict 使相關 readiness 失效。

## UI States

Phase 0 不新增 UI。後續 Data Center 必須呈現 empty、partial、stale、conflicted、ready、error 與 version-conflict；不得用資料列存在暗示「全部資料已齊」。

## Invariants

- 既有 `transactions` 的 amount/date/source、人工欄位、`correction_log` 與 `rule_change_log` 語意不變。
- 擴充既有 `accounts`，不建立平行 `financial_accounts`。
- `accounts.name` 暫作 legacy internal label；`display_name` 才是使用者名稱，alias 才是來源身分。
- JSON 可用於 audit/staging，不得成為 canonical domain fact。
- AI 不可任意 SQL、generic table/field patch、hard delete source facts或自稱 human 取得權限。
- `declared_complete` 只可由 user-confirmed 或核准的 authoritative inventory source 建立。

## Acceptance Examples

1. Given 兩個同名帳戶屬於同一機構，when 來源 aliases 不同，then 它們維持不同 `account_key` 且可被正確辨識。
2. Given DB 有銀行帳戶與最新餘額但沒有 cash scope attestation，when 查全域 cash readiness，then 結果不得為 `complete`。
3. Given lower-authority AI candidate 與 human-confirmed fact 衝突，when 建立 candidate，then 兩者並存、回 conflict，且人工值不被覆寫。
4. Given option trade payload，when context registry 不支援 options，then 回 `UNSUPPORTED_CONTEXT`，不得塞入 `other` 或 generic JSON。

## Test Mapping

```yaml
test_mapping:
  unit:
    - test/money-decimal.test.js
    - test/financial-scope.test.js
  integration:
    - test/financial-identity.test.js
    - test/database-foundation.test.js
  manual:
    - Compare capabilities enums with runtime validators and the operator Skill.
```

## Evidence

- Phase 0：`docs/adr/0001-shared-kernel-typed-contexts.md`、`0002-money-decimal-representation.md`、`0003-additive-accounts-migration.md`。
- Fixtures：`test/fixtures/financial-data/manifest.json`。

## Intentional Changes

- Foundation schema/API 尚未存在；Phase 1 將以 additive migration 新增以上語意，不替換 legacy transaction workflow。
