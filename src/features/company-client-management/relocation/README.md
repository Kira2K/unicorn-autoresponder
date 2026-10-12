# Business tables in the existing PostgreSQL source

The existing NocoDB PostgreSQL source uses schema `noco`. Migration `003_noco_business` moves the seven business tables and three views there, preserving the physical objects. Do not add another Noco source for this feature. `company_management` remains only an internal namespace for migration receipts, raw legacy evidence, import backups and trigger helpers.

## Contract

- `planBusinessRelocation(pool, database, nocoRole)` is read-only. It validates the marked database, previous migration checksums, target schema/role, object ownership, and collisions for tables, views, indexes and owned sequences. It returns a reviewed checksum tied to the database, SQL, role and object identities.
- `applyBusinessRelocation(pool, database, nocoRole, checksum)` takes the shared migration advisory lock, locks affected tables, rechecks the plan and moves objects in one transaction. There is no copy, import, drop or identity regeneration. It grants the explicitly provided Noco SQL role schema USAGE and SELECT on the business relations only. No new edit permissions or grants on backups are included.
- Full-row hashes, object OIDs, columns, constraints, triggers and sequence state must match before/after. Any mismatch rolls back. Counts, fingerprints, role and plan checksum are committed with the migration receipt in `company_management.schema_migrations.details`.
- A completed retry returns `already_applied`; a lost commit acknowledgment is reconciled with `relocate-plan`, never a blind repeat. Do not change already applied migration SQL files.

Inputs contain no credentials; the CLI uses the existing root ENV, pool and checked transaction helpers. The role is an explicit CLI input, not a hardcoded feature account. Normal reports contain counts and hashes, not company contacts or student data.

```powershell
npm run company:sql -- relocate-plan --noco-role <existing-Noco-SQL-role> --out logs/company-relocation-plan.json
npm run company:sql -- relocate-apply --noco-role <existing-Noco-SQL-role> --expect-checksum <plan-checksum> --out logs/company-relocation-result.json
```

Errors: `company_relocation_collision`, `company_relocation_role_missing`, `company_relocation_permission_denied`, `company_relocation_plan_changed`, `company_relocation_preservation_failed`, `company_relocation_receipt_mismatch`, `commit_uncertain`. Missing/tampered prerequisite migrations fail through the shared schema inspector. SQL plan/apply never modifies Noco metadata or ENV.

## NocoDB follow-through

Verify the exact user base and existing PostgreSQL source before any metadata operation. Keep its integration, source ID and `noco` configuration. Synchronize that source's metadata; Noco Cloud may require a signed-in UI session and reject API tokens. A pending UI sync is not verified table visibility.

The accidentally added `company_management` source may be removed as a **Noco registration only**, after verifying it has no user-created metadata and the SQL move succeeded. Never drop its schema or tables to remove a UI entry. Preserve the original PostgreSQL source and all its preexisting table IDs. Noco cleanup is separately reconciled from the SQL receipt.

Current business names: `companies` (all identities), `company_directory` (active source companies only), `sources`, `company_identifiers`, `vacancies`, `applications`, `client_company_events`. Migration 005 removes the replacement restriction table and both derived restriction/summary views; original `client_company_restrictions_from_stop_companies` and `clients.stop_list_company` remain shared and editable.

Tests: [../tests/relocation.test.mts](../tests/relocation.test.mts) exercises preservation, linked constraints, sequence continuation, read-only grants, rollback, collisions, idempotency, receipt recovery and old import commands after the move. [../../external-responses/tests/database-policy.test.ts](../../external-responses/tests/database-policy.test.ts) verifies the policy reader uses the new relations without changing logical rule IDs or losing legacy restrictions. Run `company:sql:test`, the database-policy tests and `typecheck` before deployment.
