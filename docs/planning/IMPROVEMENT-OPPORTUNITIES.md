# Improvement Opportunities

用途：把改善機會依成熟度與價值分類，避免將所有可做事項誤排成近期工作。優先級的最終依據仍是 [`GAPS-RISKS-AND-DEBT.md`](GAPS-RISKS-AND-DEBT.md) 與 owner決策。

Last validated against repository: 2026-07-16

## Current execution rule（owner-confirmed 2026-07-15）

目前不從「還能加什麼功能／優化」選工作，而是從實際foundation業務流程的阻礙選工作。AI是主要輸入，UI負責確認與少量修正；只有correctness、typed commit、error recovery、readiness、confirmation或owner workflow的具體問題值得現在投入。完整CRUD、Control Center、reserve／income policy、remote deployment與抽象重構全部延後。

## 本輪已完成

- **Canonical UI money boundary：** `lib/finance/money/presentation.js`已成為Data Center輸入／顯示共用層，JPY／TWD／USD round-trip與invalid precision有測試。
- **三張可信管理報表：** Balance Sheet／Cash Flow已從static readiness演進成server-backed read model，與P&L共同輸出scope、watermarks、coverage、blockers與drillback；不完整資料不會被補成0。
- **可設定但維持loopback的PORT：** launcher統一process env／`.env` precedence、range validation與`127.0.0.1` binding。
- **Critical browser E2E：** isolated DB已覆蓋Data Center、管理損益表、資產負債表、現金流量表與unified review workbench的主要狀態；已納入release驗證。
- **Control Phase 0 semantic package：** 四份contracts、metric dictionary、synthetic pressure fixture與pure 90-day timeline projector已建立；它是reference，不是runtime forecast。
- **Manual Data Center核心建檔：** 全account kinds、instrument、holding、quote與FX可由UI建立；manual source＋fact在同一transaction內寫入。
- **Recovery groundwork：** backup health CLI與policy worksheet已建立；實際RPO／RTO／schedule仍待owner。

## Control Center下一階段最值得投入（目前排隊，不立即執行）

### Foundation-to-Control position adapter

- **Why：** 管理資產負債表已能提供可信as-of position，但Control runtime尚未消費同一份facts與coverage。
- **Scope：** 以`docs/contracts/financial-position-contract.md`建立薄adapter，重用既有Balance Sheet owners，不建立第二套position truth。
- **Prerequisites：** MP-07 owner acceptance；真正進入forecast時才決定更完整的base-currency／freshness policy。
- **Expected：** Control starting position可追溯到同一report facts，missing／stale維持降級；解鎖forecast starting cash與net position。
- **Do not expand into：** GAAP／IFRS、tax、cloud quote provider或漂亮但無coverage的dashboard。

### Commitment／liability timeline

- **Why：** cards、installments、loan schedules與commitments已有typed facts，卻沒有統一回答「何時要付」。
- **Scope：** purchase／payment、principal／interest／fee與internal transfer不重複的future cash events。
- **Prerequisites：** `docs/contracts/commitment-and-liability-contract.md`與owner對unknown amount／due date的處理政策。
- **Expected：** 可追溯、可去重、可表達paid／scheduled／expected／overdue／uncertain的時間軸。

### Runtime adapter for Control Phase 0

- **Why：** pure projector已驗證語意，但目前只吃synthetic inputs。
- **Scope：** 從governed SQLite facts產生contract input，保留source／freshness／coverage，先不建立Control Center。
- **Prerequisites：** trusted position、commitment timeline與reliable income policy。
- **Expected：** 同一fixture能由DB adapter產生與pure projector一致的daily curve；coverage partial時safe-to-spend維持Unavailable。

### Owner-approved recovery operation

- **Why：** 工具已能建立、驗證與還原bundle，但沒有證據顯示真實backup按期存在。
- **Scope：** owner填寫RPO／RTO／位置／retention／責任人，使用OS scheduler執行，留下last-known-good與restore drill evidence。
- **Expected：** `backup:check`在RPO內通過，且能在RTO內restore到new target。
- **Do not expand into：** 未經授權的自動刪除、未決定位置的cloud upload或由AI切換active DB。

## Foundational improvements

### Oldest-supported DB與compatibility policy

建立可公開的legacy DB fixture與support window，才能安全縮小`lib/db.js`內的雙軌schema責任。這是migration安全工作，不應與feature開發混在同一變更。

### Bounded browser characterization

目前只有一條高價值E2E。重構`TransactionTable.jsx`、`Overview.jsx`或大型query前，應針對欲拆use case補characterization，不追求一次建大全站suite。

### Minimal diagnostics baseline

先用匿名代表資料建立query latency、DB size與lock contention baseline，再決定是否加入sanitized structured timing。沒有SLO前不導入完整APM。

## Strategic investments

### Deterministic 90-day runtime forecast

從已確認starting cash與future cash events產生日曲線、最低點與driver events。所有結果附scope、policy、freshness與confidence；AI只解釋，不產生canonical cash curve。

### Safe-to-spend與alert lifecycle

在runtime forecast成熟後導入reserve policy、guardrail與可ack／resolve的alerts。這是長期目標的主要使用者價值，但不可跳過owner政策與coverage gate。

### Formal Balance Sheet與Cash Flow

Balance Sheet建立於可信position；Cash Flow須先定義cash boundary、transfer與begin/end reconciliation。兩者皆為management用途，不宣稱法定會計。

### Minimal operational maturity

當工具成為日常依賴後，再加入graceful shutdown、sanitized structured logs、performance baseline、release／restore drill紀錄。

## Optional experiments

- Forecast scenario比較：只有base forecast穩定後，測試收入下降、支出延後、提前還款等可逆scenario。
- Source parser adapter registry：只有出現第二種穩定來源格式與重複integration成本後才抽象。
- Owner-facing onboarding wizard：先以usability evidence確認external AI流程的實際摩擦。
- Rule quality analytics：以override rate與review burden評估學習效果，不以AI confidence作唯一指標。

實驗不得直接改canonical facts；需使用匿名fixture、feature boundary與明確成功／停止條件。

## Premature or unnecessary optimizations

- 微服務、event bus、distributed queue、remote cache。
- ORM全面重寫或為「乾淨」而更換SQLite。
- bank aggregator／cloud sync／multi-tenant基礎，除非owner改變產品邊界。
- AI自動執行financial action或跳過human confirmation。
- 所有backend table都做CRUD admin UI。
- 在沒有baseline前做query micro-optimization或複雜observability平台。
- 因檔案大就重構；必須先有behavior contract與可觀察收益。

## 選擇改善項的判準

依序問：是否修正資料／信任風險？是否解鎖多個後續能力？是否有已確認使用者價值？前置語意是否完整？能否用更小fixture驗證？是否增加長期維護與network／privacy責任？不做的後果是否高於其他阻礙？

更新觸發：風險排序、owner策略、foundation能力、使用者證據或實驗結果改變時更新；機會進入執行後應在Roadmap與contract取得正式owner。
