# Open Questions

用途：集中 Repository 無法回答、或必須由專案擁有者決定的問題。回答後應寫回相應長期目標、contract、ADR或operations文件，而不是只關閉這份清單。

Last validated against repository: 2026-07-15

## Owner decisions recorded 2026-07-15

### OD-1 — AI主輸入、UI確認與少量修正

- **Decision：** 外部AI是主要資料輸入與流程操作方式；UI負責確認、歧義、高風險授權與少量修正。
- **Consequence：** 不要求所有backend resources具完整CRUD UI。新增UI必須有高頻確認／修正摩擦的證據；大量statement、trade與schedule輸入仍優先走AI＋typed API。
- **Affected：** `Final-Long-Term-Goal.md`、Product And Users、Roadmap Current Gate F。
- **Revisit trigger：** AI operator流程無法讓目標使用者完成核心資料建設，且問題不能以Skill／error recovery／bounded UI修正。

### OD-2 — Foundation現在、Control Center下一階段

- **Decision：** 現階段先讓所有財務資料基礎與實際業務邏輯完整跑順；Financial Control Center是下一階段，必須圍繞既有foundation展開。
- **Consequence：** Control不得重建canonical facts；現在不以reserve、reliable income或safe-to-spend policy阻擋foundation工作。
- **Affected：** Roadmap、Master Financial Control Plan、Current Status與root LTG。
- **Revisit trigger：** Owner確認foundation flow已滿意，準備啟動Control runtime slice。

### OD-3 — 先簡單可用，後續再優化

- **Decision：** 核心業務邏輯完全跑順並令owner滿意前，其他部署、policy、UI與架構問題採現有最簡單安全做法。
- **Consequence：** 維持single-user localhost、explicit currency／existing report defaults、manual backup tools與bounded UI；不提前做remote、多租戶、完整admin、複雜自動policy或純美化重構。
- **Revisit trigger：** 核心flow穩定，或現有簡單做法已造成明確correctness／recovery／usage blocker。

## 尚待決定，但目前不阻擋foundation

### OQ-1 — Root長期目標何時正式Approved？

- **Resolved portion：** Owner已確認AI／UI責任、foundation→Control順序與簡單優先原則。
- **Still open：** `Final-Long-Term-Goal.md`整體使命、成功標準與所有長期非目標尚未逐項正式核准，因此Status維持Draft。
- **Current impact：** 不阻擋foundation closure；也不授權把Phase 0 reference接成runtime forecast。

### OQ-2 — 產品的永久部署邊界是什麼？

- 維持single-user、localhost、external AI operator？
- 要支援同裝置家庭共享、LAN、remote或multi-user嗎？
- **Impact：** 一旦超出loopback，需要auth、authorization、TLS、CSRF、rate limit、secret、audit與threat model，不能只改host。
- **Current simple default：** 維持single-user localhost；業務flow穩定前不展開永久部署策略。

### OQ-3 — Resolved：Manual UI與external AI責任

已由OD-1回答。AI是主要輸入，UI負責確認與少量修正；不追求無AI的完整建檔流程。只保留「哪些具體確認／修正值得補UI」作為使用證據驅動的小決策。

### OQ-4 — Base currency與FX政策

- financial position／forecast預設base currency是entity設定、report request或固定TWD？
- quote／FX多舊時只能顯示partial，是否允許last-known value？
- **Impact：** formal position、net worth、BS、forecast與safe-to-spend。
- **Current simple default：** facts保留原幣；現有management report沿用explicit／TWD default；在正式position consumer前不建立全域偏好系統。

### OQ-5 — Reserve與safe-to-spend政策

- reserve floor由固定金額、月支出倍數、到期義務或組合定義？
- owner可否override，override保存多久、如何顯示風險？
- **Impact：** Control Plan最核心metric；AI不能自行決定。
- **Status：Deferred。** 到safe-to-spend slice才需要，不是current foundation gate。

### OQ-6 — Reliable income定義

- 用最近N期、明確recurring source、人工標記或employment contract？
- 補貼／轉帳／一次性收入如何排除？
- **Impact：** forecast與「至少需要多少收入」的可信度。
- **Status：Deferred。** 到runtime forecast slice才需要；目前reference維持uncertain income不計入保守路徑。

### OQ-7 — Statement與Control優先順序

- 先完成formal Balance Sheet，再做obligation／forecast？
- 或先做trusted position read model，與obligation timeline平行，再延後statement presentation？
- **Recommended：** 先position semantics，再依使用者價值平行，不先做static statement UI。
- **Resolved portion：** Control Center整體在foundation closure之後。Control內部與formal statements的細部分序，等進入下一階段再定。

## Operations／governance decisions

### OQ-8 — 資料保留與刪除

反轉imports、identity redirects、source metadata、confirmation、correction／rule／data change logs保存多久？是否需要export／purge？append-only evidence與隱私刪除如何平衡？

### OQ-9 — Backup RPO／RTO

可接受損失幾天資料？多久內要還原？backup放在哪裡、保留幾份、是否需要加密／off-site copy？Repository目前已有手動CLI、read-only health／freshness check、policy worksheet與匿名rehearsal，但沒有owner填值、實際schedule或retention automation。決策應回寫[`../operations/BACKUP-POLICY.md`](../operations/BACKUP-POLICY.md)。

**Current simple default：** 保留現有explicit manual CLI與health check，不自動刪除、不自動上傳、不替owner切換active DB；正式自動化等核心flow穩定或backup成為實際blocker再處理。

### OQ-10 — 支援的oldest DB version

是否承諾從任何v0.2.3前DB升級，或只支援特定baseline？何時可移除`lib/db.js`compatibility schema／ALTER path？

### OQ-11 — Windows是否為一級支援平台？

主要本機工作環境是Windows，但CI只有Ubuntu。是否要加入Windows CI／release verification，或只做best effort？

### OQ-12 — Observability與錯誤回報邊界

是否接受完全本機、opt-in diagnostics？哪些metadata可記錄而不洩漏財務事實？是否永遠不使用telemetry？

## Product scope questions

### OQ-13 — 個人或家戶？

`reporting_entities`支援多entity，但沒有共享user／permissions。若正式支援家戶，entity間transfer、ownership、共同liability與privacy如何定義？

### OQ-14 — Notification channel

alerts只在app內，或要OS／email／mobile通知？外部通知會引入service、credential與privacy風險，應晚於alert lifecycle本身。

### OQ-15 — Formal accounting邊界

Management Balance Sheet／Cash Flow的目標接受度是「個人控制用途」還是要接近會計準則？目前非目標明確排除GAAP／IFRS／tax／audit claim。

### OQ-16 — External integrations

是否長期維持file-based ingestion，或預期bank API／market data provider？若沒有具體需求，不應現在抽象provider layer。

## Repository 無法確認的事實

- 真實資料規模、來源更新頻率與每月review負擔。
- 非技術使用者首次建檔成功率。
- 現有backup是否定期執行與最近一次restore drill。
- control metrics對owner實際決策是否足夠。
- app是否曾被放到LAN／remote環境。

這些Unknown不得由AI從code推測。可用匿名統計、owner回答或受控usability／operations evidence補足，不需讀取或公開真實交易內容。

## 決策記錄格式

回答時至少記錄：Decision、Owner、Date、Context／evidence、Alternatives、Consequences、Affected goals/contracts/docs、Revisit trigger。架構型決策寫ADR；產品使命更新root長期目標；操作政策寫operations文件。

更新觸發：問題有新證據、owner作出決策、default不再安全或新roadmap gate需要決策時更新。已回答項應移到對應owner文件並在此留下短連結。
