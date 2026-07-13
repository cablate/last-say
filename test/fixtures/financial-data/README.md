# Financial Data Foundation Fixtures

All values in this directory are synthetic. Institution, merchant, account,
instrument, and source names are deliberately fictional and must never be
replaced with data copied from `data/`, `uploads/`, or `outputs/`.

`manifest.json` is the fixture coverage registry. Each source mapping records
an input, its typed canonical payload, and the expected persistence/readiness
outcome. These JSON files freeze Phase 1+ contracts; they are not a generic
canonical storage format.

Build the legacy v0.2.3 rehearsal database only at an explicit temporary path:

```powershell
node scripts/fixtures/financial-data/build-legacy-v0.2.3.mjs --output (Join-Path $env:TEMP "last-say-legacy-v0.2.3.sqlite")
```

The builder refuses paths inside the repository and existing targets.
