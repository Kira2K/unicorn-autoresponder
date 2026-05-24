# Noco Operations Runbook

Short reference for ongoing migration and data-quality work.

## Relation Health

Primary command:

```bash
npm run noco:relations:dry-run
```

Read:

- `summary.json` for counts.
- `unsafe.json` for remaining manual problems.
- `warnings.json` for non-fatal missing profile rows.

Apply only after reviewing the dry-run:

```bash
npm run noco:relations:apply
npm run noco:relations:dry-run
```

Relation review views are not created by default anymore. To deliberately recreate them:

```bash
NOCO_RELATIONS_CREATE_REVIEW_VIEWS=true npm run noco:relations:apply
```

## Generated Relation Views

The generated views named `Relations - ...` are UI noise now that status fields exist.

```bash
npm run noco:remove-relation-views:dry-run
npm run noco:remove-relation-views:apply
```

This deletes views only. It does not delete records or columns.

## Confirmed Client Identity Overrides

Use `noco/core/client-ref-overrides.ts` for confirmed aliases such as short migration refs that should point to canonical `clients.client_ref` values.

Pattern:

1. Confirm identity with user.
2. Add mapping to `CLIENT_REF_OVERRIDES`.
3. Rerun `npm run noco:relations:dry-run`.
4. If `recordPatches` look right, apply.

Do not add guesses here.

## Current Manual Data Buckets

- `data_collection_statuses` name-only rows are real clients from migration. Keep them and mark as requiring clarification until matched.
- Missing Dolphin profiles are warnings. Some clients legitimately have no profile.
- Unlinked Dolphin main rows need profile-id investigation, not deletion.

## Safe Cleanup Rule

For schema cleanup, use:

```bash
npm run noco:cleanup-audit:dry-run
```

Only delete columns that the audit marks as deterministic `drop_candidate` and that the job explicitly supports in apply mode.

## Full API Backup

Before destructive schema work, run:

```bash
npm run noco:full-backup:apply
```

The job is read-only. It writes table metadata, visible records, checksums, and best-effort permission/settings/hooks metadata to `logs/nocodb-full-backup/<timestamp>/`.
