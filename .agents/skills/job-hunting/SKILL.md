---
name: job-hunting
description: Find companies, careers sources and vacancies, prepare applications or apply on someone's behalf — including "find companies", "find me vacancies", "apply for me", "submit these job links", or resuming a job search.
---

# Job Hunting

For this repository's student campaigns, operate two independent phases: **collect and save accepted vacancies across the selected stacks**, then **match students and apply using the existing rules and restrictions**. A search request stops at the saved pool/report; it never starts applications.

Use the SQL-backed workflow below by default for this project's companies/students. The standalone workflow is an explicit alternative, never an automatic fallback. Application authorization may cover both phases, but cannot remove their boundary or skip persistence.

## Navigation restriction

**Never open any LinkedIn pages.** This applies to every mode, browser, profile, worker and tool. Block `linkedin.com`, its subdomains and `lnkd.in`, including redirects. Find an official careers page/ATS or report the source as forbidden, even when LinkedIn is the only supplied channel.

## Choose the authorized mode

| Mode | Request examples | Actions in SQL campaigns |
|---|---|---|
| `search` | "find vacancies", "show me roles" | Collect the manifest, classify, persist accepted vacancies/stack links, then report. No application preparation, upload or submission. |
| `draft` | "prepare these applications" | Match saved classified vacancies against current restrictions; inspect selected forms and prepare answers without filling, uploading or submitting. |
| `apply` | "apply for me", "find roles and apply" | Complete shared collection/classification first if needed, then match, freeze targets, prepare and submit through the public application stage. |

If ambiguous, use search mode and clarify before uploading or submitting. Existing explicit authorization carries forward unless narrowed. No permission is needed per application inside the authorized scope. Record campaign scope/run and immutable application targets/limits through the workflow; `profile.md` is for standalone work only.

## Continue the authorized task

Treat fixes, skill updates and status questions as part of the active goal unless the user explicitly pauses, replaces or narrows it. After a necessary repair and focused checks, resume the pending authorized workflow in the same turn. Do not invent an implementation-only phase or require another "go" when applications are already authorized.

Passing tests, completing a subcommand, producing an intermediate report, a normal browser exit, a cache miss or an unsupported form is not itself a stopping condition. Resolve routine issues using existing data, approved answer rules and reusable engines; continue eligible work while one target is blocked. Cross stage boundaries by calling the next independently callable action, without requesting authorization already given.

Stop when the requested outcome or explicit maximum scope is reached, the user asks to stop, the approved usage guard requires it, or every remaining authorized action needs unavailable user input/access. A requested minimum is not a maximum. Inspections, duplicate skips and unsupported forms do not count as submitted applications. Preserve immutable targets, approved budgets, busy-profile protection and reconciliation of uncertain submissions. Report the concrete blocker when it actually prevents remaining work.

**Never interleave shared crawling with student applications.** Finish the collection phase, then work through the application queue and report in batches. Failed targets do not authorize replacements. Batch missing-fact questions; keep working on independent sources/students while affected work waits.

## Company hunting — before freezing the source manifest

Company hunting remains part of this skill. When asked to find new companies/career sources, read [sourcing.md](references/sourcing.md): use the shipped board lists, bounded public company discovery and official career/ATS verification. It requires no student CV and submits nothing. Return company name, official career/board URL, discovery provenance and verification/access result.

Source discovery may precede a new campaign; it must not silently add companies to an already frozen campaign. New verified sources need the existing company/source registry's reviewed import path before SQL collection can use them. Automatic discovery-to-SQL onboarding is still TODO. Stay within the user's source scope and preserve the LinkedIn and deferred-aggregator exclusions.

## Phase 1 — shared collection and SQL save

Read [global-selection.md](references/global-selection.md). Use public `external:responses` commands:

`scan --company-ids IDS --db-stacks IDS --run ID` composes collection, classification, accepted-only SQL save and one report. Explicit `--all-companies` is the alternative to IDs. `scope → collect → classify → report-collection` remains available for independently running stages.

- Only existing selected stacks with students participate. Load requirements from `noco.stacks.stack_description`; do not invent a policy from a stack name or create stacks from postings.
- Shared vacancy rules live only in [vacancy-selection/SKILL.md](../vacancy-selection/SKILL.md). Read that file; do not copy its rules into this skill, SQL columns or standalone profile filters.
- Evaluate all selected stacks against each saved description. No student CV, personal preferences or individual application history belongs in this shared decision.
- `collect` checkpoints observations and saves the run audit. `classify` persists only global passes matching at least one stack into `noco.vacancies`, with complete descriptions and provenance. Rejected/review-only findings stay in audit, not vacancy rows.
- Preserve multi-stack matches: one canonical vacancy, all accepted links in `noco.vacancy_stacks`. Decisions/evidence are in `noco.collection_runs.classification`. Do not copy vacancies per stack or reduce matches to one primary stack.
- Account for every company/source before moving to applications. Report failed, forbidden, unsupported and partial sources explicitly. This phase ends with the saved pool and source/selection report; it does not create application batches or fill forms.

The job-hunting board strategy is a discovery adapter. Python sweeps and JSON shortlists alone are not SQL saves. Use the current [stage contracts and CLI examples](../../../src/features/external-responses/README.md); report failed/uncertain persistence instead of claiming success.

## Phase 2 — student eligibility, preparation and applications

For applications/resume, first follow the [application runbook](../../../src/features/external-responses/application_workflow/RUNBOOK.md): run `application-status --input FILE`, reuse the existing SQL batch, scoped answers, engine/form memory and exact tailored artifact, then execute only the missing stage. Do not rediscover solved controls or regenerate compatible answers. The runbook defines verified CAPTCHA continuation, explicit human-assistance evidence and uncertain-outcome handling; a disappearing puzzle never proves success.

Read [student-position.md](references/student-position.md). Use:

`match → explicit target selection → prepare → authorized apply → report`

Reuse the saved description and valid shared decision for each student; another student does not trigger another extraction/global assessment. Recheck availability before submission separately from body extraction.

| Decision | Source of truth |
|---|---|
| Shared rules | `vacancy-selection/SKILL.md`; current rule hash must match the saved classification |
| Stack requirements/membership | Existing DB stack descriptions and student stack relation |
| Personal/contextual/company restrictions | Existing restriction loader over the original restriction table, native company links, student stop-list and existing HH global list |
| Report-only companies | `noco.companies.application_route` |
| Application history and outcomes | Current SQL-backed application state and imported confirmation evidence |

The [student reference](references/student-position.md#rule-sources-and-application-gates) gives exact table names and loader entry points. Do not recreate removed restriction tables or author a second policy list here. Interpret contextual rules using stored posting evidence and confirmed student facts, not hardcoded employer/city strings.

**Matching stack plus no applicable restriction means eligible only after current shared selection passes.** The selection skill now rejects above-Senior positions during collection; the older runtime seniority-exception mechanism cannot override that shared rejection. Do not introduce CV-fit scoring or inherited standalone preferences. A complete empty restriction set otherwise permits a match; unreadable/ambiguous policies require review.

The CLI checks shared-rule freshness; application gates reload current restrictions before opening, filling/uploading and submitting. Saved `eligible` results, `reviewOverride`, edited `fit` fields and offline snapshots cannot bypass these gates. Keep history and target limits enforced for each student/vacancy pair, even when the vacancy matches several stacks.

## Runtime limits — do not describe TODOs as implemented

- Vacancy market follows description language: English -> Global, Russian -> Ru. Company jurisdiction cannot override it. The sequential SQL application workflow enforces student-market routing; `--market en|ru` also scopes restriction loading.
- Accepted, fully inspected vacancies from partial sources remain usable after all source targets have terminal outcomes. Missing or ambiguous source outcomes still block applications. Preserve coverage gaps in the report.
- Classification follows collection. Standard `scan` stores verified source recipes, access reviews and exact decision cache entries in the existing SQL sources table; compatible complete searches younger than seven days reuse original observations. `--force-refresh` replays recipes; source barriers require human review or explicit retry. Default classification is cached-only; new decisions remain pending until a provider and concrete inference policy are approved. `classify --assessments FILE` accepts explicit reviews bound to run/body/rule hashes; preserve their origin and never claim unattended API classification.
- Sequential applications use per-vacancy tailored artifacts and this host's shared Dolphin ownership with Patchright. Drive CV intake and multi-machine coordination remain deferred. CVs enter preparation only, never shared vacancy selection.
- Source collection can use `scan --reasoner codex --concurrency 1`: replay SQL recipes/engines first, then consume persisted Sol investigation proposals. Follow the global-selection reference; do not generate temporary orchestration scripts or put per-company navigation in this skill. Auto-activation requires framework tests and complete live evidence. This does not enable paid API calls.
- Website discovery has at most three workers. Collection CLIs share a workspace lock; do not start independent programmatic crawls alongside them. Coordination with HH and other machines remains TODO.

## Forms, evidence and handoffs

Use the configured Playwright/Patchright application adapter; a separate Playwright MCP server is not required. A selected driver must not silently fall back. Verify committed field values, selected options and attachments. Typing style and HTTP 200 alone do not establish success.

Read [application-answer-policy.md](references/application-answer-policy.md) before preparing form values. Reuse this student's SQL/CV information and explicit answers. The operator's configured defaults cover affirmative work-authorization/technology/office willingness answers, no sponsorship required, and the stated timezone-to-location fallbacks; explicit student rules/answers override them. Record policy defaults as assumptions, never verified student facts. Do not ask again for a case already covered by that policy. Uncovered required values remain handoffs. Read [answering.md](references/answering.md) for positive, relevant writing and [ats-playbook.md](references/ats-playbook.md) for controls.

Record durable intent before submission. Count success only with captured confirmation; identify candidate-reported outcomes and human assistance separately. CAPTCHA, email verification, unsupported forms, missing facts and uncertain outcomes have distinct handoffs for the affected target, not an automatic whole-task stop. Check existing engines and official application destinations before treating form support as requiring user action. Never blindly retry an uncertain submission. Preserve active tabs while waiting; [email.md](references/email.md) covers verification, when actually required and authorized.

SQL history is authoritative for campaigns; Markdown/CSV/JSON reports are exports. One student's exclusion never removes a shared vacancy for other students. Resume from persisted state before doing more work. Application authorization does not authorize separate outreach, interview booking or automatic notifications for report-only companies.

## Token policy and workers

The user requires manual approval of token-use policy versions before activation/change. Read [token-policy.md](references/token-policy.md): present concrete models/prompts, limits, retries, reuse, batching and delegation. An unchanged approved version does not need approval per vacancy. Permission to apply is not token-policy approval. Guarded Codex benchmarks enforce their approved persisted weekly-quota policy; other workflows still require the operator to verify their own approved policy.

Use workers only when delegation is authorized and included in the approved policy. Keep one active application/browser owner per student. The standalone [parallel.md](references/parallel.md) drafting design does not replace campaign persistence, stage boundaries or ownership rules.

## Standalone searches and reusable resources

Only for an explicitly requested local single-candidate search outside SQL campaigns, read [standalone-search.md](references/standalone-search.md). Its intake/profile filters and file-log rules do not apply to the shared pool. SQL or permission failures are blockers to report, not permission to switch workflows.

- [sourcing.md](references/sourcing.md): discovery channels and skill datasets; use only sources inside the campaign scope.
- [after-submitting.md](references/after-submitting.md): follow-ups, with campaign SQL history taking precedence over file logs and separate authorization for outreach.
- `templates/profile.md`, `templates/draft.md`: standalone intake and application drafts.
- `scripts/sweep_boards.py`, `fetch_postings.py`, `form_questions.py`, `discover_boards.py`: stdlib-only Python discovery/form helpers; none is a SQL campaign submitter.
- `scripts/filter_postings.py`: standalone profile filter only; it must not replace the shared classifier or student restriction loader.
