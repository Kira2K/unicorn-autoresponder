# External responses

Active model (2026-10-02): `gpt-6-sol`, defined in `infrastructure/sol-model.ts`. Classification uses medium reasoning; source investigation/engine repair uses high reasoning. Deterministic readers and checks still run first. Jev integration is deferred to the [implementation TODO](IMPLEMENTATION_TODO.md#deferred-jev-integration); its isolated prototype and historical evidence remain available, with no runtime fallback to Jev.

This model change does not launch work or renew exhausted budgets. New classification policies must bind the exact active model and retain explicit usage approval. Historical policies, reviews and outcomes keep their original model and hashes; do not rewrite them to resume under a different model. Provider availability must pass the existing preflight before live work; offline tests do not establish account access to the model.

Classification refactor (2026-09-30): bounded JSON batches, separate semantic/audit hashes, durable no-retry generation checkpoints and explicit review/unassessed reporting are implemented. See the [classification contract](stack_classification/README.md). The Codex adapter now verifies tool exclusion and JSON schema against a local mock endpoint before using the same restricted profile for Sol medium. Output-token limits are observed cancellation thresholds, not provider-enforced caps. No live model-quality/token-savings claim has been established. Engine development retains its existing tool-enabled runner; stopped budgets remain stopped.

Collection milestone: source-bound reusable engines and resumable Sol investigations. Use `scan --reasoner codex --concurrency 1 --max-pages 200 --source-timeout-seconds 900 --await-review` with explicit company/stack scope. The CLI emits request files when a public source needs investigation; a Codex Sol session supplies bound proposals and resumes the same run. Paid API calls remain disabled. See the [collection contract](vacancy_collection/README.md) and [engine contract](vacancy_collection/engines/README.md). No applications run during this flow.

Current milestone: [sequential tailored applications](application_workflow/README.md), with SQL eligibility, shared Dolphin ownership and Patchright. Live acceptance is in progress. The operator clarified that relevant additions are intended tailoring; the same airSlate PDF passed the revised campaign review. Identity, integrity, relevance and layout checks remain enforced. Collection and application stages remain independent.

Application reuse update: start with `application-status --input FILE` and the [resume runbook](application_workflow/RUNBOOK.md). Exact answer checkpoints, verified source form schemas and tailored artifact bindings persist through existing SQL state. Compatible resume skips redundant preparation; changed fields regenerate only their own answers. CAPTCHA continuation is bounded to one verified same-tab continuation with no prior application request. Uncertain outcomes remain protected. Fixture verification is not proof of universal CAPTCHA solving or measured weekly-token savings.

Standard collection now uses `scan`: exact company scope → validated source recipes/weekly reuse → one combined assessment per uncached posting → accepted-only SQL save → one Markdown report. `collect`, `classify` and `report-collection` remain independent. No applications or CV processing run inside `scan`.

Shared recovery v14: stale custom listing URLs can recover through observed same-origin career links; linked job cards remain listings; alternate repairs preserve earlier discoveries and unresolved coverage. Standard scans obtain daily public FX evidence and freeze it per run, with arithmetic and relevance-sensitive cache keys handled by code. See the collection/classification contracts for limits and fixtures. These mechanisms contain no company-name exceptions and do not make blocked or unknown sources successful automatically.

The isolated `guarded-benchmark` command keeps plain preflight as the default and exposes an explicit guarded `--execute` browser path with local checkpoints/reports and no production writes. See the [benchmark contract](benchmark/README.md).

```powershell
npm run external:responses -- scan --company-ids 100,101,102,103,104 --db-stacks 2,3,5 --browser-driver patchright --run example-scan
# Same command and flags plus --resume recover that run. A new --run with --force-refresh bypasses weekly reuse.
npm run external:responses -- scan-report --runs example-scan,another-scan --out logs/external-responses/comparison.md
```

Require explicit IDs or `--all-companies`. Optional `--students` narrows existing stack membership. Unsupported companies stay in scope. A shared collection lock and at most three workers include bounded recipe repair. Complete compatible searches younger than seven days reuse original observations; `--force-refresh` fetches again. Pending access reviews require resolution or explicit `--retry-reviews`.

The existing `noco.sources` stores `collection_recipe`, `collection_state`, `last_search_attempt_at`, and `last_complete_search_at`. `collection_runs` stores actions, observations and classifications; accepted descriptions/stack links remain in `vacancies`/`vacancy_stacks`. No new business table or Noco source is needed. [Collection contract](vacancy_collection/README.md) describes migration, replay and recovery.

Classification defaults to `--classification cached`: valid prior decisions can save vacancies; new/changed postings remain explicitly pending. Paid calls require `--classification api --inference-policy FILE`, configured provider/model, and an approved versioned policy. [Classification contract](stack_classification/README.md) defines exact reuse and approval fields. `--seed-run ID` can import matching reviewed decisions without relabelling them API-generated. No policy is implicitly approved by launching a scan.

For an authorized dialog/human review, launch with `--await-review`, inspect the saved collection, then resume the same flags/run with `--resume --assessments FILE`. This avoids a second crawl and preserves explicit review provenance. Publication-age labels are now separate observation metadata; “Posted 2 Days Ago” becoming “Posted 3 Days Ago” cannot invalidate otherwise identical shared decisions.

Edit global vacancy rules in [vacancy-selection/SKILL.md](../../../.agents/skills/vacancy-selection/SKILL.md). The classifier reads it automatically before stack matching and canonical persistence. Stack-specific requirements still come from `noco.stacks.stack_description`. See [where to edit rules](stack_classification/README.md#where-to-edit-selection-rules).

Collection update 2026-09-28: website workers are capped at three, with a shared lock across collection CLIs. Description language sets vacancy market: English -> Global, Russian -> Ru, ambiguous -> unknown. Listing access gates persist in a local human-review queue and SQL audit. Telegram destinations persist as “apply later”. Partial/inaccessible outcomes do not block complete accepted roles once every source is terminal. Description-quality metadata, aggregator adapters and multi-machine coordination remain TODO. The sequential application workflow now checks SQL student-market routing and this host’s shared HH/Dolphin ownership.

Live five-company verification saved one accepted Python vacancy from 25 captured postings into `unicorn_noco_copy.noco.vacancies` with its full description and stack link. Classification used explicit session-reviewed decisions because a standalone AI key/model was not configured; `--assessments FILE` preserves this provenance through normal classification/SQL guards. See [report](../../../outputs/live-collection-20260928/report/report.md). Higher-title applications now require explicit student CV/rule permission metadata. No applications were submitted in this test.

Historical verification before the publication-age fix: companies 100–104/stacks 2,3,5 completed three scans (forced, weekly reuse, forced recipe replay), with page reads 29 → 0 → 30. Seventeen unchanged postings incorrectly lost decision reuse because their standalone “Posted N Days Ago” labels aged. This is superseded: `date-fix-five-20260928` reused all 25 reviewed decisions with zero page reads, retaining the same one accepted vacancy. The [original comparison](../../../logs/external-responses/scans/verification-20260928.md) remains historical evidence.

Next-ten verification (`next-ten-20260928`, companies 105–114): 442 captured posting observations, 96 accepted postings, 324 excluded, 22 evidence-review outcomes; accepted stack memberships are Python 63, FullStack 18, Java 17. Decisions are explicitly `assistant_session`, with no paid classifier calls. SQL contains 97 vacancies including the previous one; all 28 applications remain unchanged. A read-only replay reused all 442 SQL decisions with identical accepted IDs. Coverage is still limited: one complete source, nine partial sources; only airSlate acquired a verified recipe. See the [detailed run and architecture report](../../../logs/external-responses/scans/next-ten-20260928/report.md). SQL source-memory columns are applied; NocoDB metadata visibility still requires UI verification after Meta Sync because API-token sync is rejected.

Use the documents below by purpose instead of loading every plan. Stage READMEs describe current interfaces; unchecked plan items are not implemented behavior.

| Document | Read it for |
|---|---|
| [IMPLEMENTATION_TODO.md](IMPLEMENTATION_TODO.md) | Current milestone, remaining work and acceptance checks |
| [SQL_PLAN.md](SQL_PLAN.md) | Proposed columns, relations and migration boundaries |
| [VACANCY_REUSE_PLAN.md](VACANCY_REUSE_PLAN.md) | Global versus student decisions, accepted-only persistence and token approval |
| [MVP_REUSE_PLAN.md](MVP_REUSE_PLAN.md) | Market routing, reuse, weekly refresh, closed vacancies and access review |
| [EFFICIENCY_PLAN.md](EFFICIENCY_PLAN.md) | Complexity, caching, bounded work and proposed AI optimizations |
| [OBSERVABILITY_PLAN.md](OBSERVABILITY_PLAN.md) | Event fields, metrics and report contracts |

`scan` writes one `logs/external-responses/scans/<run>/events.jsonl` diagnostic stream and one Markdown report. `--export` additionally writes JSON/CSV; recovery checkpoints remain internal. Reports distinguish fresh, replayed, reused, partial, pending and reviewed work. Standalone legacy actions retain their existing exports. No automatic campaign schedule is configured. Shared ownership with HH and other machines remains deferred.

Independent stages for shared vacancy collection, stack classification, student matching, preparation, applications and reporting. The feature reuses the repository's browser loader, CV extractor, AI transport/retries, and checked PostgreSQL persistence. CLI stages use canonical SQL sources/vacancies/policies/applications; CVs, browser profiles and diagnostic artifacts remain local. Offline fixtures and report exports use file state. Migrations and notifications never run implicitly.

## Pipeline stages and stack campaigns

```text
external-responses/
  candidate_intake/         Original CV, confirmed student facts and stackIds
  company_sources/         Source registry, format-specific processing and provenance
  vacancy_collection/       Entire company manifest; website/dialog/skill strategies
  stack_catalog/            Existing populated DB stacks and saved descriptions
  stack_classification/     Full vacancy list grouped by one or more stacks
  candidate_matching/       Student-specific eligibility and application history
  application_preparation/  Grounded answers, scoped test drafts and per-vacancy CV tailoring
  application_workflow/     Sequential SQL → Dolphin/Patchright → tailored application → report
  applications/             Collection gate, frozen targets, ATS adapters, submissions
  reporting/                Offline company coverage and application reports
  infrastructure/           Browser sessions, identity, persistence, AI transport
```

Campaign scope is **prepare registered company sources + existing DB stacks with at least one linked student → collect all companies → classify by those stacks → check each student's restrictions → prepare → apply**. [company_sources](company_sources/README.md) owns the heterogeneous registry in [sources.md](company_sources/sources.md). Its independent `sources` command turns an authenticated workbook snapshot into a normalized company manifest and separate review/deferred/blocked queues. Google Sheets, aggregators, Telegram and historical vacancy seeds require different processing; never send a source workbook to the employer-site crawler. `scope`/`collect` resolve stacks from the existing `stacks` table and students from `clients.rel_clients_primary_stack`, using metadata for physical SQL names. A stack inferred from a vacancy never creates a DB stack. Stacks without students are excluded. This rule adds no student-status filter. `--students` narrows membership to an explicit group; `--db-stacks` selects existing stack IDs. The saved collection embeds the stack descriptions and student IDs in an immutable campaign snapshot.

**Student eligibility rule: stack matches AND no applicable restriction ⇒ eligible to apply.** The explicit higher-title rule additionally requires narrowly documented permission from the student's CV/rules. Matching adds no CV score or inherited standalone preferences. Missing/unreadable restrictions and unresolved applicability require review. Duplicate prevention, immutable target limits, employer verification, required answers and confirmation remain submission safeguards.

Restrictions are stored policy data interpreted against the actual vacancy and relevant student facts. They must **not** be company/city strings or keyword branches hardcoded in feature code. A future rule such as “apply only to positions in Paris” requires considering the role's work location and remote terms; a Paris office mentioned elsewhere does not satisfy it. Keep the original rule ID/text, source, decision, explanation and evidence. New rule types plug into `RestrictionPolicy`; adding one must not require editing the application loop. The evaluator currently accepts contextual text rules; personal rules reuse `noco.client_company_restrictions_from_stop_companies`, its native links and `noco.clients.stop_list_company`; no new policy table is needed. Global vacancy-selection rules belong in `.agents/skills/vacancy-selection/SKILL.md`. Contextual interpretation is external-only for now.

Each stage has an independent function and consumes explicit inputs, saved JSON or a persisted SQL run. Collection never filters against one student's CV. It awaits all companies and follows their listings within the configured bounds; the raw snapshot can retain other roles for audit, but classification targets only the existing, populated stacks in the campaign snapshot. Reaching an application target count never stops collection. One company may supply roles for several selected stacks, and a vacancy can belong to multiple selected stack groups. If there are no stacks with students, report an empty campaign and do not start collection or applications.

Current runtime: the public `applyToPositions` and CLI `prepare`/`apply` require a classified collection and `stackId`, exactly one valid terminal audit per source, configured stacks and explicit student membership. Partial/inaccessible outcomes remain visible gaps; missing/ambiguous source outcomes still block. Complete accepted roles from partially inspected sources may qualify. Telegram-only roles stay saved for their later executor and cannot enter the web application stage. Collection is a time-stamped snapshot; availability is rechecked before submitting.

Selected vacancies must belong to the stack's matched list and retain the collected employer, title, description and application URLs. Collection digest, stack, targets and limit are frozen in saved application batches. Resume cannot substitute another collection or stack. Previously saved history remains readable; old application inputs now need the complete classified collection and explicit student stack before continuing. `applications/execute.ts` is the internal ATS workflow, not a public pipeline entry point.

```powershell
npm run external:responses -- scope --db-stacks 5 --out scope.json
npm run external:responses -- sources --out source-audit.json
npm run external:responses -- collect --scope scope.json --strategy websites --run all-companies --out collected.json
npm run external:responses -- classify --collection-run all-companies --out classified.json
npm run external:responses -- report-collection --input classified.json --out logs/external-responses/collection-report
npm run external:responses -- match --candidate student-id --student DATABASE_STUDENT_ID --collection classified.json --stack stack-5 --out matches.json
# Select an explicit subset from matches.json into selected.json; do not replace failed targets.
npm run external:responses -- prepare --candidate student-id --student DATABASE_STUDENT_ID --collection classified.json --stack stack-5 --batch java-batch --limit 2 --input selected.json
npm run external:responses -- apply --candidate student-id --student DATABASE_STUDENT_ID --collection classified.json --stack stack-5 --batch java-batch --limit 2 --input selected.json --live --resume
```

Database campaigns classify directly against each stored `stack_description` through the injected semantic assessor. No name-to-framework mapping or Java-specific description parser is used. Missing descriptions block the selected campaign; an unavailable assessor leaves vacancies for review. An explicit `--db-stacks 5` currently enables the described Java cohort without inventing policies for other stacks. `classify --stacks java|catalog.json` remains an offline structured-policy interface and cannot override a database campaign snapshot.

The database `stacks.stack_description` field stores the human-readable search requirements for that existing stack. Java (ID `5`), Python (ID `2`) and FullStack (ID `3`) have confirmed descriptions; see the [stack catalog](stack_catalog/README.md#database-contract) for their scope. Python excludes Django-heavy roles and limits AI/ML work to approximately 40%; FullStack requires a JavaScript/TypeScript focus and approximately no more than 60% backend work. Other descriptions remain unconfigured. A populated stack with a missing description is a configuration blocker, never a policy inferred from its name. A described stack with no students remains outside campaign scope. Individual requirements affect eligibility only when represented as explicit restrictions.

Start with the relevant stage document to avoid reading the whole feature: [intake](candidate_intake/README.md), [company sources](company_sources/README.md), [collection](vacancy_collection/README.md), [stack catalog](stack_catalog/README.md), [classification](stack_classification/README.md), [student eligibility](candidate_matching/README.md), [preparation](application_preparation/README.md), [applications](applications/README.md), [reports](reporting/README.md), [infrastructure](infrastructure/README.md).

Runtime DB wiring is implemented. Save `databaseClientId` during intake or provide `--student` for the run; database membership overrides a local `stackIds` label for database campaigns. Matching loads current restrictions, and applications recheck membership, description and restrictions before opening/filling/submitting. After migration 005, restrictions come from the original restrictions table, native company links, student stop-list field and existing global HH list; no copied policy table or view is used. `--market en|ru` scopes them (default `en`). Collection, classification and application checkpoints write through injected PostgreSQL adapters; matching remains read-only. `--offline` permits supplied catalogs/restriction snapshots for analysis and fixtures, but cannot submit live applications. The application workflow now loads SQL student market/stack/profile routing and tailors a local original CV per vacancy. Google Drive CV retrieval, full database candidate loading and Telegram collection remain separate adapter work.

LinkedIn navigation is forbidden in every stage, including subdomains and `lnkd.in` redirects. Browser sessions and collection/application URL guards enforce the restriction. The same rule is in the project job-hunting skill.

### Optional Patchright runtime

`collect`, `discover`, `prepare` and `apply` accept `--browser-driver playwright|patchright`. Playwright remains the default. Patchright is pinned in the package lock; install its supported browser with `npx patchright install chromium`. The selected driver never silently falls back. The first Patchright use backs up an existing idle candidate profile under `browser-backups`; a session lease prevents overlapping feature browsers. A stale lease requires checking its recorded PID before removing that one lock file. Do not launch another browser against the profile while this session is active.

Runtime diagnostics record the driver/package version, browser version and session ID. Screenshots, network markers and structured events work without browser console events. Patchright does not guarantee acceptance by an employer's spam checks; human verification and uncertain-outcome reconciliation still apply.

Run browser fixtures against Patchright with `EXTERNAL_RESPONSES_TEST_DRIVER=patchright` in the process environment, then `npm run external:responses:test`. Fixtures intercept network requests and never apply to real jobs.

Company manifests may include `workbook: {fileId,fileName,sheet,row,companyCell,careerCell}` on each source. These physical workbook references survive discovery, application state and Markdown/JSON/CSV reporting. `excludedHosts` prevents browsing listed hosts during website discovery; LinkedIn is always excluded. Browser-host exclusions do not remove a company's official linked ATS from coverage.

Optional source `listingUrls` seeds verified official listings while retaining the original careers URL and workbook reference. Website discovery saves each completed company's audit and raw positions under `logs/external-responses/<candidate>/discovery/<run>/sources`. Malformed vacancy records are reported as partial coverage and skipped without discarding valid postings from that source. Completed source snapshots can be read independently if a later source or final normalization fails.

The separate `patchright-verification-20260924` scenario uses all 41 companies from `companies_careers.xlsx`, sheet `Companies`, cells `A2:B42`. After four eligible targets and their required answers are established, freeze them with `--limit 4`, excluding the previous selected/submitted roles. Never replace failed targets. Batch acceptance requires captured confirmation for all four; candidate-reported outcomes remain separately identified. A discovery/preparation shortfall is not a passed live test.

## Commands

```powershell
npm run external:responses -- intake --candidate student-id --input intake.json
npm run external:responses -- discover --candidate student-id --strategy websites --input websites.json --run company-audit --out discovery.json
npm run external:responses -- discover --candidate student-id --strategy job-hunting --input boards.json --run skill-audit --out skill-discovery.json
npm run external:responses -- apply --candidate student-id --collection classified.json --stack stack-5 --student DATABASE_STUDENT_ID --batch company-test --limit 2 --input selected.json --dry-run
npm run external:responses -- report --candidate student-id --discovery discovery.json --batch company-test
npm run external:responses -- apply --candidate student-id --collection classified.json --stack stack-5 --student DATABASE_STUDENT_ID --batch company-test --limit 2 --input selected.json --live --resume
npm run external:responses -- report --candidate student-id --batch company-test
```

`intake.json`: `cvPath`, `confirmed` (named factual answers), `criteria` (`titles`, optional `excludedTitles`, `seniorOnly`, `skills`, `authorizedCountries`, `languages`, `maxBackendPercent`, `notes`), optional `history`, and `databaseClientId` for the existing student. Never check candidate data into Git. The original PDF is stored under its SHA-256 hash and verified again before uploading.

`websites.json`: `sources: [{name,url,provenance}]` or `sourcesPath` to TXT/MD/CSV/JSON or a directory of normalized employer sources; optional `maxPages` (default 16 per source). The heterogeneous `company_sources/sources.md` registry must first pass through source-specific preparation, not the generic URL-list reader. A Drive workbook is read by the dialog's Drive connector and normalized by the company-source stage, preserving file/sheet/row/cells and actual hyperlinks. Native Sheets and Office files need different readers; do not convert the source just to read it. Discovery checks actual linked listings and job descriptions. Pagination/dynamic limits and access failures are reported as partial coverage.

`boards.json`: `skillPath`, optional Python executable `python`, and a bounded `boards: [{ats:"ashby"|"greenhouse"|"lever",org:"board-token"}]`. For shared `collect`, also supply `sources` mapping every board URL via `url` or `listingUrls` to the company manifest. This adapter imports the installed skill's `sweep_boards.py` fetch function. It does not refresh or mutate skill datasets. Python 3 is required; the skill is not installed automatically.

`selected.json`: `positions` explicitly selected from matching within `--limit`, plus optional `confirmed` answers. Public applications recompute student restriction eligibility; editing `fit.decision` cannot bypass it. Form answers can be provided as `confirmed["answer:Exact field label"]`. Missing factual answers pause only that application. Optional demographics and marketing permissions stay unanswered.

`discover` is retained as the legacy candidate-specific search interface. Stack campaigns use `collect` → `classify` → `match`; a legacy discovery result alone cannot satisfy the application-stage collection gate. Preparation and application targets come from the saved matching result for the chosen stack.

Historical batches may retain `reviewOverride` for audit. It cannot bypass current student restrictions, database membership, stack classification, history, target limits, employer verification or availability.

Run-specific `preparedAnswers` may map exact field keys/labels to `{value,evidence:[...]}`. This supports reviewed drafts and delegated routine choices while keeping their provenance distinct from confirmed candidate facts. It does not change candidate profile state. Prepared values require evidence and must match enumerated field options.

When the candidate explicitly requests a retry despite an employer AI restriction, input may provide `employerAiExceptions[positionId] = {reason, ownWordsFieldKey}`. This narrow exception requires an inspected declaration containing “only my own words” and AI/generated-content wording, with its prepared answer set to `No`. It is saved for the same immutable target and reported separately; default policy, duplicate checks, availability checks and verification gates remain enforced. Changing the skill alone does not configure an exception. An employer can still disqualify this disclosed AI-assisted application; receipt capture measures submission only.

AI settings: `OPENAI_EXTERNAL_RESPONSES_API_KEY` and `OPENAI_EXTERNAL_RESPONSES_MODEL`, falling back to existing HH/LinkedIn profile settings. `--no-ai` intake preserves the PDF and records only supplied confirmed facts, explicitly skipping extraction; discovery and applications can also run without generation. It never turns unknown fit into eligibility. Applications require `--dry-run` or `--live` explicitly. Dry run does not fill, upload, or submit.

## State, evidence, and resuming

State/profile defaults to `storage/external-responses`; logs/evidence/reports to `logs/external-responses`. Override with `--storage`/`--logs`. Import past applications using history entries with URL, company, title, status, and optional `confirmation: captured|operator_reported`; keep requested skips as `skipped`.

Batch IDs bind an immutable target list and limit. A failed target does not authorize a replacement. Successful and uncertain submissions block duplicates across batches. A durable `submitting` record is written before the submit click. If receipt persistence fails after sending, the persisted intent remains uncertain and resume only reconciles it.

CAPTCHA, email verification, and missing answers queue human handoffs. Live CLI keeps Chromium open; finish the affected tab, update confirmed answers in the input if needed, then type `resume` in the same process. Type `exit` to close and retain checkpoints. `--close` opts out of the interactive hold. Persistent browser storage does not preserve DOM form state after the browser exits; resume may require refilling, but never blindly retries uncertain submissions. Required email codes must be entered in the browser, not logged in an input file. No CAPTCHA bypass, solver, fingerprint spoofing, or proxy switching is implemented.

If a crashed process leaves `application.lock`, inspect its recorded PID and confirm that process has exited before manually removing that one lock file. Locks are never expired automatically while a submission may be running. Do not start another CLI against a profile whose handoff browser is still open.

Reports include Markdown, CSV, JSON, failures and robot rejections. They work without AI/browser configuration. Statuses distinguish prepared, succeeded, blocked, failed, unknown, and skipped; screenshots and sanitized response markers support captured outcomes. Human assistance and operator-reported success are separate facts. Reports remain local unless separately sent by the operator.

Application results and batch acceptance appear before the source audit and vacancy decisions. Failure exports include attempt, timing, evidence, and next action; robot exports retain the rejected attempt and its eventual final status. Detailed form errors go to redacted diagnostic events; manager reports show the short error reason. CSV explicitly identifies human assistance.

## Verification

`npm run external:responses:test` runs mocked contracts and isolated Playwright fixtures. Browser fixture requests are intercepted: CI never sends real applications. Run `npm run typecheck` separately.

Historical live acceptance scenarios included two batches of two targets: skill discovery, then the first 20 companies from the corrected `companies_careers.xlsx`. Their saved evidence remains historical, not proof of the current collection milestone. Each batch required two confirmed successes; blocked/unknown outcomes and human assistance remain explicit. Do not launch new applications from this documentation.

`--manual-submit` prepares and verifies the live form, saves durable submission intent, then hands the Submit click to the candidate. Use this for a human retry after a definite robot rejection. It never changes the frozen targets or automatically retries uncertain submissions. An interactive terminal (or PTY) is required to keep tabs open; closed stdin ends the session. Employer per-company application cooldowns are checked against imported and current history before upload.

Verification handoffs are an injected `VerificationHandler` port: a future extension integration can implement it without changing the application workflow. V1 uses human verification. Prior attempt outcomes remain in saved state even if a later human attempt succeeds.

Checkbox group answers accept one exact option or a JSON array of exact options. Newly revealed required fields must be answered and verified before submission. Live opening retries are limited to two attempts; the submit click is never part of that retry loop.

## TODO

- Fetch the student's final CV from their Google Drive folder.
- Telegram discovery through `tg-responses`.
- Multi-machine Dolphin ownership coordination. This host now reuses the configured student En profile/proxy through shared helpers; it never replaces the proxy.
- Remaining SQL campaign/checkpoint/reuse state from [SQL_PLAN.md](SQL_PLAN.md), and a student dashboard based on confirmed applications. Canonical vacancy, classification and application persistence already exist.

Application adapters are deliberately limited to Ashby, Greenhouse, Lever, and Recruitee. Other ATSs, unusual widgets, and employer AI prohibitions require a handoff. Public website coverage is bounded and reported, not claimed exhaustive when controls or access prevent full inspection.
