# AGENTS.md — 給 AI 編程助手的開發規則（Codex / Claude Code）

> Finance Viewer 是**使用者本機架設的財務資料伺服器**（SQLite + REST API + Web UI）。
> **這個工具本身不做 AI。** 帳單處理、分類、規則維護由外部 AI 依 `.claude/skills/finance-viewer-ops/SKILL.md` 操作（該 Skill 目錄自含完整 API 契約與 SOP）。
> **本檔給「修改這包程式碼」的 AI 遵守。** 如果你的任務是處理帳單／操作資料 → 改讀 Finance Viewer Skill，不是這裡。`prompts/playbook.md` 只保留為舊入口轉址。

## 架構一句話

外部 AI（讀帳單、檢索歷史證據、分類、websearch、建規則、報表映射）→ REST API → SQLite；人類在 Web UI 終審。工具只做 CRUD ＋ 唯讀經驗檢索 ＋ 匯入時機械式套用規則 ＋ 報表列映射。關鍵路徑：`app/api/*`（route）→ `lib/queries/*`（SQL）→ `lib/db.js`（schema 單例）；`lib/constants.js` 前後端共用常數；`lib/normalize.js` 是規則比對鍵演算法；AI 經驗檢索走 `lib/queries/learning.js`，只排序證據、不自行分類；報表映射另走 `lib/reporting/*`（report-lines 的 `REPORT_LINE_DEFINITIONS` 白名單 + coverage）+ `lib/queries/reports/*`（income-statement / mappings）+ `app/api/reports/*`（route）。

## 系統不變量（任何改動都必須保持）

1. **金額 / 日期 / 來源欄位不可改** — API 沒有此寫入路徑，不要新增。
2. **人工可編輯欄位只有白名單**（`lib/constants.js` EDITABLE_FIELDS）— 這同時是 SQL injection 防線（動態欄位名只來自此陣列）。
3. **correction_log append-only** — trigger 阻擋 UPDATE/DELETE；log 應存活比源資料久（FK ON DELETE RESTRICT）。
4. **匯入不覆蓋人工修正**（`classification_source=human` 的不動）。
5. **工具不內建 AI** — 任何「在 server 裡呼叫 LLM」的功能都不要做，那是外部 agent 的職責。
6. **match_key 正規化（`lib/normalize.js`）是系統命脈** — 演算法或步驟順序的改動會讓既有規則全部失配；動它 = 需要規則遷移計畫，不是普通 refactor。
7. **規則生命週期必須連動歷史資料** — 修改比對條件／分類／啟用狀態或刪除規則時，只能透過 rules query/API 在同一 transaction 重新校正目前仍連結的交易；已確認與 `classification_source=human` 的人工判斷不可覆寫。系統重算只寫 append-only `rule_change_log`，不得冒充人工修正寫入 `correction_log`。

## 重要：真實財務資料

`data/finance.sqlite` 是使用者的真實帳單，真實資料也會流經 `uploads/`、`outputs/`。**不要**把內容寫進任何會外送的檔案、commit、或公開 log；screenshot 與 commit 訊息同樣不可含真實交易內容。

---

## 開發／審查時的分析角度

### 核心價值判準（反膨脹守則）

本工具的價值 = **規則記憶（複利）+ append-only 審計軌跡 + 人工審核 UI**。三者都是「狀態」——AI 每次對話會忘、工具不會忘的東西。

- 評估任何新功能先問：「這是不是 AI 自己就能做、不需要工具持久狀態的事？」是 → 不要加進工具。
- 反向也成立：凡是「人類判斷過一次、系統應該記住」的事，都應該有通往規則／log 的路徑。找不到路徑 = 動線缺口。

### 動手前的核對紀律

1. **文件宣稱 ≠ 現實**：任何「已完成／已移除／0 殘留」的說法，用 grep / `git status` / `git diff` 驗過再信。交接文件記的 bug 歸因，**先重現再修**——某層有 try/catch 不代表錯誤來自那層。
2. **隱私紅線掃描**：真實財務資料會流經 `uploads/`、`data/`、`outputs/`（import 路徑白名單的三個目錄 = 高風險點）。改動任何資料流前，用 `git check-ignore` 確認落地路徑被 gitignore 覆蓋。
3. **同步觸點意識**：這個專案的概念改動幾乎都是多點同步。改分類清單 → `lib/constants.js` / Finance Viewer Skill / `README.md` / `scripts/seed-demo.js` / UI。加分類維度 → constants 的 EDITABLE_FIELDS 三件組 / `validateRule`／`decodeRule` / UI（編輯＋批次＋badge＋篩選）/ Skill。改 **report_line 白名單**（`lib/reporting/report-lines.js` 的 `REPORT_LINE_DEFINITIONS`）→ 同步 Skill 的 API／月度流程 references／`components/reports/ReportsView`（UI 顯示）——漏一處外部 AI 會拿著過期白名單打 `POST /api/reports/mappings` 被 400 擋。改完 grep 舊值歸零才算完成。
4. **契約文件是介面**：`.claude/skills/finance-viewer-ops/` 是外部 AI 的唯一操作契約——任何 API、資料模型、normalize 或學習證據行為的改動，Skill references 必須同步，否則操作員 AI 會拿著過期契約打 API。

### 問題拆層（「分類分不準」類問題的固定解法）

先拆三層再治，混著修會白工：

- **資料層**：現在 DB 裡的分類是誰產的？（seed mock ≠ 真 AI 品質，別為 mock 的錯去調系統。）
- **語意層**：分類清單本身是否符合使用者心智模型？邊界案例（超商、電商這類混合型商家）有沒有裁決規則？
- **契約層**：提示詞有沒有給判準表＋決策樹？**欄位存在 ≠ 會被填**——軟要求（「建議寫 note」）要升級成硬契約（必填＋回報前自查覆蓋率），否則 AI 一定省略。

### UX 審查方法

- 走**完整動線**（匯入→總覽→審查→修正→規則），不是逐頁看功能。
- 用「連續第 N 次操作」評估成本：一個動作多 2 次點擊，在 90 筆的審查裡就是多 180 次。單看一筆都不痛，痛在重複。
- 資訊藏在第二層（要展開／hover 才看得到）＝ 等於沒有。審查場景的關鍵資訊（AI 判斷理由、信心度）必須在列表層直接可見。
- 人類判斷完一件事，下一步應該是「系統記住」（建規則動線），不是讓人下個月再判斷一次同樣的事。

### 維度設計判準（未來加 owner／necessity 類功能時）

一個分類維度適不適合做「AI 逐筆標籤」，取決於它是否**客觀、穩定、可從商家推導**：

- **客觀維度**（如 個人/事業）→ 走既有規則系統：可學習、可回饋、correction_log 天然支援。
- **主觀時變維度**（如 該不該花）→ 不做逐筆標籤——會製造大量偽待審，且「每筆被 AI 評判」是產品層的被審判感。改做**聚合層洞察**（月度報告：閒置訂閱、佔比變化、可優化清單），不寫回 DB、不進審查佇列。

### 開源產品視角

- 這是要給陌生人用的工具：demo seed 的資料品質、README quickstart、錯誤訊息，都是第一印象的一部分，與功能同等級。
- 特定銀行或在地格式邏輯要可抽換（銀行別 playbook 段落、分類清單可配置化是方向），別讓通用架構長出硬編碼的單一來源假設。
