# Source directory consolidation

This module imports a reviewed company/source snapshot into working PostgreSQL. It does not crawl sites, match company names, apply for jobs, assign people or deliver notifications.

## Contract

- `inspectDirectorySnapshot(snapshot)` validates explicit companies, typed sources, provenance, ID mappings and blocked LinkedIn URLs without I/O.
- `planDirectory(pool, database, snapshot)` reads the marked working database, verifies schema/ownership, checks mapped ID names, and returns a checksum tied to the input, DDL and current records. It writes nothing.
- `applyDirectory(pool, database, snapshot, checksum)` runs one transaction under the shared migration lock. It rejects stale plans, imports reviewed source values, verifies history did not change, and stores an immutable receipt plus pre-import records.

Input types are in [types.mts](types.mts). Dependencies come from the caller. The CLI creates the existing PostgreSQL pool from root `.env`; no alternate database or credential path is inferred. Credentials and source data stay outside feature code.

## Tables

`noco.companies` is the only employer identity table after migration 003. The added fields are `directory_status`, `import_key`, `comment`, `markets`, `tags`, `languages`, `aliases`, `contacts` and `application_route`. `contacts` stores type/value pairs. The `noco.company_directory` view filters `directory_status = active` and exposes derived `source_types` and `contact_types` arrays. `noco.sources` holds the separate source records. Historical migrations 001/002 first create these objects in `company_management`; migration 003 moves the same objects into the existing Noco source schema. Import commands support both recorded migration states.

Use `company_directory` or an explicit active filter as the collection input. An old identity needed by a restriction/application remains `legacy_reference`, with its ID and links intact. It is not a fresh company source. Explicit `existingId` mappings reuse IDs, but all directory attributes come from the reviewed input. There is no fuzzy matching or union of stale attributes.

`sources.company_id` links employer-specific URLs; general aggregators and Telegram resources have a null company ID. Source types are website, aggregator, tg-channel and linkedin. `enabled` describes eligibility as an input, not verified current website availability. Superseded URLs remain inactive provenance. LinkedIn URLs are always `blocked_linkedin`, including subdomains and lnkd.in.

`application_route = notify_only` is a data flag: include the company in a report section instead of automatically applying. No assignee, notification recipient, delivery queue, sender or notification-history logic is required or implemented. This module does not add runtime behavior for the flag.

The approved source rules are: merge comments A+I, tags F+J, preserve real hyperlink targets rather than the label Ссылка, keep contacts paired, normalize Remote to Global alone, and preserve original values/cells. Source rows and confirmed dialog corrections are recorded in provenance.

## Run

```powershell
npm run company:sql -- directory-plan --input storage/company-directory/input.json --out logs/company-directory/plan.json
npm run company:sql -- directory-apply --input storage/company-directory/input.json --expect-checksum <plan-checksum> --out logs/company-directory/result.json
```

The CLI never overwrites output files. Keep input/plan/receipt files private. The caller must explicitly authorize a live import; dry preflight alone does not authorize it.

All foreign keys, restrictions, applications and append-only events remain intact. The transaction verifies complete unchanged history records, not only counts. `directory_imports` stores the reviewed snapshot and original SQL rows for recovery. Source import errors roll back DDL and data together. On `commit_uncertain`, rerun `directory-plan` with the exact same input: the durable receipt distinguishes completion from failure. Never blindly rerun a changed input. A different import into an already populated directory requires a separate reconciliation design.

Errors include `invalid_directory_snapshot`, `source_company_missing`, `linkedin_source_must_be_blocked`, `directory_mapping_changed`, `directory_plan_changed`, `directory_permission_denied`, `directory_already_initialized`, `directory_history_changed` and `commit_uncertain`.

## Validation

SQL import completion does not imply NocoDB visibility. Verify the user's exact Noco base and its saved source's database/schema; do not rely on a legacy ENV base ID. Use the existing **PostgreSQL** source and `noco` schema, following [../relocation/README.md](../relocation/README.md); do not add a separate source. The Noco SQL role needs schema USAGE and explicit SELECT on the directory objects. Keep import receipts/backups outside the UI role's grants. Run Meta Sync on the existing source and confirm actual Noco table reads/counts before reporting the directory as visible. Noco Cloud can require a signed-in UI session for Meta Sync and reject API-token requests; record that pending step explicitly. Read grants do not authorize editing from the UI.

[../tests/directory.test.mts](../tests/directory.test.mts) covers source contracts, no-assignee notification flags, ID reuse, authoritative fields, legacy exclusion, preserved restrictions/events, rollback, stale mappings and lost-commit reconciliation. Run `npm run company:sql:test` and `npm run typecheck`. Live verification must compare the imported company/source rows with the reviewed input and verify the preserved history against the receipt.
