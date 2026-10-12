# Stack catalog

Defines which existing student stacks a campaign targets and what their vacancy requirements mean.

New scope TODO: include canonical student market membership and route shared vacancies by stack + market before personal checks. Python/global -> authorized Python/En is confirmed; ambiguous membership needs review. The current CampaignScope described below is stack-only. See [MVP routing](../MVP_REUSE_PLAN.md#required-order).

Market now follows posting language (English -> Global; Russian -> Ru), independently of company configuration. Stack assessment interprets responsibilities against the DB stack description.

## Campaign scope

1. Read existing stacks and the canonical student-to-stack relation from the working database.
2. Keep only stacks with at least one distinct linked student in the campaign's student scope. With no explicit student subset, use all linked students; no status filter is implied.
3. Require a nonempty `stack_description` for each selected stack. Missing descriptions are configuration blockers. Never infer policies from labels or create stacks from vacancy text.
4. Save stack IDs, descriptions and membership counts in the campaign snapshot. Collect every supplied company before classifying vacancies against these stacks.

Zero-student stacks are excluded even when described. An empty scope produces an empty campaign without crawling or applying. A role can match several selected stacks; student-specific eligibility and history belong to `candidate_matching`.

## Database contract

Read-only live verification on 2026-09-27 through `loadCampaignScope` confirmed all three descriptions below in `unicorn_noco_copy`: Java ID 5 has 20 linked students, Python ID 2 has 27, FullStack ID 3 has 15, with no scope configuration issues. They are configured for shared classification; these counts do not establish student application readiness or completion of the new collection milestone. No DB values were changed during verification.

- Working database: `unicorn_noco_copy`.
- Table: `noco.stacks`; stable table ID: `msr3ihfj0kjue1t`.
- New field: `stack_description TEXT NULL`. NULL means unconfigured.
- Existing relationship: `noco.clients."01_stacks_id" → noco.stacks.id`, exposed as `rel_clients_primary_stack`. Runtime adapters must resolve physical names through the existing catalog.
- Java, ID `5` (updated in SQL 2026-09-28): middle/senior Java backend using Spring, or no required framework stated. Exclude AQA/SDET/test automation and explicit alternative-framework conflicts.
- Python, ID `2`: middle/senior Python backend; FastAPI or no required framework specified; exclude Django-heavy positions or roles requiring another framework instead of FastAPI. AI/ML may account for approximately 40% or less of responsibilities, while backend remains primary. Exclude ML/model-development/data-science-focused roles.
- FullStack, ID `3` (updated and read back in SQL 2026-09-28): senior Frontend/Fullstack/Product Engineer focused on JavaScript/TypeScript. Frontend-only roles qualify; backend work is not mandatory. For fullstack/product work, backend accounts for approximately 60% or less of responsibilities. Exclude clearly backend-only/predominantly backend work and AQA/SDET/test automation.
- The three SQL descriptions were updated together on 2026-09-28. Missing frameworks are allowed for otherwise suitable Java/Python development; normal developer tests are not AQA. Python excludes Django-heavy work and ML-focused titles. Unclear workload shares alone pass without review; clear violations still exclude. Technically matching higher-level roles may be collected but require explicit student CV/rule permission before applying. Descriptions remain DB data; other stacks stay unconfigured and no student assignments change. See the shared selection skill for global rules.

[001_stack_description.sql](migrations/001_stack_description.sql) adds the field and its SQL-client metadata, then seeds only Java. Python and FullStack descriptions were subsequently saved through the existing PostgreSQL client as explicitly authorized data updates, not additional migration seeds. Run migrations explicitly inside the existing `writeTransaction` wrapper after checking the database marker; never run migrations at feature startup. The migration validates the existing mapping, rejects conflicting definitions, and does not overwrite an edited Java description on repeat execution. The metadata uses the existing SQL-only extension mechanism; this does not synchronize a separate Noco UI schema.

## Current code and extension points

[index.ts](index.ts) exports `StackProfile`, `javaStack` and `validateStackProfiles(stacks) → string[]`. Profiles contain identity, permitted seniorities, role terms, technology groups (AND between groups, OR within each), and optional title exclusions. Validation returns configuration issues; it has no I/O. `databaseId` preserves the existing stack ID when a profile is normalized for classification.

[postgres.ts](postgres.ts) loads current descriptions and native student relationships in one read-only repeatable-read transaction. [campaign.ts](campaign.ts) builds and validates a fingerprinted `CampaignScope`, selects existing IDs, excludes zero-student stacks and reports missing descriptions. `scope --db-stacks 5 --out scope.json` saves an independently consumable snapshot. `collect` loads the DB by default or consumes `--scope`; an empty scope never opens a browser.

Classification uses the database description directly with its injected semantic assessor. Profile identity is `stack-<databaseId>`; no description translation by hardcoded names is needed. Scoped collections cannot replace the saved stack list. Applications recheck current student membership and description via their restriction loader. The old structured `javaStack` is for offline analysis; it is not a substitute for DB membership.

Student-level eligibility belongs to [candidate matching](../candidate_matching/README.md): matching stack plus no applicable restrictions allows an application, without an additional CV-fit assessment.

Tests: `node --test src/features/external-responses/tests/pipeline.test.ts`. Shared SQL-column contracts: `node --test src/integrations/postgres/local-columns.test.mts`. Full pipeline: [feature README](../README.md).
