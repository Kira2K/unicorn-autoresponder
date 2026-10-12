# External responses: proposed SQL schema

> Historical proposals below are not an instruction to migrate all fields. Repeatable collection now adds only four columns to existing `noco.sources`; [the collection contract](vacancy_collection/README.md#sql-source-memory-and-replay) is authoritative. No additional business tables or Noco sources are required for this change.

Planning only. The following additions have not been migrated. Read with [implementation TODO](IMPLEMENTATION_TODO.md) and [observability plan](OBSERVABILITY_PLAN.md).

Description reuse and the global/local decision boundary are specified in [VACANCY_REUSE_PLAN.md](VACANCY_REUSE_PLAN.md). These add fields to existing tables, not another vacancy directory.

[EFFICIENCY_PLAN.md](EFFICIENCY_PLAN.md) specifies indexed reuse, bounded observation chunks, bulk reads/writes and a versioned changed-application persistence contract. It adds no business tables. Schema/query changes remain proposed until migration and contract verification.

[MVP_REUSE_PLAN.md](MVP_REUSE_PLAN.md) adds stack/market routing, weekly real-search timestamps and logical vacancy retirement. These remain explicit migration/adapter TODOs; no live schema has been changed by the planning updates.

Use the existing unicorn_noco_copy database and existing PostgreSQL source in NocoDB. All feature business and workflow tables stay in noco under the existing PostgreSQL source. Only migration receipts and import backups remain in company_management. Migration 006 moves the existing collection_runs, vacancy_stacks and application_batches tables without copying their records.

Two new tables are proposed: noco.client_application_answers and noco.collection_source_runs. Existing students, contacts, CV processing, profiles, companies, vacancies, restrictions, applications and batch state remain authoritative.

## Relationship diagram

NEW denotes a proposed table. Existing tables may gain fields described below. Edges represent foreign keys; scope/answer/document snapshots inside JSON are separately validated references.

~~~mermaid
erDiagram
    stacks ||--o{ clients : primary_stack
    clients ||--o{ cv_processing : existing_CV_relation
    clients ||--o{ platform_accounts : existing_contacts
    clients ||--o{ dolphin_profiles : existing_browser_binding
    clients ||--o{ client_application_answers_NEW : reusable_answers
    companies o|--o{ client_application_answers_NEW : optional_company_scope
    vacancies o|--o{ client_application_answers_NEW : optional_vacancy_scope

    companies o|--o{ sources : optional_owner
    companies ||--o{ vacancies : employer
    legacy_company_references }o--o{ existing_restrictions : native_links
    clients ||--o{ existing_restrictions : existing_student_link

    collection_runs ||--o{ collection_source_runs_NEW : scan_targets
    sources o|--o{ collection_source_runs_NEW : source_or_missing_source
    companies o|--o{ collection_source_runs_NEW : company_or_general_source
    collection_runs ||--o{ vacancy_stacks : classification
    vacancies ||--o{ vacancy_stacks : vacancy
    stacks ||--o{ vacancy_stacks : existing_stack

    clients ||--o{ application_batches : owns
    collection_runs ||--o{ application_batches : frozen_collection
    stacks ||--o{ application_batches : selected_stack
    clients ||--o{ applications : applicant
    companies ||--o{ applications : employer
    vacancies o|--o{ applications : nullable_for_legacy
~~~

The run/stack foreign keys on application_batches are proposed additions. The diagram does not claim that JSON answer IDs, source observations, or batch target arrays already have database foreign keys.

## Type and integrity conventions

- Entity IDs: bigint, serialized as strings at JavaScript/JSON boundaries. Never truncate to unsafe JavaScript numbers.
- Run and batch IDs: text, matching existing public identifiers; validate their allowed format.
- Attempt/claim/owner tokens: uuid.
- Timestamps: timestamptz in UTC. Timezone formatting belongs in reports.
- Statuses: text with explicit CHECK constraints, not arbitrary free text.
- Flexible evidence/context: jsonb with documented schema_version and structural checks.
- Existing collection/classification/batch snapshots remain json to preserve compatibility with their existing byte-order-sensitive hashing. New fingerprint algorithms must be versioned and deterministic.
- Foreign keys use ON DELETE RESTRICT for evidence/history-bearing records.
- SQL NULL means absent; JSON null must not masquerade as a usable answer or valid snapshot.
- Use NOT NULL alongside CHECK where required. Use foreign keys/uniqueness for cross-row integrity; validate snapshot membership under transaction locks rather than embedding cross-table reads in CHECK.

PostgreSQL CHECK does not reject a null result, and ordinary unique constraints treat nulls separately. The proposed generated scope key and partial indexes avoid relying on nullable uniqueness. See [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).

## Existing business tables to reuse

| Table | Relevant current fields/types | Use |
|---|---|---|
| noco.clients | id bigint PK; primary stack FK currently "01_stacks_id"; real_location text; desired_location text; google_folder text; existing identity fields | Existing student context and membership |
| noco.stacks | id bigint PK; name text; stack_description text NULL | Human-managed classification rules |
| noco."CV processing" | id bigint PK; clients_id bigint FK; status text; en_version_url text; ru_version_url text; student_data_folder_url text | Approved original CV reference |
| noco.platform_accounts | id bigint PK; clients_id bigint FK; account_label text; existing email/phone/login fields | Explicitly selected contact/account data |
| noco.dolphin_profiles | id bigint PK; client FK currently "02_clients_id"; locale text; dolphin_profile_id text | Existing En profile; ownership additions below |
| noco.companies | id bigint PK; name text; directory_status text; application_route text; comment text; markets/tags/languages text[]; contacts jsonb | Canonical employer directory |
| noco.sources | id bigint PK; company_id bigint NULL FK; name/type/url/disposition text; provenance jsonb | Source configuration and provenance, including general aggregators |
| noco.client_company_restrictions_from_stop_companies | Existing bigint student FK, market/text fields and native company links; also reuse clients.stop_list_company | Shared original restrictions; no new restriction tables |
| noco.vacancies | id bigint PK; company_id bigint FK; title/canonical_url/apply_url/platform/external_namespace/external_id/description/location text; availability text; last_checked_at timestamptz; sources jsonb | Shared vacancy identity and latest observations |
| noco.applications | id bigint PK; client_id/company_id bigint FK; vacancy_id bigint NULL; channel/status/stage/reason/confirmation fields; confirmed_at timestamptz; evidence/source jsonb | One durable student-vacancy application and current business outcome |

Physical table/column names must still resolve through the existing catalog where required. This planning table is not a reason to bypass metadata adapters.

Keep the composite applications(vacancy_id, company_id) foreign key to vacancies(id, company_id), and the existing unique student/vacancy index when vacancy_id is non-null. Legacy applications with no vacancy remain preserved and explicitly labelled.

Keep original restriction ownership and market scope. Read native links and contextual text through existing adapters. Global vacancy-selection rules belong in `.agents/skills/vacancy-selection/SKILL.md`; preserve the existing global HH company bans. An absent applicable rule set and an unreadable rule set are different runtime results.

## NEW: noco.client_application_answers

One row is one version of one reusable student answer in a defined scope. Existing canonical student/account columns remain elsewhere. This table supplies application-specific facts/stories/choices and unresolved questions.

| Column | SQL type | Null/default and meaning |
|---|---|---|
| id | bigint generated identity | PK |
| client_id | bigint | NOT NULL, FK clients(id) |
| question_key | text | NOT NULL, nonblank semantic key; includes relevant dimensions such as country or salary basis |
| question_text | text | NOT NULL, human-readable wording |
| scope | text | NOT NULL; global, company, vacancy |
| company_id | bigint | NULL for global; FK companies(id) |
| vacancy_id | bigint | NULL except vacancy scope |
| scope_key | text generated from scope/IDs | Non-null uniqueness key: global, company:<id>, vacancy:<id> |
| answer | jsonb | NULL while unanswered; typed value/object when usable |
| state | text | NOT NULL; needs_answer, needs_review, usable, revoked |
| provenance | jsonb | NOT NULL object; source kind/reference, evidence, reviewer where relevant; schema_version |
| version | integer | NOT NULL, positive, increases within client/question/scope |
| confirmed_at | timestamptz | NULL unless explicit candidate/operator confirmation exists |
| confirmed_by | text | NULL unless explicitly confirmed; operator/service identity, not credentials |
| valid_until | timestamptz | Optional expiry for changeable facts |
| superseded_at | timestamptz | NULL for current version |
| created_at | timestamptz | NOT NULL default now() |

Required constraints:

- Global: both company_id and vacancy_id are null.
- Company: company_id is present, vacancy_id is null.
- Vacancy: both are present; composite FK (vacancy_id, company_id) references vacancies(id, company_id).
- Usable answers require a non-SQL-null, non-JSON-null value and nonempty evidence/provenance. CV-supported facts retain that provenance; they must not be labelled candidate-confirmed without confirmation.
- confirmed_at and confirmed_by are either both present or both absent.
- valid_until, when present, is later than created_at. Expiry against the current clock is evaluated at read/preparation time.
- UNIQUE(client_id, question_key, scope_key, version).
- One current version: unique partial index on (client_id, question_key, scope_key) WHERE superseded_at IS NULL.
- Index unresolved current answers by client_id/state; ordinary FK indexes on company_id/vacancy_id as needed.

Answer updates supersede the current row and insert a new version atomically. Lock the client/question/scope key while allocating a version; two writers cannot create parallel current answers. Protect past answer content from in-place overwrites. Revocation creates a new current revoked version; submitted snapshots retain the original version.

The versioned write adapter handles answers from the CLI/dialog/future UI. Direct edits must not bypass versioning. Expose appropriate read/edit interfaces rather than treating immutable historical rows as editable spreadsheet cells.

Answer resolution: inspect the semantic question, then prefer an applicable vacancy answer over company over global. A revoked/ambiguous exact-scope answer requires review; do not silently fall back to a broad answer. The adapter checks units, dates, country and validity. Missing questions can be linked to affected batch targets through their saved requirements without a separate question-to-application table.

## NEW: noco.collection_source_runs

One row is one manifest target's processing checkpoint for one collection run. It does not duplicate source configuration: target_snapshot preserves what was selected at that time.

A source target has source_id. A company with no usable registered source receives a source-less row with company_id and an explicit unsupported outcome. A general aggregator can have source_id and no company_id.

| Column | SQL type | Null/default and meaning |
|---|---|---|
| run_id | text | NOT NULL, FK collection_runs(id) |
| target_key | text | NOT NULL; deterministic source:<id> or company:<id>:no_source |
| source_id | bigint | Nullable FK sources(id) |
| company_id | bigint | Nullable FK companies(id) |
| target_snapshot | jsonb | NOT NULL object: URL/type/disposition/route/provenance and expected adapter at scope freeze |
| status | text | NOT NULL default pending; see states below |
| inspection_mode | text | NOT NULL; live, reused, or review_pending; reused requires the original complete live scan; review_pending references an unresolved access gate without a new visit |
| attempt_count | integer | NOT NULL default 0, >= 0 |
| claim_token | uuid | Nullable current worker claim |
| worker_id | text | Nullable owner identity |
| started_at | timestamptz | Nullable |
| heartbeat_at | timestamptz | Nullable diagnostic liveness |
| finished_at | timestamptz | Present for terminal states |
| next_retry_at | timestamptz | Present for retry_wait |
| checkpoint | jsonb | NOT NULL default {}; visited pages, cursor, budget use, schema version |
| result | jsonb | NOT NULL default {}; durable normalized observations and coverage evidence |
| reason_code | text | Nullable stable diagnostic reason |
| error | jsonb | NOT NULL default {}; sanitized error metadata |
| updated_at | timestamptz | NOT NULL default now() |

Required constraints/indexes:

- PK(run_id, target_key).
- At least one of source_id/company_id must be present.
- When source_id is present, target_key is exactly source:<id>. Otherwise company_id is required and target_key is company:<id>:no_source.
- Unique partial (run_id, source_id) WHERE source_id IS NOT NULL.
- Unique partial (run_id, company_id) WHERE source_id IS NULL.
- Status CHECK: pending, running, retry_wait, complete, partial, inaccessible, unsupported, blocked.
- A running row requires claim_token and worker_id; terminal rows require finished_at; retry_wait requires next_retry_at.
- JSON columns must be objects; timestamps cannot run backwards.
- Index (run_id, status, next_retry_at); index source_id for source-history inspection.
- For weekly reuse, inspect/add an index on (source_id, status, finished_at DESC) for live scans; do not add a duplicate equivalent index. Reused rows cannot be the authoritative origin of a new seven-day clock.

Validate source ownership against the frozen manifest/current source binding in the adapter. Nullable company_id on a general source is allowed; never infer the employer from the aggregator name.

Claims/result writes use short transactions, the run's current lifecycle state, and the current claim token. A superseded worker cannot publish progress or results. Finalization locks the run, verifies the exact manifest target set and terminal outcomes, and prevents later result mutation.

Checkpoint/result updates must persist enough observations to finalize after a process restart. Large HTML, screenshots and diagnostic bodies live in artifact storage with hashes; their raw contents are not required to construct SQL source coverage. Avoid appending all prior bodies to a growing JSON checkpoint every page: use bounded immutable observation chunks through the durable artifact adapter, with SQL references and the latest full vacancy descriptions in SQL. Write/verify a chunk before committing its reference/progress; unreferenced chunks are recoverable orphans, not completed work. Missing referenced chunks must block replay explicitly. Freeze the full export once at collection completion.

V1 has one collection coordinator. A stale heartbeat does not alone authorize takeover while the old worker might still run. Recovery confirms the owner has stopped, then issues a new claim token. A closed run is immutable; a retry of its failed sources creates a new explicit collection version/run, retaining the old audit.

### Weekly source/company search status

Reuse started_at/finished_at/status on actual live source-run records as canonical search history. Expose a read projection with last_search_at (latest attempt), last_complete_search_at (latest compatible complete live scan), next_search_due_at (last complete + interval '168 hours'), and last_search_status. Use UTC for the seven-day elapsed-time rule. Unknown timestamps stay null/due; failed/partial scans never advance the complete-search clock. This projection can be exposed through the existing Noco PostgreSQL source; it is not another editable business table.

Reused source results retain original run/target/scope/adapter references and scan completion time. Validate that referenced rows are complete live scans for the same source/scope, within seven days; do not allow cycles or references to merely reused rows. Their own finished_at means the reuse task ended, not that the website was searched. A company aggregate retains every source outcome and the earliest due supported source rather than hiding gaps behind the newest successful URL.

## CHANGE: noco.collection_runs

Current columns: id text PK, collection json NOT NULL, checksum text NOT NULL, classification json NULL, created_at timestamptz.

| Proposed change | Type | Purpose |
|---|---|---|
| schema_version | integer NOT NULL | Snapshot/hash contract version; preserve legacy readers |
| status | text NOT NULL | collecting, collected, classifying, ready, cancelled, failed |
| scope | jsonb NOT NULL | Frozen cohort, stack descriptions, company/source manifest, settings and versions |
| collection | json NULL during collection | Final immutable collection only after the barrier closes |
| checksum | text NULL during collection | Hash of the final collection under its versioned serializer |
| classification | json NULL until complete | Final immutable classification |
| classification_checksum | text NULL until complete | Hash bound to the collection checksum and classifier configuration |
| collected_at | timestamptz NULL | Barrier closure time |
| classified_at | timestamptz NULL | Final classification time |
| updated_at | timestamptz NOT NULL | Progress metadata |
| failure | jsonb NOT NULL default {} | Coordinator/configuration failure; source failures remain individual outcomes |

Keep created_at and the existing primary key. Add index (status, created_at).

State rules:

- collecting permits mutable source checkpoints but has no finalized collection/checksum.
- collected requires collection/checksum/collected_at and all expected source targets terminal.
- classifying preserves the frozen collection; per-pair decisions accumulate in vacancy_stacks.
- ready requires a completed classification/checksum/time, recorded common-rule outcomes for every sufficiently described and covered vacancy, and decisions for every globally passed vacancy × selected stack pair. Global rejections/review remain in the audit without fabricated stack decisions.
- Valid reused source observations may support this barrier only under the weekly scope/freshness contract; preserve their original observation timestamps and coverage evidence.
- cancelled/failed never authorize new submissions; preserve any prior snapshots and already recorded application outcomes.
- A ready run with zero usable vacancies is a valid empty result and yields no batches/applications.

Cross-table completeness is checked transactionally against locked run/target/decision rows. It is not a CHECK with an unsafe SELECT. Protect scope and finalized snapshots against later mutation in the write boundary/database guards.

Backfill existing rows from their saved scope/classification. Do not invent missing legacy facts. If an old row cannot satisfy the new contract, keep it readable as legacy and disallow automatic live continuation until a reviewed import.

## CHANGE: noco.vacancy_stacks

Reuse the existing PK(run_id, vacancy_id, stack_id), FKs, decision text and evidence jsonb.

- Decisions remain matched, review, excluded.
- Store vacancy content hash, stack-description hash, model/prompt/version, reasons and cited text inside evidence.
- Save per-pair decisions during classification; freeze them when the parent run reaches ready.
- A pair lacking sufficient evidence becomes review; an unfinished pair remains unfinished.
- The final classification snapshot is a reproducible export/index of these decisions, not an independently editable second truth.
- Candidate matching consumes matched pairs only; a role matching several stacks remains one canonical vacancy.

Proposed reuse fields/indexes: nullable decision_key text for legacy rows, indexed for exact-input evidence retrieval; index (run_id, stack_id, decision, vacancy_id) for stack-group reads after checking for equivalent existing indexes. The decision key covers every actual semantic input and approved evaluator version. A combined multi-stack request includes all supplied stack/rule versions in its key. Reuse copies/references validated evidence into the new run's immutable decisions without mutating old decisions. Persist chunks with set-based statements rather than one query per pair.

## CHANGE: noco.application_batches

Reuse PK(client_id, id), state json and updated_at.

| Proposed typed column | Type | Purpose |
|---|---|---|
| collection_run_id | text | FK collection_runs(id); required for new batches |
| stack_id | bigint | FK stacks(id); required for new batches |
| created_at | timestamptz NOT NULL | Batch creation time |
| state_revision | bigint NOT NULL default 0 | Proposed versioned transition counter; update with the changed application |
| progress | jsonb NOT NULL default {} | Small validated operational checkpoint; no growing full records/body arrays |

Backfill typed references from existing state with validation. Legacy unreadable bindings stay legacy, not fabricated.

For the proposed v2 persistence contract, keep frozen targets, per-student target limit and collection binding in state JSON, written once. Store preparation versions, requirements, attempts and manual-handoff context with the owning canonical application's existing versioned source/evidence state; that application record is the single current owner. Keep progress small and use state_revision for guarded transitions. Avoid a second target array column that can diverge from the manifest. Legacy full-batch state remains readable through its versioned adapter; do not silently reinterpret old hashes.

The write adapter validates the typed references against JSON, current student binding, the frozen scope, stack decisions and source eligibility. Freeze identities/limit/collection binding. A transition updates only the affected application and small batch progress together. Reconstruct public BatchState/reports from the immutable manifest and application records; do not re-upsert every earlier application on each checkpoint. Preserve exact historical preparation content references and captured-success guards. This contract change requires dependent caller, legacy-reader and crash-recovery tests.

At selection, create every queued target record so reports can account for selected but unattempted work. For duplicate candidates, do not create a second owning batch or replace targets silently.

## CHANGE: noco.dolphin_profiles ownership fields

Keep the existing student/locale/provider-profile fields and extend that record:

| Column | Type | Meaning |
|---|---|---|
| automation_owner_token | uuid NULL | Unique live ownership token |
| automation_owner_kind | text NULL | hh-responses, hh-profile-filler, external-responses |
| automation_owner_run_id | text NULL | Feature run reference; intentionally polymorphic |
| automation_owner_host | text NULL | Worker host identifier |
| automation_acquired_at | timestamptz NULL | Ownership acquisition |
| automation_heartbeat_at | timestamptz NULL | Liveness for diagnostics; not permission to steal ownership |

All ownership fields are absent together, or the required owner fields are present together. Use owner-token comparisons when renewing or releasing.

The atomic exclusion key is the actual Dolphin provider profile ID. Audit duplicate/blank provider bindings before enabling the feature; require one canonical binding. Add normalized nonempty provider-ID uniqueness only after a reviewed data check establishes it can be enforced without deleting or silently merging existing rows.

Acquire the advisory lock and then claim the durable marker using compare-and-set. A residual marker blocks automatic reuse until reconciliation. Release only after owned browser work has stopped or been safely handed back; never clear someone else's token.

Profile tags/status remain human-visible indicators. They do not replace the shared ownership protocol. The heartbeat does not constitute a time-limited browser lease because a browser can outlive a disconnected worker.

## Existing vacancies and applications: contract corrections

No additional business table is required.

### Vacancy description persistence

Reuse noco.vacancies.description TEXT for accepted postings only. Keep headings/lists and material requirements; remove image/video/embed payloads, scripts and unrelated page chrome. Shared selection and at least one selected-stack match precede canonical insertion. Raw, excluded, review-only and missing-description observations remain audit/checkpoint data, including run JSON, without vacancy rows. Commit accepted bodies and matched links before student matching or CV preparation. Current saveCollection writes only the audit; saveClassification atomically promotes matches. This boundary requires no migration.

| Proposed column on vacancies | Type | Meaning |
|---|---|---|
| description_sha256 | text NULL for legacy/missing | SHA-256 of the normalized complete text |
| description_fetched_at | timestamptz NULL for legacy/missing | Time the body was actually acquired, distinct from availability checks |
| description_source_url | text NULL for legacy/missing | Verified HTTP(S) source of that body |
| description_extractor_version | text NULL for legacy/missing | Normalization/extraction contract version |
| description_status | text NOT NULL default missing | complete, partial, missing |

Complete requires nonblank text, a valid hash and acquisition/source/extractor metadata, backed by extraction coverage evidence. Legacy/missing metadata cannot be invented by migration. A complete source scan does not by itself prove every posting body was completely extracted. Conversely, a partial source scan may contain fully inspected vacancies that qualify: source status and vacancy observation quality are independent. Source failure must not invalidate a verified complete vacancy observation or imply closure of unseen jobs.

Persist the body/metadata and its observation/checkpoint atomically in a short transaction. Failed/partial refreshes must not replace the latest complete body; older delayed observations must not overwrite newer ones. Keep those observations in source/run results instead.

Global selection and local student matching reference the exact description hash in evidence. The current tailoring adapter receives this saved text as jobRequirements. Preserve old text versions in immutable run/source snapshots; a later update to the vacancy row must not change what a previous preparation/submission used.

An availability-only check updates its own check metadata, not description_fetched_at. A new content hash invalidates affected cached decisions/artifacts. Changed rules can be reevaluated against stored text without a new body fetch.

### Application destinations independent of discovery

Proposed extension to existing `noco.vacancies`, not a new table or an applied migration:

| Proposed column | Type | Meaning |
|---|---|---|
| application_routes | jsonb NOT NULL DEFAULT '[]' | Array of explicit destinations: channel (`web`, `telegram`, or another registered adapter), destination, source URL, supporting text and observed timestamp |

The JSONB shape needs contract validation and a database array-type check. Keep `canonical_url`/external identity as the posting identity; a Telegram recipient is a destination, never the identity shared by all their vacancies. Existing nullable `apply_url` remains a verified web-form convenience field. A Telegram-only vacancy has no invented web fallback. Update the currently mandatory runtime `Position.applyUrl` contract and its consumers before activating non-web routes.

An empty route array means not yet established, not permission to submit at the posting URL. Existing `apply_url` values need verified provenance before backfilling: the current collector sometimes substitutes the posting URL. Only an explicit application instruction establishes a Telegram destination; preserve alternative channels and evidence without navigating or messaging them.

Persist routes with the vacancy observation and snapshot them with their provenance. Changing a destination invalidates affected preparation; it must not create a new vacancy identity or erase history. `deferred_channel: telegram` is a derived catalog/report disposition while the TG executor is unavailable, not a new availability value or an `applications` row for every student. Later executors retain the existing unique student/vacancy constraint across channels. Telegram secrets/session credentials never belong in route metadata.

### File-based global vacancy rules

The user replaced the proposed SQL global-rule editor with one editable [.agents/skills/vacancy-selection/SKILL.md](../../../.agents/skills/vacancy-selection/SKILL.md). Do not add an evaluation-stage column or move these rules into a database table.

Implemented: `collection_runs.classification` already stores JSON, so it now contains the selected file's active text/path/SHA-256 and per-vacancy global decisions alongside stack decisions. SQL promotion requires this evidence. No migration is needed. Rules are authored in the file; SQL retains immutable run evidence only.

Existing student-context restrictions remain unchanged. Stack-specific role/framework/seniority descriptions remain in `stacks.stack_description`. No automatic reclassification of old restrictions occurs.

Approved token-policy reference/version/hash/approval provenance in run scope remains a separate planned contract; no extra approval table is required.

Version classification completeness accordingly: persist global outcomes separately from stack decisions in the audit. The audit covers each evaluated vacancy/stack pair; canonical vacancy_stacks rows contain only matched pairs for accepted vacancies, including qualifying observations from partial sources. Excluded/review outcomes remain in classification JSON without requiring vacancy or link rows. An all-rejected run inserts neither. Existing legacy links/history are retained.

Local evaluation verifies that the global decision/rule versions are still applicable, then evaluates student-match policies. It must not redundantly invoke global AI evaluation once per student for an unchanged vacancy/rule version.

### Company/source market routing and vacancy closure

Updated 2026-09-28: market follows vacancy description language (English -> Global, Russian -> Ru, ambiguous -> unknown). Current implementation stores this decision/evidence in existing vacancy source JSON and run snapshots; no new column/migration is required. Company market tags do not override it. Student cohort routing still needs canonical market membership binding with provenance.

Aggregator feed scope can guide discovery but cannot override description-language market. Implement adapter selection through explicit source configuration, preserving actual employer FKs/history. The aggregator adapter remains unimplemented and this plan does not retype existing rows.

Propose sources.access_review jsonb NOT NULL DEFAULT '{}' for current discovery-access review, with a validated schema: review key/version, pending/resolved/skipped state, reason, source/access context, originating run/target/evidence references, timestamps and explicit human resolution. Do not store credentials. Update with a short version-checked transaction; immutable source-run evidence is not edited by a resolution. The human-action queue is a projection of pending sources, not a new business/task table. Repeated runs reference an existing pending gate without resetting real-search times or pretending a new visit occurred.

Registration/authentication gates use existing inaccessible/partial terminal source status plus typed reason and review reference; they never become complete. A new run with an already pending review records inspection_mode=review_pending instead of live/reused, referencing original access evidence without network access. Such rows do not qualify as complete scans or advance last_search_at/last_complete_search_at. Add review_pending to the inspection-mode constraint and keep actual timestamp queries restricted to live records. CAPTCHA/robot errors remain distinct; confirmed closure is unrelated to blocked access.

Reuse availability open/closed/unknown and last_checked_at. Add closed_at timestamptz NULL and closure_evidence jsonb NOT NULL DEFAULT '{}'. New closed writes require time and verified posting-specific evidence; legacy unknown evidence is preserved without fabrication. Current active queries exclude closed rows, including joins against prior matched vacancy_stacks. Preserve immutable classifications rather than deleting historical membership rows.

Closure updates and pending-target transitions use short guarded transactions. Previously submitted records remain submitted; submitting/unknown records require reconciliation. No cascade delete, no removal of application history and no replacement of frozen target IDs. Observation ordering prevents an older live/reused open record from overwriting a newer closure. A separately verified reopening preserves the old application history and duplicate protection.

### Existing identity and outcome fields

- Keep canonical_url as an actual HTTP(S) posting URL. Store verified ATS identity in the existing external_namespace/external_id pair; include tenant/board context where IDs are only tenant-unique.
- Separate URL normalization from identity calculation in code. Audit any existing non-URL identity values before a migration; never manufacture a missing official URL.
- Preserve the existing canonical-URL and external-identity uniqueness rules, resolving conflicting evidence through review.
- Keep source IDs and all observed provenance in versioned observation JSON. A general source does not need the same company_id as its discovered vacancy.
- Store latest availability/check time in vacancies; retain historical content and classification in immutable run observations.
- Preserve UNIQUE(client_id, vacancy_id) for non-null vacancy IDs across channels.
- New submission states use the existing queued, preparing, needs_action, submitting, submitted, failed, unknown, skipped values.
- Keep recruitment_stage separate. A captured application receipt does not imply an interview.
- Keep confirmation_kind none, captured, candidate_reported. Human assistance is independently recorded; captured manual submission is still captured, but not fully automated.
- Protect submitted/captured outcomes from downgrade. Reject mismatched company/vacancy and missing-evidence submission writes.

## Preparation/attempt JSON contract in existing application records

Each application record should retain the following versioned state. In the proposed v2 persistence adapter, it lives with the owning application; the public batch export includes it by reference/join. Legacy batch-embedded state remains readable.

~~~text
application_id: bigint serialized as string
vacancy_id: bigint serialized as string
original_collection_ref: { run_id, collection_hash, classification_hash }
preparations[]:
  preparation_id: uuid
  context_hash: text
  cv_source: { drive_file_id, revision, sha256, cv_processing_id }
  submitted_cv: { artifact_uri, sha256, mime_type, template_version }
  posting_observation: { content_hash, observed_at, evidence_ref }
  facts_and_answer_versions: protected immutable snapshot/references
  policy_checks: { policy_ids_and_versions, decisions, evidence_refs }
  generation: { model, prompt_version, input_hash, output_hash }
attempts[]:
  attempt_id: uuid
  attempt_number: integer
  preparation_id: uuid
  intended_at: timestamptz
  submission_observed_at: timestamptz | null
  result: submitted | failed | needs_action | unknown
  reason_code: text | null
  confirmation_kind: none | captured | candidate_reported
  evidence_refs: array
  manual_assistance: boolean
  human_action: { type, recorded_at, actor_ref } | null
~~~

Capture actual rendered form answers as a protected snapshot as well as reusable answer-version references. References alone cannot reproduce what a field received if a renderer or source changed.

Application evidence/source JSON exposes the latest receipt and retains prior preparations/attempts with links to its run/batch. The immutable batch manifest identifies its target applications. Public reports omit protected answers and detailed personal data.

## Transactions and invariants

| Operation | Atomic boundary |
|---|---|
| Create run | Freeze scope and insert the exact source/missing-source target set together |
| Claim source | Validate collecting state, claim eligible target, update token/attempt in a short transaction |
| Save source page/result | Verify current claim and run state, persist observations/checkpoint atomically |
| Finalize collection | Lock run, compare expected/actual target identities and terminal states, freeze snapshot/hash |
| Finalize classification | Lock run, verify common-rule outcomes and every expected globally passed vacancy × selected stack pair, freeze classification/hash |
| Update answer | Lock semantic answer scope, supersede old current row, insert next version |
| Freeze batch | Validate eligibility/identity/limit, insert queued application records and batch state |
| Record intent/outcome | Verify ownership/binding/revision, update the changed canonical application with its attempt state and small batch progress together |
| Claim/release profile | Advisory exclusion plus short owner-token transaction; no long browsing transaction |

A lost commit acknowledgement is reconciled by stable run/batch/attempt/token identifiers. Do not blindly repeat external actions. Profile ownership and durable submission intent deliberately survive in records when transient diagnostic logs do not.

## Archives, UI and migration acceptance

- Keep companies_from_applications, applications_from_otkliki, legacy restriction/link tables and raw migration evidence read-only and preserved.
- Do not build new candidate loading on the archived resume_sheet_profiles table.
- Keep Noco's five current company/application business tables; add the answers table for its distinct purpose. Internal scan/run/ownership metadata should not clutter the manager's normal views.
- Do not create another Noco data source. Register new SQL mappings and sync the existing source after the explicit migration.
- Test null handling, partial unique indexes, composite FKs, version races, no-source targets, immutable snapshots, existing data preservation and access permissions before rollout.
- Restrict edits to internal checkpoints/ownership/attempt state to their adapters. User-managed stack descriptions and restrictions remain editable policy data with versioned snapshots at evaluation time.
