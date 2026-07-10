---
schema_version: behavior-contract/v1
id: runtime.next-build-isolation
title: Next.js 開發與正式建置隔離
status: active
owner_surface: infrastructure
change_context:
  type: bugfix
  reason: 同一專案的 dev 與 production 程序共用 `.next` 時，dev 會改寫正式 chunks，造成執行期 MODULE_NOT_FOUND。
  non_goals:
    - 不改變對外 port 或啟動指令。
    - 不改變資料庫路徑或內容。
---

# Next.js 開發與正式建置隔離

## Behavior Boundary

Development 使用 `.next-dev`；production build 與 start 使用 `.next`。兩種程序並存時不得互相刪除或改寫 chunks。

## Consumers And Entrypoints

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run verify:release`
- `next.config.mjs`
- `.gitignore`

## Inputs And State

- Next.js 以 `NODE_ENV=development` 啟動 dev server。
- Next.js build/start 使用 production mode。
- 兩個輸出目錄皆為可刪除的 generated artifacts，不含財務資料。

## Outputs And Side Effects

- Dev chunks 寫入 `.next-dev/`。
- Production chunks 寫入 `.next/`。
- 兩個目錄都不進 git。

## UI States

- 正式頁面載入不得出現缺少 `331.js`、`vendor-chunks/@radix-ui.js` 或其他跨模式 chunk 的 500。
- API health 成功不代表頁面成功；驗收必須實際載入 `/transactions`。

## Invariants

- Dev 與 production 不共用輸出目錄。
- Build/test 仍使用隔離 `FINANCE_DB_PATH`。
- `data/finance.sqlite` 不因 build isolation 被刪除、重建或移動。

## Acceptance Examples

1. Given a dev server is running, when production build completes and production starts, then `/transactions` loads without MODULE_NOT_FOUND.
2. Given production is running, when dev recompiles, then production `.next/server/chunks` remains usable.

## Test Mapping

- Build: `FINANCE_DB_PATH=data/dev-verify-build.sqlite npm run build`
- Runtime: start production on 3127 and load `/transactions?month=2026-06&view=needs-review`
- Filesystem: verify `.next/BUILD_ID` and `.next-dev/` are separate and ignored

## Evidence

- Baseline: an elevated dev process on 3131 rewrote shared `.next`; production-like pages failed with missing `331.js` and `vendor-chunks/@radix-ui.js`.

## Intentional Changes

- Development output moves from `.next` to `.next-dev`.

## Open Questions

- None.
