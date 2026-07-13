# ADR-0005: Ingestion Staging Retention and Privacy

- Status: Accepted
- Date: 2026-07-14
- Goals: DF-G2, DF-G7, DF-G11

## Context

Preview requires normalized typed payloads before commit, but statements and
contracts are sensitive. Keeping raw staging indefinitely duplicates financial
data and expands accidental logging/backup exposure.

## Decision

- Source artifacts remain outside SQLite in allowlisted gitignored roots. DB
  stores source metadata, fingerprint, relative path hint, and artifact status.
- Preview staging JSON is permitted only in `ingestion_items`; it is never a
  canonical analysis source.
- Successful commit purges raw/normalized staged payload immediately after the
  atomic canonical write. Keep only run/context counts, hashes, schema versions,
  warnings/error codes, target resource keys, and commit/reversal evidence.
- Uncommitted preview payload expires after 24 hours. Failed validation payload
  expires after 24 hours; minimal failure metadata may remain 30 days for local
  diagnostics. Cleanup is deterministic and testable.
- Expired/consumed human confirmation secrets and request rows may be purged
  after 7 days; the resulting high-risk action remains in append-only
  `data_change_log`.
- Logs/errors never include raw rows, full account/card numbers, complete URLs
  with secrets, or full request bodies.
- Source artifact lifecycle is user-managed. Purging/missing artifacts changes
  `artifact_status` and provenance/reparse readiness, not canonical facts.
- DB-only backup excludes artifacts and declares this in its manifest. Full
  bundle includes only referenced allowlisted non-symlink files with hashes.

## Rejected Alternatives

- Permanent raw payload in SQLite: excessive duplication and privacy risk.
- Immediate purge of failed previews: makes correction/debugging impractical.
- Store source blobs in canonical DB: expands backup and API blast radius.

## Verification

Phase 2 tests must control time and prove success purge, 24-hour expiry,
redacted logs, and continued provenance/readiness after artifact deletion.
