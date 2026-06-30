# AGENTS.md — 給 AI 編程助手（Codex / Claude Code）的操作指引

> Finance Viewer 是**使用者本機架設的財務資料伺服器**（SQLite + REST API + Web UI）。
> **這個工具本身不做 AI。** 你（AI agent）在外部，透過本檔與下列 API 操作資料、做分析。

## 你的角色

1. 使用者請你分析原始銀行帳單 → 你產出**含 AI 初分值**的 CSV ledger
2. 你（或使用者）打 `POST /api/import-ledger` 匯入 CSV
3. 使用者在 Web UI（http://localhost:3127）逐筆**人工終審**
4. 你可打 `/api/*` 做後續：查審查佇列、批次修正、讀 correction_log 產出分類規則分析、做月度報告

## server 在哪

使用者已架設：`http://localhost:3127`（同源 `/api/*`）。先 `GET /api/health` 確認連線。

## API（本機同源，JSON，統一錯誤 `{error}` envelope）

| Method | Route | 用途 |
|---|---|---|
| GET | `/api/health` | 確認 server + DB（回 `{ok, transactions, corrections}`） |
| GET | `/api/meta` | 月份 / 分類 / 歸屬 / 必要性 等篩選選項 |
| GET | `/api/summary?month=&scope=&view=` | 月度摘要（各類支出、淨現金流、儲蓄率） |
| GET | `/api/transactions?month=&scope=&category=&search=&sort=&limit=&offset=` | 交易列表（limit 上限 2000） |
| GET | `/api/transactions/:id` | 單筆明細 |
| PATCH | `/api/transactions/:id` | 單筆修正（body 見下方白名單） |
| POST | `/api/transactions/batch` | 批次修正（body `{corrections:[{id, ...fields}]}`，上限 500） |
| GET | `/api/review-queue?limit=` | 待確認 / 未審 計數 + 樣本 |
| GET | `/api/corrections?field=&limit=` | 修正歷史明細 + summary（你的「學習資產」原料） |
| GET | `/api/spending?month=&category=&scope=` | 消費統計 |
| GET | `/api/breakdown?dimension=&month=&scope=` | 分類 / 歸屬 / 必要性 維度分布 |
| GET | `/api/trend?scope=` | 月趨勢 |
| GET | `/api/balance-history` | 歷月帳戶餘額 |
| POST | `/api/import-ledger` | 匯入 CSV（body `{csvPath\|csvContent, sourcePath}`；csvPath 限 `uploads/`、`data/`、`outputs/` 子目錄） |
| GET | `/api/rules?enabled=&maxConfidence=&origin=&q=` | 列分類規則（給 UI / 你檢視） |
| POST | `/api/rules` | 新增規則（body 見「分類規則」段；匯入時自動套用） |
| GET | `/api/rules/:id` | 單筆規則 |
| PATCH | `/api/rules/:id` | 更新規則（body 僅 `{enabled}` → 快速啟停；否則部分更新） |
| DELETE | `/api/rules/:id` | 刪除規則（已套用的交易保留，僅斷連結） |
| GET | `/api/rules/normalize?text=` | 正規化預覽（產規則前驗證 match_key） |
| GET | `/api/rules/suggest` | 冷啟動建議（聚合已分類歷史 → 眾數規則建議） |

## 可編輯欄位白名單（PATCH / batch）

只有這四個欄位可改，**金額 / 日期 / 來源完全不可改**：

- `owner_primary`：個人 / 事業 / 事業候選 / 移轉不算 / 待確認
- `category_primary`：任意（從 `/api/meta` 取已用分類）
- `necessity`：必要 / 事業必要 / 可節省 / 可優化 / 需確認 / 不列入
- `memo`：任意文字

## 資料模型重點

- `transactions.amount / inflow / outflow / balance` 是 **cents（元 ×100）**。顯示時除 100。
- `correction_log` 是 **append-only**（trigger 阻擋 UPDATE/DELETE）—— 你只能讀，不能改歷史。
- `correction_log` **自帶規則脈絡**：每筆校正寫入時即帶 `match_key`（= `normalizeForRule(名稱)`）、`source_type`、`direction`、`rule_id`（若該筆原本是規則套用、被人類覆寫，則記該規則）。AI 第二環可直接 `GROUP BY match_key` 聚合 → 規則候選，**不必 join transactions**。`GET /api/corrections?matchKey=...` 可下鑽單一比對鍵的明細。
- `dedupe_key`：信用卡家族 = `hash(sourceType, date, name, amount)`；重匯不覆蓋人工已改的 owner/category/necessity。
- `transactions.classification_source`：該筆分類怎麼來的 — `rule`（規則套用）/ `ai`（你 CSV 初分）/ `human`（人工修正後）/ `pending`（待你分析）。`rule_id` 指向套用的規則。

## 不變量（務必遵守）

1. **金額欄位不可改**（API 無此路徑）
2. **只改白名單四欄**
3. **不雙向同步**：匯入不覆蓋人工修正
4. **correction_log 只讀**

## 典型任務食譜

### 1. 匯入新月分帳單
你分析原始 CSV → 產出含初分的 ledger CSV → `POST /api/import-ledger {csvPath: "uploads/..."}`

### 2. 批次改分類
```
GET /api/transactions?category=待確認&month=2026-06
→ 整理成 corrections: [{id:1, owner_primary:"事業"}, {id:2, owner_primary:"事業"}, ...]
POST /api/transactions/batch {corrections: [...]}
```

### 3. 分類規則（你最重要的學習資產 — 兩環進化）

規則存本工具，由**你（AI）產出與維護**；本工具在**匯入新交易時機械式套用**（覆蓋到的直接套、沒覆蓋的標 `pending` 等你分析）。目標：後續匯入 9 成靠「規則 + 你分析」正確分類。

**規則資料模型**（`classification_rules` 表）：
- 比對條件（皆可選、AND 組合，留空 = 不限）：`match_key` / `source_type` / `direction`(`in`=轉入 / `out`=轉出)
- 分類結果（皆可選，留空 = 不動該欄）：`owner_value` / `category_value` / `necessity_value`
- 元資料：`confidence`(0~1，你給) / `sample_count` / `origin`(`ai_analysis`|`human_correction`|`bootstrap`) / `enabled` / `note`
- 兩側各至少需一項（至少一個條件 + 一個結果），否則 POST 會 400。

**`match_key` 必須用 `normalizeForRule(名稱)` 算**（本工具匯入套用與你產規則用同一演算法，否則對不上）。**強烈建議直接呼叫 `GET /api/rules/normalize?text=...` 取 match_key，不要自己手算**（順序錯會對不上）。步驟（與 `lib/normalize.js` 完全一致）：
1. NFKC 全形→半形（台灣帳單的 `Ｃａｂ`→`Cab`、`＊`→`*`、`－`→`-`）
2. 去期數 `\b\d{1,2}/\d{1,2}\b`（`保險費分期 01/12`→`保險費分期`）
3. 移除識別碼 token（`isLikelyIdToken`）：含數字 ≥4 碼，或「**全大寫**純英字母 ≥5 碼且母音 ≤1」（高熵隨機後綴如 `WMZPFP`/`QCPZWS`/`Z9FJ2T`）。⚠ **此步驟在 lowercase 之前，必須用原始大小寫判斷**——若先 lowercase，`/^[A-Z]{5,}$/` 永遠不成立，後綴不會被移掉，match_key 會對不上。
4. lowercase + collapse whitespace（最後才統一轉小寫並壓空白）

範例：`GOOGLE*CLOUD WMZPFP` / `Z9FJ2T` / `QCPZWS` → 都是 `google*cloud`。產規則前用 `GET /api/rules/normalize?text=...` 驗證。

**兩環**：
- **第一環（即時）**：你分析新帳單時，用既有規則分類 → 產 CSV → 把新學的規則 `POST /api/rules`（帶 `confidence`）。
- **第二環（回饋）**：你讀 `GET /api/corrections`（回傳的 `summary` 已以 `match_key` 聚合 = 規則候選清單，**免 join**）→ 挑穩定候選 `POST /api/rules`。`correction_log.rule_id` 非 NULL =「人類覆寫了該規則的套用」→ 據此 `PATCH` 降該規則的 confidence 或拆規則。人類會在 UI 規則頁查看低信心（`confidence<0.5`）規則做調整。

**冷啟動**：`GET /api/rules/suggest` 給你「同 (match_key, source_type, direction) 眾數分類」建議（來自已分類歷史），你再 `POST` 成規則（`origin=bootstrap`）。

```
# 冷啟動：把歷史聚合成規則集
GET /api/rules/suggest
→ 挑樣本數高的建議，POST /api/rules（origin:"bootstrap"）

# 第二環：讀人工修正 → 整理規則
GET /api/corrections?limit=1000
→ 分析重複的 (field, old→new) 模式
→ PATCH/POST /api/rules 調整對應規則的值與信心度
```

規則套用發生在匯入當下（`POST /api/import-ledger` 的回應 `stats.rules_applied` 告訴你這次套了幾筆）。重匯不覆蓋人工已改的分類（`classification_source=human` 的不動）。

### 4. 月度分析報告
```
GET /api/summary?month=2026-06
GET /api/breakdown?dimension=category&month=2026-06
GET /api/trend
→ 整理成自然語言月報
```

## 重要：你看到的是真實財務資料

`data/finance.sqlite` 是使用者的真實帳單。**不要**把內容寫進任何會外送的檔案、commit、或公開 log。分析結果輸出給使用者本人即可。
