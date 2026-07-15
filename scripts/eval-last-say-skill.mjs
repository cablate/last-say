import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const corpus = JSON.parse(readFileSync(resolve(root, '.claude/skills/last-say-ops/evals/cases.json'), 'utf8'));
const documents = [
  '.claude/skills/last-say-ops/SKILL.md',
  '.claude/skills/last-say-ops/references/api-contract.md',
  '.claude/skills/last-say-ops/references/financial-data-foundation.md',
  '.claude/skills/last-say-ops/references/fx-and-market-valuation-refresh.md',
  '.claude/skills/last-say-ops/references/monthly-workflow.md',
  '.claude/skills/last-say-ops/references/analysis-recipes.md',
].map((file) => readFileSync(resolve(root, file), 'utf8').toLowerCase()).join('\n');

if (corpus.schema_version !== 'last-say-skill-eval/v1' || !Array.isArray(corpus.cases) || corpus.cases.length === 0) {
  throw new Error('Invalid Skill eval corpus');
}

let failed = 0;
const ids = new Set();
for (const testCase of corpus.cases) {
  if (!testCase.id || ids.has(testCase.id) || !testCase.prompt || !Array.isArray(testCase.must_include) || testCase.must_include.length === 0) {
    failed += 1;
    console.log(`FAIL ${testCase.id || '(missing-id)'} malformed-case`);
    continue;
  }
  ids.add(testCase.id);
  const missing = testCase.must_include.filter((term) => !documents.includes(term.toLowerCase()));
  if (missing.length) {
    failed += 1;
    console.log(`FAIL ${testCase.id} missing=${missing.join(',')}`);
  } else {
    console.log(`PASS ${testCase.id}`);
  }
}
console.log(`Skill eval: ${corpus.cases.length - failed}/${corpus.cases.length} passed`);
if (failed) process.exit(1);
