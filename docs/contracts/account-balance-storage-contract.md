---
schema_version: behavior-contract/v1
id: finance.account-balance.storage
title: 帳戶與餘額事實
status: active
owner_surface: api
change_context:
  type: feature
  reason: 分離帳戶身分、現金活動與時點餘額，讓現金部位與資產負債分析可驗證。
  non_goals:
    - 不從流水推測官方餘額。
    - 不在此契約計算完整資產負債表。
---

# 帳戶與餘額儲存契約

## Behavior Boundary

擁有 account metadata/aliases 與 `account_balance_snapshots`。交易流水屬 Cash Activity；資產負債表屬 downstream read model。

## Consumers And Entrypoints

- `/api/finance/accounts`、`/api/finance/accounts/:id/aliases`、`/balance-snapshots`。
- `GET /api/finance/inventory`、cash-position/net-worth readiness、balance-sheet read model。
- 既有 `accounts` additive columns、`account_aliases`、`account_balance_snapshots`。

## Inputs And State

- Snapshot：account、as-of date、observed-at、balance kind、minor-unit amount、currency、source、authority、review、note、optional supersedes link。
- Balance kinds：ledger、available、statement、unbilled、principal、cash、market_value、other。
- 同 account/kind/as-of/source 具 deterministic duplicate key；不同來源同 semantic key 可並存。

## Outputs And Side Effects

- Latest/effective view 必須回 selected candidate、selection reason、所有 conflicts、source、actual as-of 與 freshness。
- Transaction running balance 只能產生 `ai_inferred` candidate，不能成為 official 或單獨完成 coverage。
- 人工修正以新 snapshot/supersession 或 reviewed selection 保存，不改 source fact。

## UI States

Data Center 後續顯示 no-account、missing-balance、current、stale、conflicted、needs-review、version-conflict 與 error；金額旁必須顯示實際日期、kind 與來源。

## Invariants

- Account identity 不以 display name 單獨決定。
- Snapshot 是時點事實，不因較新的不同 kind/source 自動被覆寫。
- `complete` 需要目標 scope 的有效 attestation、required accounts 與符合 policy 的 snapshots。
- Snapshot 不改 imported transaction amount/date/source。

## Acceptance Examples

1. Given checking 有流水推算 NT$90,000 與官方 statement NT$100,000，when 查現金部位，then 官方 snapshot 可被選為 effective，推算值仍可見且不覆寫。
2. Given 同日兩份官方來源餘額不同，when 查 readiness，then 回 `conflicted` 與兩個 candidates。
3. Given 所有帳戶有最新 snapshot 但 scope attestation 缺少，then 全域 cash position 仍為 `partial`。

## Test Mapping

```yaml
test_mapping:
  integration:
    - test/account-balances.test.js
    - test/financial-scope.test.js
  downstream:
    - test/balance-sheet.test.js
```

## Evidence

- `test/account-balances.test.js`、`test/financial-scope.test.js`。
- `test/fixtures/financial-data/manifest.json`與其synthetic source mappings提供compound rehearsal範圍；repository沒有獨立按account-balance命名的canonical fixture。

## Intentional Changes

- 新增 snapshot owner；不再允許報表以交易列存在取代餘額證據。
