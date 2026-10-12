# Workflow tables in the existing NocoDB source

Migration `006_noco_workflow` moves the existing `collection_runs`, `vacancy_stacks` and `application_batches` tables from `company_management` into `noco`. They are ordinary PostgreSQL tables belonging to external responses and must be visible alongside companies, vacancies and applications in NocoDB's existing **PostgreSQL** source. Do not create another data source or require a separate SQL client for feature inspection.

`planWorkflowRelocation(pool,database)` is read-only and returns checked DDL, a checksum, full-row backup, row/structure fingerprints and counts. `applyWorkflowRelocation(pool,database,checksum)` rechecks the plan under migration and table locks, moves the same physical tables, compares every row and structural identity, grants the existing Noco role SELECT access, and commits the migration receipt atomically. Target table/index collisions, changed source state, missing mappings, failed preservation or SQL errors abort the transaction. Uncertain COMMIT acknowledgement requires reading the receipt before retrying.

```powershell
npm run company:sql -- workflow-plan --out .tmp/workflow-backup.json
npm run company:sql -- workflow-apply --expect-checksum HASH --out .tmp/workflow-result.json
```

The backup contains private workflow data; keep it out of version control. The existing Noco SQL role is taken from the earlier source-relocation receipt, never guessed. The migration retains existing write privileges and adds only the read access required for inspection. The old migration files and checksums are unchanged. Only migration receipts/import backups remain in `company_management`.

Runtime collection, classification and application adapters use the `noco` names after deployment. The stages and their independently callable interfaces are unchanged. Run existing offline pipeline tests before live deployment; pause active workers during the brief move. Nothing submits applications as part of migration verification.

After SQL deployment, refresh the existing PostgreSQL source through **Meta Sync → Reload → Sync Now**. Verify the three Noco table IDs and record access before declaring UI visibility complete. An API token may be disallowed for Meta Sync; that requires the signed-in NocoDB UI, not another database client.

Tests: `tests/workflow-relocation.test.mts`, the historical relocation/schema contracts and external `postgres-pipeline`, `accepted-vacancies`, `incremental-collection` suites. They exercise actual PGlite SQL moves, nonempty rows, foreign keys, JSON preservation, rollback, collisions, stale plans, idempotency and lost commit acknowledgement.
