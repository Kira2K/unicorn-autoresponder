# Noco Operational Jobs

This folder contains the NocoDB code that is still useful after the migration:
runtime DB access, core helpers, backups, relation health, sync checks, and
post-migration gates.

## Rules

- Default mode is always dry-run.
- Apply mode must write reports before mutating data.
- Keep business logic in the job folder, not in `noco/core`.
- Reuse `noco/core` for NocoDB API calls, relation helpers, reports, and CLI parsing.
- Reuse `noco/integrations` for existing external services.

## Active Jobs

- `noco/full-backup`: read-only full Noco metadata/record backup.
- `noco/relations`: native relation health and repair.
- `noco/dolphin-profile-audit`: Dolphin profile/Noco binding audit.
- `noco/stop-companies`: stop-company parsing and relation linking.
- `noco/sync-markets`: market relation sync.
- `noco/sync-mentors`: mentor relation sync.
- `noco/client-status`: advisory comparison against the old status sheet.
- `noco/cleanup-audit`: schema/data cleanup gate.
- `noco/ref-drop-readiness`: historical ref-drop safety report.
- `noco/post-migration-health`: aggregate read-only health gate.
- `noco/hh-response-readiness`: HH response readiness report.

## Removed Jobs

Old one-shot migration, drop, rename, and polish jobs were removed after the
migration completed. Historical reports under `logs/` are the audit trail. If an
old migration ever needs replay, rebuild it against the current schema instead
of restoring stale job code.

## Current Baseline

- Noco native relations and record `Id`s are canonical.
- Old sheet/workbook imports are archive/read-only history.
- Current Noco client statuses are authoritative; old status-sheet differences
  are advisory only.
- Deleted legacy/source columns are intentionally gone.
- Active jobs must not depend on migration refs, `current_status`,
  `primary_stack`, raw `english_level`, or numbered FK display titles.
- Missing Dolphin profile rows may be intentional cost saving.

## Token-Saving Workflow

1. Start with the latest relevant report:
   - `logs/nocodb-post-migration-health/latest.txt`
   - `logs/nocodb-relations/latest.txt`
   - `logs/nocodb-cleanup-audit/latest.txt`
   - `logs/nocodb-ref-drop-readiness/latest.txt`
   - `logs/nocodb-full-backup/latest.txt`
2. Read `summary.json` first, then only the focused report file.
3. Prefer confirmed identity facts in `noco/core/client-ref-overrides.ts` over
   scattered one-off matching logic.
4. Keep apply jobs idempotent: dry-run, apply, dry-run again.

## Handoff

Use `docs/NOCO_HANDOFF.md` as the short colleague-facing overview before
walking someone through the operational scripts.
