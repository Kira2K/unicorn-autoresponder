# Noco Cleanup Audit

Audit/apply helper for NocoDB migration cleanup.

Purpose:

- Find empty migration leftovers and duplicate-looking relation columns.
- Separate cleanup candidates into `drop`, `archive`, `review`, and `keep`.
- Produce local reports before any future destructive schema work.

Safety:

- Dry-run does not delete columns.
- Apply mode currently deletes only explicitly approved, verified-empty columns.
- This job does not patch records.
- Relation columns are never marked as direct drop unless they look like duplicate reverse-link leftovers and are empty.
- `source_column`, `relation_*`, and quality notes are archival/migration trace fields, not immediate drop targets.
- Empty operational fields that the team intends to fill later are kept as `todo_to_fill_not_cleanup_bug`.
- `hh_conversion_snapshots.source_row` is kept as snapshot provenance, not treated as disposable migration trace.

Current approved apply scope:

- `clients.Students1` only, and only while it is still empty.

Commands:

```bash
npm run noco:cleanup-audit:dry-run
npm run noco:cleanup-audit:apply
npm run noco:cleanup-audit:test
```

Reports:

`logs/nocodb-cleanup-audit/<timestamp>/`

- `summary.json`
- `schema-snapshot.json`
- `column-audit.json`
- `drop-candidates.json`
- `archive-candidates.json`
- `review-candidates.json`
- `keep-candidates.json`
- `manual-review.md`
- `apply-result.json`
