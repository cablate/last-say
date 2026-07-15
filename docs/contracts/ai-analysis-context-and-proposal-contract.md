---
schema_version: behavior-contract/v1
id: finance.ai-analysis.proposal-context
title: AI 分析情境與提案封套
status: active
owner_surface: api
change_context:
  type: feature
  reason: 讓外部AI以具名、可追溯、有限制的資料集取得待處理情境，並產生指向既有typed owner的標準提案。
  non_goals:
    - 不提供arbitrary SQL、table／column expressions或整庫dump。
    - 不讓proposal envelope成為canonical fact或human confirmation。
    - 不在server內執行LLM。
---

# AI 分析情境與提案封套契約

## Behavior Boundary

`analysis-context`只提供registry中的named datasets。Candidate datasets是deterministic read models，必須指回resource keys、typed owner、action、三時間線impact、missing evidence與recovery；它們不自行寫入canonical state。

## Public Contract

- 新datasets：`transfer_candidates`、`reimbursement_candidates`、`recurring_candidates`、`installment_anomalies`、`statement_blockers`。
- 每個candidate使用`finance.proposal-envelope/v1`，至少包含`proposal_kind`、`target.owner/action`、`evidence.resource_keys`、`impact.timelines/summary`、`authority.human_review_required`、`missing_evidence`與`recovery`。
- Capabilities公開dataset filters／limits與proposal schema id；未知dataset／field、超限與過大response維持fail closed。
- Envelope是proposal hint，不是可直接commit的mutation payload；AI仍須讀取最新resource/version並走對應typed preview／PATCH／review流程。

## Invariants

- Dataset依requested entity過濾；不得洩漏其他entity的candidate。
- Response保留policy/source/resource watermarks，不回source filename、raw payload、content hash或SQL能力。
- Missing evidence保持明示；server不替AI選擇多候選配對。
- Proposal不得偽造`user_confirmed`、confirmation receipt或完整性聲明。

## Acceptance Examples

1. Unmatched transfer row回`transfer_matches/create_transfer_match`提示及missing opposite leg，不直接建立match。
2. Provisional commitment回`commitment_templates/review_commitment`，且review queue仍是決策owner。
3. Card profile沒有statement時回`statement_blocker`，不推算應付額。
4. 任意SQL-like filter或未知dataset回validation error。

## Test Mapping

```yaml
test_mapping:
  integration:
    - test/analysis-context-api.test.js
    - test/analysis-proposal-context.test.js
    - test/financial-capabilities.test.js
```

## Evidence

- `lib/finance/analysis/registry.js`、`proposal-envelope.js`、`lib/queries/finance/analysis-context.js`與capabilities。

更新觸發：dataset、filter、proposal shape、owner/action、privacy、watermark或response limit改變時更新。
