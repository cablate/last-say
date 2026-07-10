# Search Playbook

Use web search to reduce ambiguity, not to produce decorative citations. The output still belongs in transaction judgment reasons and rule notes.

## When To Search

Search when any of these are true:

- The statement merchant name is truncated.
- The merchant is unfamiliar.
- The same normalized key could plausibly map to multiple categories.
- The category confidence would be below `0.6` without more evidence.
- A rule note needs a source-backed merchant identity.

## Query Patterns

Prefer targeted Taiwan merchant queries:

- `<truncated merchant name> 台灣`
- `<truncated merchant name> 店家`
- `<truncated merchant name> 公司`
- `<merchant fragment> 信用卡 消費`
- `<merchant fragment> 發票`
- `<merchant fragment> 地址`

For English or platform names, search both the original fragment and a normalized form:

- Keep symbols that may be brand-significant, such as `*`, for one query.
- Try a plain-space version if the symbolic query fails.
- Remove obvious random authorization tokens before searching.

## Evidence Quality

Calibrate confidence from the evidence:

- Official merchant site, government/company registry, store locator, or clearly matching payment descriptor: usually high confidence.
- Multiple consistent third-party sources: medium to high confidence.
- One weak directory hit or fuzzy name match: medium or low confidence.
- No useful result: keep the best guess low-confidence and do not create a rule below `0.6`.

## Notes

Rule notes should state the merchant identity, what it is, and the source type in one short sentence.

Do not paste long source excerpts. Do not store a merchant dictionary in this file.
