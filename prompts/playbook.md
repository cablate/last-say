# Finance Viewer 操作 Playbook（給 Claude / Codex）

> **何時用**：使用者請你處理一張帳單（分類／匯入），或說「我改了一些分類，幫我更新規則」「規則不準，幫我調」。
> **你的角色**：Finance Viewer（本機 `http://localhost:3127`）的外部 AI 操作員。**工具本身只做 CRUD + 機械式規則套用；所有「讀格式、理解、分類、判斷」由你做。**
> **系統契約**（完整 API 表、資料模型、不變量）見同專案 `AGENTS.md`。本檔是「怎麼做」的 SOP。

## 核心心智模型
- 帳單格式千百種 → **讀格式、轉 schema 全由你做**，不能寫程式解析。
- 你給的**信心度（0~1）**決定人類優先看哪些：低信心會排到審查佇列前面。沒把握就給低，別硬猜。
- **規則是你的學習資產**：當月把有把握的 distinct 商家建成規則，下個月自動套用 → 你越來越閒（複利）。
- 截斷／陌生的商家名 → **websearch 補全**，把發現寫進 `note`，別讓人類自己查。
- 真實財務資料：**不要**把內容寫進會外送的檔案、commit、公開 log。

---

## 流程 A：處理一張新帳單（月度匯入）

### A0. 前置確認
- `GET /api/health` — 確認 server + DB 連線。
- `GET /api/meta` — 看現有月份、已用分類選項。
- `GET /api/rules` — 拉既有規則（A2 要對照套用）。

### A1. 讀懂帳單格式（非固定 Excel／CSV）
- 掃前幾行找 header，辨識欄位：「消費日／交易日期」「交易說明／摘要」「金額／新臺幣金額」「卡號／來源」。
- **國泰信用卡帳單常見特性**（誤判地雷）：
  - 「交易說明」欄有長度限制 → 商家名會**截斷**（如 `漢堡大師(左營店` 括號沒閉合）。**這是原始資料，原樣保留**，不要自己補字。
  - `連加*` / `連支*` 開頭 = 國泰支付通路前綴（正常，保留，是穩定來源標記）。
  - 金額：**負數 = 繳款／退款**（inflow，歸「移轉不算 / 不列入」）；**正數 = 消費**（outflow）。
  - 一張卡可能多段（上期結轉、本期、分期），只取「本期消費明細」。
- 每筆交易對應到 A5 的 ledger CSV 欄位。

### A2. 逐筆算 match_key + 套用既有規則
- 對每筆「交易說明」算 match_key：**強烈建議 `GET /api/rules/normalize?text=<名稱>`**（別自己算，normalize 順序錯會對不上既有規則）。
- 用 `match_key + source_type + direction` 對照既有規則：
  - **命中啟用規則** → 標記「規則套用」。匯入時工具自動套、自動記 rule_id，**這筆你不用再分類**。
  - **沒命中** → 進 A3 自己分類。

### A3. 未覆蓋 → 分類 + 信心度 + websearch（核心）
對沒被規則覆蓋的每筆：

1. **分類**：
   - `category`：用標準 13 類（見下方，只能選這些）
2. **信心度** 0~1：沒把握就給低（0.3~0.5），低信心會排到人類審查前面讓人複核。
3. **websearch 補全**（下列情形才搜，省 token）：
   - 商家名**截斷**（括號沒閉合、句子斷掉）
   - 你**沒聽過**的商家
   - 分類**信心 < 0.6**
   - 搜什麼：`<商家名> 台灣 是什麼店` / `<商家名> 門市 分類` / `<截斷名> <你能辨識的部分>`
   - 搜到 → 補全全名、判斷是什麼店、**提升信心度**、把發現寫進 `note`。
4. **note 欄**：寫給人類看的備註（websearch 發現、不確定點），例：
   `websearch：原「漢堡大師(左營」疑為「漢堡大師 左營店」（漢堡連鎖），分類飲食，信心 0.5→0.8`

**標準 13 類**（`category` 主類別，只能選其一；無法對應 → 歸「其他收入與收益」並標低信心）：
> 飲食、居家、交通、購物、休閒娛樂、訂閱服務、醫療保健、保險、教育學習、金融手續與稅費、轉帳／內部移轉、薪資收入、其他收入與收益

### A4. 建規則（第一環）
- 把 A3 裡**有把握（信心 ≥ 0.6）**的每個 **distinct match_key**（distinct 商家），各建一條規則：
  `POST /api/rules`，body：
  ```json
  {
    "match_key": "<GET /api/rules/normalize 算出>",
    "source_type": "國泰信用卡 *XXXX",
    "direction": "out",
    "category_value": "飲食",
    "confidence": 0.8,
    "origin": "ai_analysis",
    "note": "<websearch 發現或分類理由>"
  }
  ```
- 這些規則給**未來月份**用。信心 < 0.6 的不建規則，留給人類審。
- 兩側各至少一項（至少一個條件 + 一個結果值），否則 POST 400。

### A5. 產 CSV 匯入
產 ledger CSV，欄位順序（每筆一行）：
```
來源類型,來源說明,日期,月份,名稱,金額,流入,流出,帳戶餘額,帳戶原始排序,原始交易資訊,這筆是什麼,分類,子類別,信心度,判斷理由,備註
```
- `日期` = `YYYY-MM-DD`、`月份` = `YYYY-MM`
- `金額`：消費寫 `-金額`、流入=`金額`、流出=`0`；繳款反過來（流入=正、流出=0）
- `分類` = category 主類別、`子類別` = 自由文字（如「便利商店」「餐飲」）、`信心度` = 你的信心
- 含逗號的欄位用雙引號包。

匯入：`POST /api/import-ledger { "csvPath": "uploads/<檔>" }`（檔須在 `uploads/` `data/` `outputs/` 下）或 `{ "csvContent": "..." }`。
看回應 `stats.rules_applied` 確認規則套用了幾筆。

### A6. 回報給使用者
- 匯入 N 筆、規則套用 M 筆、新建規則 K 條。
- **低信心待審**：列出信心 < 0.5 的，說「這幾筆我沒把握，先幫我看」。可在 UI `/transactions?view=needs-review` 看（低信心排最前）。
- websearch 補全的：提一下「我搜過的，已寫在 note」。

---

## 流程 B：從人工修正進化規則（第二環）

> **觸發**：使用者說「我改了一些分類」「有修正紀錄了」「規則不準，幫我調」。

### B1. 讀 correction_log
`GET /api/corrections?limit=1000`。回傳：
- `summary`：已以 `match_key × 欄位 × 新值` 聚合 = 你的**規則候選**（哪個比對鍵被一致校正成什麼）。
- `rows`：逐筆明細（含 `rule_id`、`old_value`、`new_value`、交易名）。

### B2. 分析模式
從 summary + rows 找：
- **重複校正**：某 match_key 被一致改成同個值 → 該建／修規則。
- **`rule_id` 非 NULL**：該筆是「規則套用被人類覆寫」= **規則不準** → 降該規則信心、或改值、或拆規則。
- **`rule_id` NULL**：該商家沒規則（被改的是 AI 初分）→ 建新規則。

### B3. 修訂規則
- 既有規則不準：`PATCH /api/rules/<id>` 改 `category_value` 或降 `confidence`。
- 缺規則：`POST /api/rules` 新增，`origin=human_correction`，帶從 correction 學到的值。
- 修完，**下個月匯入**就會套用新規則。

### B4. 回報
改了幾條規則、降了幾條信心、新建幾條，依據是哪些校正模式。

---

## 不變量（務必遵守）
1. **金額不可改**（API 無此路徑）。只能改 `category / memo` 兩欄（owner 事業/個人、necessity 該不該花 是下階段）。
2. **correction_log 只讀**（append-only，trigger 擋改）。
3. **匯入不覆蓋人工已改**（`classification_source=human` 的不動）。
4. `match_key` 永遠用 `GET /api/rules/normalize` 算，別手算。

## 關鍵 API 速查
| 動作 | API |
|---|---|
| 算比對鍵 | `GET /api/rules/normalize?text=` |
| 列規則 | `GET /api/rules` |
| 建／改規則 | `POST /api/rules`、`PATCH /api/rules/:id` |
| 匯入 | `POST /api/import-ledger` |
| 讀修正 | `GET /api/corrections` |
| 待審清單 | UI `/transactions?view=needs-review` |

其餘（summary / breakdown / trend / balance 等）見 `AGENTS.md`。
