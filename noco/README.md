# Noco Migration Jobs

This folder contains NocoDB migration, repair, audit, and data-query jobs.

Rules:

- Default mode is always dry-run.
- Apply mode must write reports before mutating data.
- Keep business logic in the job folder, not in `noco/core`.
- Reuse `noco/core` for NocoDB API calls, relation helpers, reports, and CLI parsing.
- Reuse `noco/integrations` for existing external services. Do not reimplement Dolphin or Google Sheets APIs here.
- Every new job should include a local README and a `--test` path with fixture-based tests.

Typical command shape:

```bash
npm run noco:<job>:dry-run
npm run noco:<job>:apply
npm run noco:<job>:test
```

## Current Operational Map

Use these notes before starting a Noco data pass. They keep the job state discoverable without rereading old chat history.

- Relation repair lives in `noco/relations`. It writes `relation_status`, `relation_confidence`, and `relation_notes`.
- Confirmed legacy `client_ref` aliases live in `noco/core/client-ref-overrides.ts`. Add user-confirmed identity merges there before rerunning relations.
- Generated relation review views are intentionally disabled by default. `noco:relations:apply` will not create `Relations - ...` views unless `NOCO_RELATIONS_CREATE_REVIEW_VIEWS=true`.
- To remove old generated relation views, run `npm run noco:remove-relation-views:dry-run` and then `npm run noco:remove-relation-views:apply`.
- Full read-only API backups live in `noco/full-backup`. Run `npm run noco:full-backup:apply` before destructive schema work when a current Noco state snapshot is needed.
- The 12 name-only rows in `data_collection_statuses` are real clients from migration and must not be deleted. They should stay marked `unsafe_needs_review` until manually matched.
- Missing Dolphin profile rows are warnings, not automatic errors. Some real clients have no profile yet.

## Token-Saving Workflow

1. Start with the relevant latest report:
   - `logs/nocodb-relations/latest.txt`
   - `logs/nocodb-cleanup-audit/latest.txt`
   - `logs/nocodb-remove-relation-review-views/latest.txt`
   - `logs/nocodb-full-backup/latest.txt`
2. Read `summary.json` first, then only the focused report file (`unsafe.json`, `warnings.json`, `manual-review.md`, etc.).
3. Prefer adding confirmed identity facts to `noco/core/client-ref-overrides.ts` instead of scattering one-off matching logic in jobs.
4. Keep apply jobs idempotent: dry-run, apply, dry-run again.
