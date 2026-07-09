# Finance Viewer 操作 Playbook（給 Claude / Codex）

> **何時用**：使用者請你處理一張帳單（分類／匯入），或說「我改了一些分類，幫我更新規則」「規則不準，幫我調」。
> **你的角色**：Finance Viewer（本機伺服器）的外部 AI 操作員。**工具本身只做 CRUD + 機械式規則套用；所有「讀格式、理解、分類、判斷」由你做。**
> **port**：以實際 dev 啟動訊息印出的 port 為準（非寫死 3127——port 可能被佔而換到別的）。所有文件中 `http://localhost:3127` 僅為示意，實作時替換成當前實際 port。
> 本檔自含**完整系統契約**（附錄一～三：API 表、資料模型、規則契約）＋ 操作 SOP。若你的任務是**修改這包程式碼**（開發／審查／規劃功能），改讀 `AGENTS.md`。

## 核心心智模型
- 帳單格式千百種 → **讀格式、轉 schema 全由你做**，不能寫程式解析。
- 你給的**信心度（0~1）**決定人類優先看哪些：低信心會排到審查佇列前面。沒把握就給低，別硬猜。
- **規則是你的學習資產**：當月把有把握的 distinct 商家建成規則，下個月自動套用 → 你越來越閒（複利）。
- 截斷／陌生的商家名 → **websearch 補全**，把發現寫進 `note`，別讓人類自己查。
- 真實財務資料：**不要**把內容寫進會外送的檔案、commit、公開 log。

## 每月流程總覽（細節見流程 A）

1. 使用者給你原始帳單（任意格式）→ 你**讀懂格式、逐筆理解**，轉成本工具的 ledger schema（欄位見 A5）。
2. 你對每筆算 `match_key`（用 `GET /api/rules/normalize`），對照**既有規則**：被覆蓋的，工具匯入時自動套用建檔。
3. **未覆蓋的明細** → 你分析分類（category）並給**信心度 0~1**。每筆必附一句人話判斷理由（寫進 ledger CSV「判斷理由」欄）；每條規則必帶 note。**即使沒把握也要給最佳猜測 + 低信心（0.2~0.4），不要留空標「待確認」**——低信心會排到 UI 審查最前面讓人複核，且 correction_log 才能記「猜測→正確」供你第二環進化規則。
4. 把第 3 步**有把握的每個 distinct 商家**各建一條規則 `POST /api/rules`（帶 `confidence`、`origin=ai_analysis`）——這些規則給**未來月份**用。
5. 產出 ledger CSV → `POST /api/import-ledger` 匯入。理論上這個月帳單到此處理完畢。
6. 下個月 → 開銷結構類似 → 更多筆被既有規則套用 → 你越來越閒（複利）。

人工修正回饋（第二環）：使用者在 UI 改錯 → 寫進 `correction_log`（自帶規則脈絡）→ 你讀 `GET /api/corrections` 據以修訂/新增規則（見流程 B）。

---

## 流程 A：處理一張新帳單（月度匯入）

### A0. 前置確認
- `GET /api/health` — 確認 server + DB 連線。
- `GET /api/meta` — 看現有月份、已用分類選項。回應結構：
  - `standardCategories`：**標準 14 類白名單**（AI 分類須對齊此清單，只能選、不能造；與 A3 表格一致）。
  - `filters.categories`：DB 實際出現過的 distinct category（現況，可能含偏離 14 類的舊值）。
  - `filters.sources` / `filters.flows`：來源 / flow_type 的 distinct 值。
  - `counts.needsReview`：待人類處理的筆數（**數字**，未審 + AI 沒把握：`reviewed=0 AND (ai_confidence<0.5 OR ai_confidence IS NULL OR classification_source='pending')`）。
  - `months.transaction`：已有資料的月份清單。
- `GET /api/rules` — 拉既有規則（A2 要對照套用）。

### A1. 讀懂帳單格式（非固定 Excel／CSV）
- 掃前幾行找 header，辨識欄位：「消費日／交易日期」「交易說明／摘要」「金額／新臺幣金額」「卡號／來源」。
- **國泰信用卡帳單常見特性**（誤判地雷）。
  > 以下為國泰信用卡範例，僅示範帳單特性判讀；其他銀行依實際欄位調整，歡迎貢獻 `prompts/banks/<你的銀行>.md`。
  - 「交易說明」欄有長度限制 → 商家名會**截斷**（如 `漢堡大師(左營店` 括號沒閉合）。**這是原始資料，原樣保留**，不要自己補字。
  - `連加*` / `連支*` 開頭 = 國泰支付通路前綴（正常，保留，是穩定來源標記）。
  - 金額：**負數 = 繳款／退款**（inflow，歸「移轉不算 / 不列入」）；**正數 = 消費**（outflow）。
  - 一張卡可能多段（上期結轉、本期、分期），只取「本期消費明細」。
- 每筆交易對應到 A5 的 ledger CSV 欄位。

### A2. 逐筆算 match_key + 套用既有規則
- 對每筆「交易說明」算 match_key：**強烈建議 `GET /api/rules/normalize?text=<名稱>`**（別自己算，normalize 順序錯會對不上既有規則，演算法見附錄三）。
- 用 `match_key + source_type + direction` 對照既有規則：
  - **命中啟用規則** → 標記「規則套用」。匯入時工具自動套、自動記 rule_id，**這筆你不用再分類**。
  - **沒命中** → 進 A3 自己分類。

### A3. 未覆蓋 → 分類 + 信心度 + websearch（核心）
對沒被規則覆蓋的每筆：

1. **分類**：
   - `category`：用標準 14 類（見下方，只能選這些）。⚠ **工具不做 category 白名單硬校驗**——你傳任何字串都會被接受（建規則時非標準值會附 `warning` 但仍成功建立），但偏離 14 類會讓後續報表映射、統計彙總失效。**AI 須自行對齊 14 類**；14 類清單以 `GET /api/meta` 回應的 `standardCategories` 為準（與下方表格一致）。
   - `category_sub`：自由文字子類別，但先 `GET /api/meta` 看既有子類別，能複用就複用（「咖啡」不要又造「咖啡廳」「咖啡店」）。新商家型態才造新詞，2-4 字名詞。
2. **信心度** 0~1：沒把握就給低（0.3~0.5），低信心會排到人類審查前面讓人複核。

| 信心 | 情境 |
|---|---|
| 0.9–1.0 | 知名品牌/連鎖，名稱完整無歧義（全聯、Netflix、台灣大車隊） |
| 0.7–0.85 | websearch 確認過的在地店家；或截斷名補全高度可信 |
| 0.5–0.65 | 有合理推測依據但未證實（名稱含「藥局」但查不到這間店） |
| 0.2–0.45 | 幾乎瞎猜（無法辨識的縮寫、搜尋無結果） |

建規則門檻維持 ≥ 0.6。禁止全部給 0.7 之類的「安全值」——校準錯誤會讓待審佇列失去意義。
3. **websearch 補全**（下列情形才搜，省 token）：
   - 商家名**截斷**（括號沒閉合、句子斷掉）
   - 你**沒聽過**的商家
   - 分類**信心 < 0.6**
   - 搜什麼：`<商家名> 台灣 是什麼店` / `<商家名> 門市 分類` / `<截斷名> <你能辨識的部分>`
   - 搜到 → 補全全名、判斷是什麼店、**提升信心度**、把發現寫進 `note`。
4. **判斷理由（必填，每一筆你分類的交易）**：ledger CSV 的「判斷理由」欄不可留空。
   一句人話：「這是什麼店/服務 + 為什麼是這類」。websearch 查過的，把發現寫進來。
   例：`連鎖手搖飲（websearch 確認「五十嵐 左營店」），飲食`
   例：`無法辨識的縮寫，搜尋無結果，暫歸日常開銷（金額小），信心 0.3`
   這是給人類審查看的第一手輔助資訊——你不寫，人類就要自己重查一次，工具的價值就歸零。

**標準 14 類**（`category` 主類別，只能選其一）：

| 主類 | 定義 | 典型 | 邊界裁決 |
|---|---|---|---|
| 飲食 | 吃進肚子的 | 外食、飲料、食材、超商買吃的 | 超商/超市整單以食物為主→飲食；和朋友聚餐吃飯→飲食（不是休閒娛樂） |
| 日常開銷 | 生活維持型小額消費：每月都會發生、單筆小、不需要記細節 | 超市量販日用品、藥妝（非藥品）、理髮、洗衣、寵物日常、雜貨 | 混合購物（超商/電商）無法判斷主要用途且金額小→歸這裡並降信心 |
| 居住 | 住的固定成本與家的硬體 | 房租房貸、水電瓦斯、電信網路、管理費、家具家電、修繕 | 電信網路雖是週期扣款但歸居住，不歸訂閱服務 |
| 交通 | 移動 | 大眾運輸、計程車、油資停車、車輛保養 | — |
| 購物 | 慾望型/耐久財：不買也能過日子的取得型消費 | 3C、服飾、精品、遊戲設備 | 混合購物金額大→購物；日用補貨→日常開銷 |
| 休閒娛樂 | 體驗型消費 | 電影、旅遊住宿、KTV、遊戲點數 | 體驗歸這裡、吃飯歸飲食 |
| 訂閱服務 | 週期扣款的數位/會員服務 | Netflix、Spotify、iCloud、健身房月費、SaaS | 電信網路→居住；保費→保險 |
| 醫療保健 | 醫療與健康照護 | 診所、藥品、牙醫、健檢、保健食品 | 藥妝店買日用品→日常開銷；買藥→醫療保健 |
| 保險 | 保費 | 壽險、醫療險、車險 | — |
| 教育學習 | 學習型支出 | 課程、書籍、講座 | — |
| 金融手續與稅費 | 金融成本與稅費 | 手續費、稅、利息支出、外幣手續費 | 泛名（手續費/利息）不建規則，靠 flow_type |
| 轉帳/內部移轉 | 非消費：自己帳戶間移動 | 信用卡繳款、儲值、互轉 | flow_type 同步標，排除出消費統計 |
| 薪資收入 | 薪資入帳 | 月薪、薪轉 | 只有錢進來才用 |
| 其他收入與收益 | 非薪資收入 | 利息收入、退款、獎金、投資收益 | 支出永遠不歸這類 |

每筆交易依序問：
1. 是繳款/儲值/帳戶互轉？ → 轉帳/內部移轉（flow_type 同步標，不進消費統計）
2. 是錢進來？ → 薪資收入 / 其他收入與收益
3. 是週期扣款的數位/會員服務？ → 訂閱服務（電信網路除外→居住）
4. 商家主業是什麼？（不確定 → websearch）→ 按主業對應主類，細節寫進子類別
5. 混合型商家（超商/超市/電商平台）看這一單：
   食物為主 → 飲食；日用補貨 → 日常開銷；大額耐久財 → 購物；
   無法判斷 → 金額小歸日常開銷、金額大歸購物，信心 ≤ 0.5

※ 支出永遠不歸「其他收入與收益」。對不上就走第 5 步 + 低信心，讓人類審。

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
    "note": "<必填：商家全名 + 是什麼 + 資訊來源>"
  }
  ```
- 這些規則給**未來月份**用。信心 < 0.6 的不建規則，留給人類審。
- ⚠ **泛名／銀行操作不建規則**：「電子轉出」「轉帳」「繳費」「利息」「手續費」等**非商家描述**（match_key 無區別力，建規則會誤套到所有同名交易）。這類用 `flow_type`（移轉／繳款／非消費）區分，不靠商家規則；匯入時就標對 flow_type 排除出消費統計。
- ⚠ **空 match_key 不可建規則**：normalize 結果若為**空字串**（如 `7-11`→`711` 再去數字後變空、純數字、純符號名稱），建規則會被系統 **400 拒絕**（空比對鍵無區別力）。這類商家改在 **CSV 匯入時直接分類**（ledger CSV 填好 category/信心度），不靠規則。產規則前用 `GET /api/rules/normalize?text=...` 先確認 match_key 非空。
- 兩側各至少一項（至少一個條件 + 一個結果值），否則 POST 400。

### A5. 產 CSV 匯入
產 ledger CSV，欄位順序（每筆一行，共 17 欄）：
```
來源類型,來源說明,日期,月份,名稱,金額,流入,流出,帳戶餘額,帳戶原始排序,原始交易資訊,這筆是什麼,分類,子類別,信心度,判斷理由,備註
```
**必填欄位（值不可為空 / undefined）**：`日期`、`月份`、`名稱`、`金額`。空字串可、`undefined`/缺欄不行。`來源類型`強烈建議填（規則比對與來源追溯都靠它）。
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
- 回報前自查：
  - [ ] 我分類的每一筆都有判斷理由（覆蓋率 100%，缺 = 回去補）
  - [ ] 我建的每條規則都有 note（覆蓋率 100%）
  - [ ] 低信心（<0.5）筆數與清單已列給使用者
  - [ ] 匯入回應的 stats.rules_applied 已回報

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

## 流程 C：報表映射（管理用損益表）

> **觸發**：使用者要「出月報／P&L／損益表」「看本月淨利」「這個月哪些沒對到報表列」。
> 報表（`GET /api/reports/income-statement`）把每筆交易映射到一條 **report_line**（如 `expense:food`、`income:salary`），再依 `revenue / expense / excluded` 三群加總。映射來源優先序：逐筆 mapping > 規則 > built-in（category / 關鍵字）。沒對到的進 `review_items`。

### C0. 先查現況
`GET /api/reports/income-statement?month=2026-06` —— 看：
- `total_revenue_cents / total_expense_cents / net_income_cents`：損益數字（cents，除 100 顯示）。
- `review_items`：**沒對到 report_line 的交易**（前 25 筆）——這些是你的工作區。⚠ `review_items[].id` **即為 `POST /api/reports/mappings` 的 `transaction_id`**（同一個值，直接帶入，不必另查）。
- `coverage`：覆蓋率、已審比例、basis / 期間等詮釋資料。

### C1. 處理未映射交易（逐筆 mapping）
`review_items` 裡每筆未映射的，判斷它該歸哪條 report_line（白名單見下表），打 `POST /api/reports/mappings`，body：
```json
{
  "transaction_id": 123,
  "report_line": "expense:food",
  "confidence": 0.8,
  "reason": "連鎖手搖飲，飲食（category 餐飲對不上 built-in 對照表，補 mapping）",
  "note": "websearch 確認「五十嵐 左營店」"
}
```
- `transaction_id`（必填，正整數；即 `review_items[].id`）、`report_line`（必填，須在白名單）。
- `mapping_source` 選填，預設 `ai`。
- `confidence` 選填 0~1；`reason` / `note` 選填（note 會附加到 reason）。
- 寫入為 **INSERT OR REPLACE**（同一 transaction_id 重寫即覆蓋）。⚠ **重寫時欄位為合併語意**：未重新帶入的 `confidence` / `reason` / `note` 會**保留原值**（部分更新，非整筆替換）。若要清空某欄，需顯式帶空值。回 `{ok, transaction_id, report_line}`。

**report_line 白名單**（只能用這些，完整清單以 `lib/reporting/report-lines.js` 為準；改清單 = 多點同步，見 AGENTS.md）：

| group | report_line | label |
|---|---|---|
| revenue | `income:salary` `income:business_revenue` `income:interest_income` `income:refunds_gains` `income:other_income` | 薪資 / 業務收入 / 利息 / 退款收益 / 其他 |
| expense | `expense:food` `expense:daily_living` `expense:housing` `expense:transportation` `expense:shopping` `expense:leisure_entertainment` `expense:subscription_software` `expense:insurance` `expense:medical` `expense:education` `expense:fees_taxes` `expense:interest` `expense:business_operating` `expense:other_expense` | 飲食 / 日常 / 居住 / 交通 / 購物 / 休閒 / 訂閱軟體 / 保險 / 醫療 / 教育 / 手續稅費 / 利息支出 / 業務營運 / 其他 |
| excluded | `excluded:internal_transfer` `excluded:credit_card_payment` `excluded:loan_principal` `excluded:investment_purchase` `excluded:owner_equity` | 內部轉帳 / 卡款 / 貸款本金 / 投資買入 / 業主提領 |

> 不在表上的 report_line 會被 400 擋下（白名單校驗）。

### C2. 建報表映射規則（給未來月份用）
判斷後若某商家/來源會重複出現，建規則讓以後自動映射，打 `POST /api/reports/mapping-rules`，body：
```json
{
  "match_key": "<GET /api/rules/normalize 算出>",
  "source_type": "國泰信用卡 *XXXX",
  "direction": "out",
  "report_line": "expense:subscription_software",
  "confidence": 0.85,
  "reason": "Netflix 月費",
  "note": "訂閱服務，歸訂閱與軟體"
}
```
- `report_line`（必填，白名單）；比對條件 `match_key` / `source_type` / `direction` 至少填一個（`direction` 只允許 `in`/`out`）。
- `confidence` 選填（預設 0）；`enabled` 選填（預設 true）；`reason` / `note` 選填（合併進 note 欄）。
- 回 `{ok, id}`。規則套用發生在 `GET /api/reports/income-statement` 查詢當下（優先序低於逐筆 mapping，高於 built-in）。

### C3. 標記已審（批次認可）
人類認可規則自動套用的交易後，批次標 reviewed 區分「看過／沒看過」：
`POST /api/transactions/review`，body `{ "ids": [1,2,3] }`（上限 500）。回 `{ok, updated}`。
這是隱性正向信號，不影響分類，只降 `unreviewed_transaction_count`。

### C4. 回報
- 損益三數（淨利、總收入、總支出）。
- 處理了幾筆未映射（建了幾條 mapping、幾條規則）、覆蓋率從 X→Y。
- 回報前自查：每條 mapping / 規則都有 reason（覆蓋率 100%）。

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

完整 API 表見附錄一。

---

## 附錄一：API 契約

server：使用者已架設本機伺服器（port 以 dev 啟動訊息為準，非寫死 3127；同源 `/api/*`）。先 `GET /api/health` 確認連線。所有 API 回 JSON，統一錯誤 `{error}` envelope。

| Method | Route | Status | 用途 |
|---|---|---|---|
| GET | `/api/health` | 200 | 確認 server + DB（回 `{ok, transactions, corrections}`） |
| GET | `/api/meta` | 200 | 篩選選項與詮釋資料：`standardCategories`（標準 14 類）、`filters`（sources/categories/flows 的 distinct 值）、`counts.needsReview`（待人類審核筆數，數字）、`months.transaction`（已有月份）。詳見 A0 |
| GET | `/api/summary?month=&scope=&view=` | 200 | 月度摘要（各類支出、淨現金流、儲蓄率） |
| GET | `/api/transactions?month=&scope=&category=&search=&sort=&limit=&offset=` | 200 | 交易列表（limit 上限 2000） |
| GET | `/api/transactions/:id` | 200 | 單筆明細 |
| PATCH | `/api/transactions/:id` | 200 | 單筆修正（body 見白名單） |
| POST | `/api/transactions/batch` | 200 | 批次修正（body `{corrections:[{id, ...fields}]}`，上限 500） |
| GET | `/api/corrections?field=&matchKey=&limit=` | 200 | 修正歷史明細 + summary（你的「學習資產」原料） |
| GET | `/api/transactions?view=needs-review&sort=confidence&direction=asc` | 200 | 低信心／未審交易（你沒把握的，依信心升序） |
| GET | `/api/spending?month=&category=&scope=` | 200 | 消費統計 |
| GET | `/api/breakdown?dimension=&month=` | 200 | 分類 維度分布 |
| GET | `/api/trend?scope=` | 200 | 月趨勢 |
| GET | `/api/balance-history` | 200 | 歷月帳戶餘額 |
| POST | `/api/import-ledger` | 200 | 匯入 CSV（body `{csvPath\|csvContent, sourcePath}`；csvPath 限 `uploads/`、`data/`、`outputs/` 子目錄） |
| GET | `/api/rules?enabled=&maxConfidence=&origin=&q=` | 200 | 列分類規則（給 UI / 你檢視） |
| POST | `/api/rules` | **201** | 新增規則（body 見 A4；匯入時自動套用）。回 `{ok, rule}`；若 `category_value` 非標準 14 類另附頂層 `warning`（仍成功建立，軟校驗不硬擋） |
| GET | `/api/rules/:id` | 200 | 單筆規則 |
| PATCH | `/api/rules/:id` | 200 | 更新規則（body 僅 `{enabled}` → 快速啟停；否則部分更新） |
| DELETE | `/api/rules/:id` | 200 | 刪除規則（已套用的交易保留，僅斷連結） |
| GET | `/api/rules/normalize?text=` | 200 | 正規化預覽（產規則前驗證 match_key） |
| GET | `/api/reports/income-statement?month=&entity_id=&basis=&currency=` | 200 | 管理用損益表（回 `revenue`/`expenses`/`excluded` 各列、`total_revenue_cents`/`total_expense_cents`/`net_income_cents`、`coverage`、未映射的 `review_items`；basis=`card_accrual_management`\|`cash`，見流程 C） |
| POST | `/api/reports/mappings` | **201** | 寫逐筆報表映射（body `{transaction_id, report_line, mapping_source?, confidence?, reason?, note?}`；report_line 白名單見流程 C） |
| POST | `/api/reports/mapping-rules` | **201** | 建報表映射規則（body `{match_key?, source_type?, direction?, report_line, confidence?, reason?, note?, enabled?}`） |
| POST | `/api/transactions/review` | 200 | 批次標 reviewed（body `{ids:[...]}`，上限 500；隱性正向信號，不影響分類） |

> **成功判斷**：用 `resp.ok`（2xx 即成功），**勿 hardcode `=== 200`**——`POST /api/rules`、`/api/reports/mappings`、`/api/reports/mapping-rules` 成功回 **201**，hardcode 200 會把這些新增誤判為失敗。錯誤回 4xx/5xx + `{error}`。

### 可編輯欄位白名單（PATCH / batch）

只有這兩個欄位可改，**金額 / 日期 / 來源完全不可改**：

- `category_primary`：任意（建議用標準 14 類，見 A3）
- `memo`：任意文字

> 沒把握時**不要**把欄位填「待確認／需確認」——改給最佳猜測 + 低信心度（見 A3）。

## 附錄二：資料模型重點

- `transactions.amount / inflow / outflow / balance` 是 **cents（元 ×100）**。顯示時除 100。
- `correction_log` 是 **append-only**（trigger 阻擋 UPDATE/DELETE）—— 你只能讀，不能改歷史。
- `correction_log` **自帶規則脈絡**：每筆校正寫入時即帶 `match_key`（= `normalizeForRule(名稱)`）、`source_type`、`direction`、`rule_id`（若該筆原本是規則套用、被人類覆寫，則記該規則）。AI 第二環可直接 `GROUP BY match_key` 聚合 → 規則候選，**不必 join transactions**。`GET /api/corrections?matchKey=...` 可下鑽單一比對鍵的明細。
- `dedupe_key`：信用卡家族 = `hash(sourceType, date, name, amount)`；重匯不覆蓋人工已改的 category。
- `transactions.classification_source`：該筆分類怎麼來的 — `rule`（規則套用）/ `ai`（你 CSV 初分）/ `human`（人工修正後）/ `pending`（待你分析）。`rule_id` 指向套用的規則。

## 附錄三：分類規則契約

**規則資料模型**（`classification_rules` 表）：
- 比對條件（皆可選、AND 組合，留空 = 不限）：`match_key` / `source_type` / `direction`(`in`=轉入 / `out`=轉出)
- 分類結果（皆可選，留空 = 不動該欄）：`category_value`
- 元資料：`confidence`(0~1，你給) / `sample_count` / `origin`(`ai_analysis`|`human_correction`|`bootstrap`) / `enabled` / `note`
- 客觀指標（本工具維護，補 AI 主觀信心度）：`applied_count`（套用次數）/ `overridden_count`（被人類覆寫次數）；準確率 = (applied − overridden) / applied
- 兩側各至少需一項（至少一個條件 + 一個結果），否則 POST 會 400。

**`match_key` 必須用 `normalizeForRule(名稱)` 算**（本工具匯入套用與你產規則用同一演算法，否則對不上）。**強烈建議直接呼叫 `GET /api/rules/normalize?text=...` 取 match_key，不要自己手算**（順序錯會對不上）。步驟（與 `lib/normalize.js` 完全一致）：
1. NFKC 全形→半形（台灣帳單的 `Ｃａｂ`→`Cab`、`＊`→`*`、`－`→`-`）
2. 去期數 `\b\d{1,2}/\d{1,2}\b`（`保險費分期 01/12`→`保險費分期`）
3. 移除識別碼 token（`isLikelyIdToken`）：含數字 ≥4 碼，或「**全大寫**純英字母 ≥5 碼且母音 ≤1」（高熵隨機後綴如 `WMZPFP`/`QCPZWS`/`Z9FJ2T`）。⚠ **此步驟在 lowercase 之前，必須用原始大小寫判斷**——若先 lowercase，`/^[A-Z]{5,}$/` 永遠不成立，後綴不會被移掉，match_key 會對不上。
4. lowercase + collapse whitespace（最後才統一轉小寫並壓空白）

範例：`GOOGLE*CLOUD WMZPFP` / `Z9FJ2T` / `QCPZWS` → 都是 `google*cloud`。產規則前用 `GET /api/rules/normalize?text=...` 驗證。

規則套用發生在匯入當下（`POST /api/import-ledger` 的回應 `stats.rules_applied` 告訴你這次套了幾筆）。重匯不覆蓋人工已改的分類（`classification_source=human` 的不動）。

**信心度**：你對每筆分類都給 0~1；工具會把**低信心**排前面，讓人類優先審你沒把握的（規則的 `confidence` + 工具維護的 `applied_count`/`overridden_count` 一起決定排序與準確率）。

## 附錄四：月度分析報告食譜

```
GET /api/summary?month=2026-06
GET /api/breakdown?dimension=category&month=2026-06
GET /api/trend
→ 整理成自然語言月報
```

**管理用損益表（P&L）查詢範例**：
```
GET /api/reports/income-statement?month=2026-06&basis=card_accrual_management
```
- 回應含 `revenue` / `expenses` / `excluded` 各列、`net_income_cents`（= 總收入 − 總支出）、`coverage`（覆蓋率 / 已審比例 / 期間詮釋）、以及未映射的 `review_items`（前 25 筆，你的工作區）。
- 處理 `review_items` 與建 mapping / 規則見**流程 C**。

**`basis=card_accrual_management` 的信用卡繳款排除語意**：
此預設 basis 採「刷卡沖銷管理」觀點——信用卡**繳款**（`excluded:credit_card_payment`）與帳戶間**內部轉帳**被歸到 `excluded` 群，**不進損益的支出**，避免「刷卡消費」與「繳卡款」重複計入支出。也就是：消費已在刷卡當下計入費用列，繳款只是帳戶間移轉，再計一次會虛增支出。若你要看「現金何時流出」改用 `basis=cash`。built-in 會依關鍵字（card payment / 信用卡繳款 / autopay card 等）自動排除，查不到時靠逐筆 mapping 或規則補。
