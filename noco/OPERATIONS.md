# Noco Operations Runbook

Short reference for ongoing post-migration data-quality work.

## Current Baseline

- Noco native relations and record `Id`s are canonical.
- Old sheet/workbook imports are archive/read-only history.
- Current Noco client statuses are authoritative; the old Google status sheet is
  advisory only.
- Completed one-shot migration/drop/rename jobs have been removed from source.
- Historical reports under `logs/` remain the audit trail.
- Active jobs must not read or write migration refs, `current_status`,
  `primary_stack`, raw `english_level`, or numbered FK display titles.

## Health Gate

Primary command:

```bash
npm run noco:post-migration-health:dry-run
```

This runs the read-only health gate: relations, Dolphin profile audit,
advisory client-status comparison, stop companies, sync markets, sync mentors,
ref readiness, and cleanup audit.

Client-status sheet mismatches do not fail the health gate. Known blocking
buckets are unsafe relation rows, Dolphin conflicts/duplicates or missing
profile rows, and cleanup review candidates.

## Relation Health

```bash
npm run noco:relations:dry-run
npm run noco:relations:apply
```

Read `summary.json`, `unsafe.json`, and `warnings.json` before apply. Relation
review views are disabled by default unless `NOCO_RELATIONS_CREATE_REVIEW_VIEWS`
is explicitly set.

## Current Sync/Audit Jobs

```bash
npm run noco:dolphin-profile-audit:dry-run
npm run noco:client-status:dry-run
npm run noco:stop-companies:dry-run
npm run noco:sync-markets:dry-run
npm run noco:sync-mentors:dry-run
npm run noco:hh-response-readiness
```

Apply only the jobs that expose an apply script and only after reviewing their
dry-run reports.

`noco:client-status:dry-run` is advisory. The old sheet can be stale, so do not
apply its patches or use it as a source for overwriting Noco.

## Safe Cleanup Rule

```bash
npm run noco:cleanup-audit:dry-run
```

Only delete columns that the audit marks as deterministic and that the job
explicitly supports in apply mode. Do not delete operational relation columns or
manual-review fields because they look visually noisy.

## Full API Backup

Before destructive schema work:

```bash
npm run noco:full-backup:apply
```

The job is read-only against NocoDB. It writes table metadata, visible records,
checksums, and best-effort permission/settings/hooks metadata to
`logs/nocodb-full-backup/<timestamp>/`.

## Ref Column Readiness

```bash
npm run noco:ref-drop-readiness:dry-run
```

This is now a historical safety report for already-retired ref columns and
remaining archive-only references. It does not delete anything.

## Replaying Old Migrations

Do not restore or rerun removed one-shot migration jobs. If old import behavior
is needed again, rebuild a small job against the current schema and native
relations.
