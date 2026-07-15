# External Integrations

用途：盤點 Last Say 與外部 AI、browser、filesystem、套件服務及 GitHub 的整合，並說明 trust、timeout、retry、rate limit 與替換風險。

Last validated against repository: 2026-07-15

## 摘要

**Confirmed：** 產品 runtime 不依賴雲端 API、bank API、LLM API、webhook、queue 或 remote database。主要外部整合是「使用者自己執行的 AI agent」和「本機檔案」。CI 另依賴 GitHub Actions／npm registry。

## External AI operator

| 面向 | 現況 |
|---|---|
| Contract | `.claude/skills/last-say-ops/SKILL.md` 與 references 定義 discovery、import、review、analysis SOP |
| Transport | 對 localhost JSON APIs；AI 不得直接寫 SQLite |
| Model provider | 未綁定；README 列 Claude Code／Codex／其他 agent |
| Server-side credentials | 無 AI API key、無模型 SDK |
| Safety | capabilities／inventory／readiness → preview → commit；高風險操作需 browser confirmation |
| Verification | `scripts/eval-last-say-skill.mjs` 與 financial operator contract tests |
| Failure behavior | agent應停止於 Unknown／blocked readiness，不能猜值或繞過 confirmation |

**Vendor lock-in：低到中。** HTTP API 與 deterministic facts 不依賴模型商，但目前 operator文件採 Claude skill 目錄慣例；其他 agent 是否完全遵循需 conformance evidence。

**Missing：** 沒有 server-side timeout、retry 或 rate limit，因 server 不呼叫模型。外部 agent 的 web search／provider failure由 agent環境負責，不應改變 Last Say canonical facts。

## Browser／same-origin integration

- UI 使用 relative `fetch` 連到同一 Next.js origin。
- `middleware.js` 的 CSP `connect-src 'self'` 阻擋任意外連。
- high-risk confirmation 檢查 cookie nonce、Origin／Sec-Fetch-Site與一次性 authorization。
- 一般 APIs 依賴 `127.0.0.1` trust boundary，沒有 user identity、roles、rate limiting。

**Recommended：** 若要允許 LAN、reverse proxy、mobile 或 remote access，先建立獨立 threat model；不能只把 host 改成 `0.0.0.0`。

## Filesystem 與來源檔

| 整合 | 路徑／工具 | 邊界 |
|---|---|---|
| SQLite | `FINANCE_DB_PATH` 或 `data/finance.sqlite` | 必須在 private local storage；無 application-level encryption |
| statements／uploads | `uploads/`、root CSV或 user-provided path | gitignored；外部 AI／CLI 解析；Repository 盤點不讀內容 |
| generated outputs | `outputs/` | gitignored；不得視為 canonical facts |
| backup bundle | `scripts/finance-backup.mjs --output` | 可選 include sources；manifest／hash但不加密 |
| restore target | `finance-restore.mjs --target` | 只能新檔；人類決定 active DB 切換 |

`app/api/import-ledger/route.js` 會回傳 `csvPath`。在 localhost operator模式可診斷來源，但若 trust boundary 擴張可能洩露 local path。

## npm／framework dependencies

- Runtime framework：Next.js、React／React DOM。
- UI：Radix、lucide-react、Recharts、class utilities、Sonner。
- Build／style：Tailwind、PostCSS、ESLint、shadcn tooling。
- Test-only browser：Playwright與本機／CI安裝的Chromium；不是product runtime dependency。
- Persistence 使用 Node 內建 `node:sqlite`，沒有 ORM／native addon package。

依賴版本由 `package-lock.json` 固定；本次盤點只讀 manifest與 audit結果，不逐項分析 lockfile transitive package。

**Replacement risk：** Next App Router／React 是主要 framework coupling；Recharts／Radix 屬 presentation coupling；SQLite與 REST contract 是產品核心，但具可攜的資料語意。不要為抽象供應商而提前引入 repository/service layer，除非有實際替換需求。

## GitHub 與供應鏈

- `.github/workflows/ci.yml` 在 push／PR／manual run 使用 Node 22、`npm ci`、Playwright Chromium安裝與`npm run verify:release`。
- `.github/workflows/codeql.yml` 在 main push／PR與每週排程分析 JavaScript。
- README badge／repository metadata 指向 GitHub。

**Failure behavior：** CI 超時 15 分鐘；concurrency 取消舊 run。沒有 release publishing workflow、signed artifact、container registry 或 deployment target。

## 明確不存在的 runtime integrations

Repository 搜尋沒有找到：bank open API、Plaid 類 aggregator、OAuth、email／SMS、push notification、webhook、WebSocket、queue、cron、cloud storage、remote telemetry、Sentry／APM、payment provider。

「找不到」不能證明未來不會加入；目前判定只適用驗證日與 tracked source。

## Timeout、retry、rate limit 與濫用防護

| 類型 | 現況 | 影響 |
|---|---|---|
| SQLite lock wait | `busy_timeout=5000` | 有限本機 write contention；不是 distributed retry |
| HTTP timeout | 未在 app 層統一定義 | local request通常短；長 query可能卡住 client |
| Retry | 無通用 retry middleware | agent須依 idempotency與結果狀態判斷，不可盲重送 |
| Rate limit | 無 | localhost可接受；remote exposure不可接受 |
| Circuit breaker | 無且目前無 outbound service | 不需要，除非未來加入 remote integrations |
| Abuse prevention | host binding、same-origin CSP、高風險 confirmation | 不等於一般 API auth |

## Needs owner decision

- 是否永久不支援 bank API／cloud sync，維持 file-based external AI ingestion。
- 是否要定義 vendor-neutral operator protocol，而不只 skill文件。
- 是否要支援遠端 access；若要，auth、secret management、TLS、CSRF、audit與 rate limit必須先進 roadmap。
- backup 是否需要 application-level encryption或只依賴 OS/private storage。

更新觸發：新增／移除外部服務、AI operator contract、network exposure、filesystem zone、dependency owner或供應鏈流程改變時更新。
