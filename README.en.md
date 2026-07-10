<p align="center">
  <img src="./docs/brand/last-say-banner.jpg" alt="Last Say - AI-assisted local finance review">
</p>

<h1 align="center">Last Say</h1>

<p align="center">
  <strong>Your AI prepares. You have the last say.</strong><br>
  A local-first, human-in-the-loop workspace for reviewing bank statements.
</p>

<p align="center">
  <a href="https://github.com/cablate/last-say/actions/workflows/ci.yml"><img src="https://github.com/cablate/last-say/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-0f766e" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/data-local--first-0891b2" alt="Local-first">
  <img src="https://img.shields.io/badge/AI-bring%20your%20own-f59e0b" alt="Bring your own AI">
</p>

<p align="center">
  <a href="./README.md">繁體中文</a> · English
</p>

---

Last Say turns bank statements into a reviewable, auditable workflow. Bring Claude Code, Codex, or another agent to parse statements and propose classifications. Review only the uncertain transactions in the web UI. Last Say keeps the rules, corrections, and evidence so the next month does not start from zero.

It does not embed a model, require an AI API key, or upload your database to a finance SaaS.

## Why it exists

- **Spreadsheets store numbers, not decisions.** They do not remember why a merchant was classified a certain way.
- **AI chats can organize a statement, but forget the next session.** Last Say supplies durable rules and evidence retrieval.
- **Cloud budgeting tools are convenient, but require trust with sensitive data.** Last Say keeps SQLite, statements, and outputs on your machine.
- **Automation needs human authority.** Low-confidence work is explicit, reviewable, and never silently promoted to truth.

![Monthly close overview and spending direction](./docs/screenshots/overview-demo.png)

## How it works

```mermaid
flowchart LR
    U["Your statements"] --> A["External AI Agent\nparse, retrieve, classify"]
    A --> F["Last Say\nAPI + SQLite"]
    F --> R["Review queue"]
    R --> H["You confirm or correct"]
    H --> L["Evidence and reusable rules"]
    L --> A
```

1. The agent follows the bundled [Last Say Skill](./.claude/skills/last-say-ops/SKILL.md).
2. Known merchants use deterministic rules. Unknown merchants retrieve prior human corrections and similar cases before web research.
3. Every AI proposal includes a category, calibrated confidence, and a human-readable reason.
4. Human corrections become append-only evidence. Before the next import, the agent runs Flow B and creates only evidence-supported exact rules.
5. Editing, disabling, or deleting a rule re-evaluates linked history instead of leaving stale classifications behind.

<table>
  <tr>
    <td width="50%"><img src="./docs/screenshots/needs-review-demo.png" alt="Low-confidence transaction review queue"></td>
    <td width="50%"><img src="./docs/screenshots/trend-demo.png" alt="Rule automation rate over time"></td>
  </tr>
</table>

## Try it in three minutes

Requires [Node.js 22.5+](https://nodejs.org/) and Git.

```bash
git clone https://github.com/cablate/last-say.git
cd last-say
npm ci
npm run seed:demo
npm run dev
```

Open [http://127.0.0.1:3127](http://127.0.0.1:3127). The demo contains fictional transactions and exercises the overview, review queue, rules, trends, and management P&L.

If `3127` is already in use:

```bash
npx next dev -H 127.0.0.1 -p 3128
```

> Do not run a reset seed against an existing database. Development and tests must use a separate `FINANCE_DB_PATH`, never `data/finance.sqlite`.

## Use your own statement

Start the server, attach a CSV, PDF, or other statement to your preferred agent, and send:

```text
Last Say is running at http://127.0.0.1:3127.
Read only .claude/skills/last-say-ops/SKILL.md and the references it routes to.
Run Flow A for this statement: <file path>.
Stop after one imported month and report data quality plus the exact review URL.
Do not continue to another month without confirmation.
```

The Skill contains bank quirks, category boundaries, web research guidance, confidence rules, API contracts, privacy boundaries, and acceptance checks. Merchant facts stay in database rules and correction evidence rather than being hard-coded into the Skill.

## Current capabilities

| Capability | Status |
|---|---|
| Statement import, dedupe, source linking | Ready |
| Low-confidence and grouped human review | Ready |
| Correction evidence, rule quality, historical reclassification | Ready |
| Monthly overview, movers, recurring baseline, trends | Ready |
| Management P&L with explicit coverage | Ready, coverage-dependent |
| Balance sheet | Not complete; requires account roles and balance snapshots |
| Cash flow statement | Not complete; requires cash snapshots and transfer matching |

Last Say is currently a single-user localhost application with no authentication or tenant isolation. Do not expose port `3127` to a network or reverse proxy. See [SECURITY.md](./SECURITY.md).

## Feedback and contributions

- Star the repository if this workflow solves a problem for you.
- [Open an Issue](https://github.com/cablate/last-say/issues/new/choose) for reproducible bugs or missing bank formats.
- Use [Discussions](https://github.com/cablate/last-say/discussions) for workflows, operator ideas, and product direction.
- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before a PR. Never attach real statements, transactions, balances, databases, or unsanitized screenshots.

## Development

```bash
npm run dev
npm test
npm run build
npm run verify:release
```

The release verifier runs tests and builds against isolated databases, scans tracked files for personal finance residue, checks demo metrics, and validates committed screenshots.

## Roadmap

- Account roles and balance snapshots for a reconcilable balance sheet.
- Transfer matching and a direct-method cash flow statement.
- Configurable objective dimensions such as personal versus business.
- More shareable, sanitized bank format adapters.
- Read-only monthly AI insights that never mutate financial facts.

## License

[MIT](./LICENSE) © 2026 CabLate
