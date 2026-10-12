# External responses: implementation TODO

## Deferred Jev integration

Deferred by the operator on 2026-10-02. The active collection/classification workflow uses `gpt-6-sol` through the existing Codex adapters. Preserve the [isolated Jev prototype](benchmark/jev/README.md) and completed fixture evidence; it is not a production engine or automatic fallback.

- [ ] Obtain Jev/provider credentials and explicit API/call/cost approval.
- [ ] Complete the policy-worker bridge and host-controlled admission of discovered controls.
- [ ] Validate remaining network boundaries, cancellation and read-only Dolphin integration.
- [ ] Compare against Sol 6 with equivalent coverage and safety, recording all model usage and failed attempts; adopt only after measured benefit.

No live Jev test or implementation is scheduled by this TODO.

> Collection update: `scan`, four existing-source SQL memory fields, bounded recipe replay/repair, seven-day reuse, exact classification reuse, combined assessor adapter, accepted-only persistence and compact reports are implemented. The [feature README](README.md) and stage contracts supersede unchecked historical collection items below. Paid AI activation/model-quality evaluation, later application work, shared HH/Dolphin ownership and scheduling remain unfinished; no applications are authorized by this document.

Planning specification, 2026-09-26. No migration, application, or runtime change is authorized by this document itself. Checked boxes describe inspected existing capabilities; unchecked boxes are future work. See [SQL types and relations](SQL_PLAN.md) and [logs and reports](OBSERVABILITY_PLAN.md).

Latest clarification: [shared vacancy selection, stored descriptions and token approval](VACANCY_REUSE_PLAN.md). Collection checkpoints raw observations; only globally accepted stack matches enter the canonical SQL vacancy table with full text for reuse by student matching/tailoring. Token-use policies require the user's explicit manual approval before activation or change.

Efficiency review: [EFFICIENCY_PLAN.md](EFFICIENCY_PLAN.md) documents concrete repeated work in the current code, output-sensitive complexity, exact-input caches, smaller SQL writes and proposals to reduce token usage. These are implementation tasks, not activated inference policies.

Latest MVP decisions: [stack/market routing, seven-day searches, retirement and usage measurement](MVP_REUSE_PLAN.md). Target-only tailoring and changed-application saves are approved. Reuse is the token-efficiency priority. AI request measurement is implemented; the routing/refresh/storage changes below remain TODO.

## Current milestone: discovery and sorting first

### Next-ten observations — 2026-09-28

Follow-up implementation: the first five collection corrections below now have deterministic fixture coverage. This does not revise the historical ten-company run or clear pending production access reviews. Geography and publication-recency policy changes require current reassessment; historical acceptance totals remain historical.

- [x] Separate standalone relative publication-age metadata from semantic decision identity; preserve original acquisition evidence. Reconcile the previous five-company run: 25/25 reviewed cache hits, one accepted vacancy, no new crawl or paid calls.
- [x] Allow `scan --await-review` followed by the same run with `--resume --assessments FILE`; record session/human provenance and use the normal accepted-only SQL transaction.
- [x] Inspect companies 105–114 across stacks 2,3,5. Save 96 accepted postings and 98 stack memberships, with 324 exclusions and 22 evidence-review outcomes kept in the audit. SQL readback: 97 total vacancies, 28 unchanged applications; all 442 decisions reused in a read-only cache check.
- [x] Stop following complete ATS detail records; preserve explicit distinct boards and pagination, prune unrelated employer navigation after verified board coverage.
- [x] Rank official ATS boards ahead of translated careers/detail pages and exclude marketing, blogs and general developer navigation.
- [x] Require challenge UI/access-denial evidence instead of a bare CAPTCHA mention. Historical AdTech/Alao pending reviews remain unchanged until explicitly revalidated.
- [x] Flag short/cookie-only extraction, strip consent overlays and prevent cookie-only semantic calls/eligibility while retaining raw audit text.
- [x] Repair only via changed navigation or rediscovery without failed controls; report attempted/succeeded/failed/skipped distinctly and retain the shared budget.
- [ ] Revalidate these fixes on live sources; fixtures are not proof of complete unattended discovery.
- [ ] Route explicit student geography exceptions to audited excluded postings for scoped reconsideration; default shared selection never reads personal rules.
- [ ] Separate the misleading `canonical_url` identity name from a consistently clickable posting URL, preserving existing deduplication/history keys. `apply_url` already stores the live target.
- [ ] Canonicalize official native/ATS aliases when the posting identity is evidenced. Ahrefs' OCaml role appeared at two URLs; do not merge different location-specific postings merely because titles match.

The [run report](../../../logs/external-responses/scans/next-ten-20260928/report.md) contains coverage, evidence, architecture and measured work. These results establish accepted-only persistence and decision reuse, not complete unattended discovery: only one of the ten sources received a validated recipe. FX for this review was recorded manually from the ECB; automatic FX enrichment and paid-model activation remain unfinished.

### Approved rules and live collection — 2026-09-28

- [x] Update the shared skill: salary upper range/period conversion, position-level junior exclusions, Java/Python missing-framework allowances, AQA exclusion, unclear workload acceptance and description-language markets.
- [x] Update all three existing SQL stack descriptions; FullStack includes senior JS/TS frontend, Python excludes Django-heavy and ML-focused roles. Save/read back without migrations.
- [x] Add a narrow higher-title permission gate to matching and applications; explicit CV/student-rule metadata is required. Automatic extraction of these permissions remains TODO.
- [x] Fix real crawl regressions: placeholder JSON-LD masking listing links, blank-label Workable links, inline careers jobs and styled-div React titles.
- [x] Run the frozen five-company sample through collection, classification and accepted-only SQL persistence. 25 postings inspected, one accepted Python vacancy; Adapty unsupported and the original Accel Notion source partial. Use the officially linked current Accel board without modifying registry identities. [Report](../../../outputs/live-collection-20260928/report/report.md).
- [x] Preserve explicit session-review provenance via `classify --assessments`; use the existing SQL guard/transaction path. SQL readback confirms vacancy #1, complete description, Python link and unchanged application count.
- [ ] Configure a standalone AI key/model and validate unattended semantic classification with the user's approved token policy. This live test used assistant-session review, not the unconfigured API. No feature API token usage was fabricated.
- [ ] Supply dated FX/enrich structured compensation automatically. Deterministic arithmetic is implemented; missing conversion basis remains review. This sample's accepted role did not state salary.

These updates supersede older market/jurisdiction assumptions and missing-evidence questions below. No applications ran.

### Collection fixes — 2026-09-28

- [x] Cap website discovery at three workers, and reuse the existing workspace lock to prevent simultaneous collection CLIs from allocating separate pools. HH/multi-machine coordination remains deferred; direct API tests must not run alongside another campaign.
- [x] Preserve terminal partial/unavailable outcomes as coverage gaps; admit fully inspected accepted roles after every source has a valid outcome. Missing/ambiguous source audits still block applications.
- [x] Detect explicit listing login/registration gates, save a durable local source review immediately, skip unresolved sources in later runs and continue other sources. Evidence also remains in the SQL run audit. Distributed SQL source claims remain TODO.
- [x] Record description-language market on vacancy/source JSON: English -> Global, Russian -> Ru, ambiguous -> unknown. The previous company-jurisdiction helper was removed. Student cohort routing remains TODO.
- [x] Preserve explicit Telegram recipients/instructions in accepted vacancy/run JSON, report them as “Vacancies with Telegram — apply later”, and prevent Telegram-only targets from opening web forms. No Telegram sending implemented.
- [x] Count unique companies separately from URLs and export accepted-vacancy Markdown/JSON/CSV with stacks, market and next action.
- [x] Update FullStack ID 3 in the working SQL DB to include senior JS/TS frontend-only roles; retain approximately <=60% backend for fullstack work and other existing restrictions. Readback verified.
- [x] Clarify the shared skill's junior rule: the position's own level, not mentoring duties. The user answered the historical salary/framework/workload/title questions; approved rules are implemented above. Paid inference remains subject to token-policy approval.
- [x] Freeze five active company IDs and original source bindings: [manifest](../../../outputs/collection-readiness-20260928/five-companies.json). Live crawl and session-reviewed SQL classification are now verified; no paid API classification or applications ran.

These changes supersede the corresponding older gap descriptions below. Current stage READMEs define the implemented contracts; the older distributed SQL/weekly-cache plans remain future work.

### Skill and integration review — 2026-09-28

- [x] Keep company discovery in the job-hunting skill as a pre-manifest activity, separate from vacancy collection and applications. Existing discovery scripts remain available; the SQL strategy still takes explicitly configured boards.
- [x] Define form-only operator defaults and SQL/CV answer sourcing in [application-answer-policy.md](../../../.agents/skills/job-hunting/references/application-answer-policy.md). Preserve student-rule precedence and policy-assumption provenance. No changed shared selection rules or automatic CLI behavior is implied.
- [ ] Add discovery-to-registry onboarding for verified company/career/ATS sources with provenance and explicit source types. Report ambiguous identity; do not introduce fuzzy identity rules or expand a frozen run.
- [ ] Add official careers-page fallback when a guessed ATS token fails. The bounded 2026-09-28 check harvested 12 company names; three sampled names resolved to no guessed Ashby/Greenhouse/Lever boards. Manual official-site lookup found Coalition Technologies' careers page and A.Team's talent-network entry point. Failed token probes are not proof of no hiring; a network entry point is not a verified individual vacancy. See [verification](../../../outputs/job-hunting-review-20260928/report.md).
- [ ] Integrate automatic semantic answer-policy loading, SQL/CV facts, question polarity, exact options and policy-versioned origins. Current `preparedAnswers` is a manual bridge, not unattended defaults. Never store operator defaults/timezone fallbacks as confirmed student facts. Keep the model/prompt/token changes subject to the existing manual policy approval.
- [ ] Extend form fixtures for explicit student overrides, sponsorship polarity, office willingness versus actual residence, technology Boolean versus numeric tenure, timezone fallback conflicts, and persistence/reporting of defaulted answers.
- [x] Implement the approved shared-rule edge cases and arithmetic/prompt contract tests. Form-answer defaults cannot modify global selection. Unattended model-quality evaluation remains pending API configuration and token-policy approval.

The discovery milestone still comes first. The collection fixes above implement local source reviews, market metadata, terminal/partial coverage, saved Telegram routes and the three-worker collection limit. Remaining work includes unattended model evaluation, student-market routing, distributed claims, shared HH coordination, Drive/SQL student hydration, tailoring, shared En Dolphin ownership, seven-day refresh/retirement and durable decision caches. Completing collection does not complete those integrations.

Updated 2026-09-27. Prove source inspection and the shared vacancy catalog before continuing with student matching, CV preparation or applications. The numbered full-pipeline checklist below is a dependency inventory, not an instruction to implement student/CV loading before this milestone.

This milestone consumes configured companies/sources, markets, existing populated stacks and shared rules. It outputs persisted complete descriptions, stack/market groups, decision evidence, application destinations and a source coverage report. Student membership defines the selected stacks; no CV, contact details, application answers, tailoring API or student browser profile is required to classify shared vacancies.

Current implementation step, 2026-09-27: collection saves raw audit/checkpoints; classification reads the editable vacancy-selection skill, evaluates shared rules once per vacancy, then writes only accepted stack matches and matched links atomically. Rule text/hash and all outcomes remain in the audit. The user deferred the concurrency coordinator and seven-day refresh. AI batching/caching remain separate work.

~~~mermaid
flowchart LR
    Scope["Existing populated stacks + source manifest"] --> Inspect["Inspect all sources, or reuse compatible weekly scans"]
    Inspect --> Save["Checkpoint raw text, identity, provenance and application destinations"]
    Save --> Audit["Every source terminal; preserve coverage gaps"]
    Audit --> Sort["Shared rules + all selected stacks + description-language market"]
    Sort -->|Accepted| Catalog["Save accepted SQL catalog + source and decision reports"]
    Sort -->|Rejected or review only| Review["Audit evidence; no vacancy row"]
    Catalog --> Web["Web destinations: later application phase"]
    Catalog --> TG["Telegram destinations: saved for later TG phase"]
~~~

### Discovery implementation order and acceptance

- [x] Verify the selected stack descriptions through the existing read-only working DB adapter: 2026-09-27, `unicorn_noco_copy`, Java ID 5 / 20 linked students, Python ID 2 / 27, FullStack ID 3 / 15; no configuration issues. These are membership counts, not application-readiness counts. FullStack explicitly includes JS/TS and approximately <=60% backend; Python includes approximately <=40% AI/ML and excludes Django-heavy work.
- [ ] Freeze source scope, selected populated stacks, language policy and shared rule versions. Do not activate a rule by copying an example from documentation.
- [ ] Implement the shared three-action ceiling and per-host serialization before a full-source crawl. Reuse the HH worker contract; separate CLIs must not each get three workers.
- [x] Checkpoint discoveries locally and in immutable run audit; promote only stack matches to canonical SQL with their full descriptions and matched links. Rejected/review-only roles create no directory rows. Tests cover support/PHP/review exclusions, multi-stack uniqueness, atomic promotion, duplicate/provenance preservation and uncertain acknowledgement. Full-text browser tests cover truncation and JSON-LD URL collisions.
- [ ] Add SQL source/page claims, explicit description quality/hash columns and channel-route evidence. Current run checkpoints are local, not the proposed SQL source-run queue.
- [x] Replace the all-sources-successful runtime gate with recorded terminal outcomes. Partial/unavailable/unsupported gaps remain in the report; missing source outcomes still block. Fully inspected accepted roles may qualify from partial sources.
- [ ] Implement weekly compatible-scan reuse, honest attempt/completion timestamps and confirmed-closure retirement. Access failure and missing pages never prove closure.
- [x] Route confirmed listing registration/login gates to a durable local source review, continue other sources and skip pending gates. Public listings with optional login links are not blocked. Distributed SQL review/task ownership remains deferred.
- [ ] Evaluate all selected stacks together against saved descriptions, after applicable shared rules; persist pass/reject/review reasons and supporting text. Inherit configured company/feed market without a per-posting market AI call. Reuse exact-input results; proposed token policy changes still require manual approval.
- [ ] Review the current `stack_classification/ai.ts` prompt against every configured requirement. It explicitly names role/seniority/technologies but omits workload shares and exclusions from that enumeration. Present an aligned prompt for manual approval, then verify representative Java/Python/FullStack decisions (including <=40% AI/ML, Django-heavy exclusions and <=60% backend). Supplied descriptions and mock decisions alone do not verify semantic accuracy. Rule ownership is documented in [the classification guide](stack_classification/README.md#where-to-edit-selection-rules).
- [x] Preserve explicit Telegram application destinations in accepted vacancy/run JSON and report them as deferred work. Telegram-only roles cannot enter web submission. Ambiguous wording and future channel execution remain separate work.
- [x] Export source coverage and an accepted-vacancy catalog with stack memberships, description-language market, descriptions, decisions and deferred Telegram routes. Unique company/vacancy counts do not inflate with source URLs or multiple stacks.
- [ ] Verify each module with injected adapters and fixtures: pagination/redirects, access walls, missing detail text, same-title distinct jobs, multiple stacks, description persistence/reuse, weekly boundary, pending reviews, crash/resume, source gaps, closed jobs and Telegram routes. Prove maximum active actions <=3.
- [ ] Review a bounded live read-only source sample, then the frozen full source manifest, through the public collection/classification/report interfaces. Publish gaps and sample classification evidence. Paid inference uses only an approved token policy. Do not submit applications during this milestone.

The configuration goal is automatic decisions from preconfigured shared rules and confirmed answers, without routine per-item approval. This does not invent missing facts or resolve registration/CAPTCHA/configuration exceptions. Application questions belong to the later phase. Campaign-wide AI usage aggregation is deferred; keep the existing per-invocation usage measurements.

For multi-market portals, the recommended least-manual option is a reusable adapter over explicitly configured market-specific feeds/queries, preferring an official structured listing endpoint when available. Configure the feed/market mapping once; runs then inherit it without per-vacancy market review. This is a recommendation for adapter scope, not activation of every aggregator or a claim that an EPAM endpoint has been verified. Unsupported portals remain explicit audit gaps; excluded aggregators remain excluded.

### Telegram application routes discovered on websites

- A vacancy's discovery source and application destination are independent. A company website may advertise a qualifying role with an explicit instruction to apply to a Telegram handle/link. Save its full description, original posting identity, employer, stack/market decisions and that destination now.
- Preserve all explicit alternative routes with evidence. A social footer, channel subscription link or company contact alone is not proof that applications should be sent there. Missing/ambiguous destinations require review; never manufacture a recipient from the company name.
- Telegram-only vacancies remain accepted shared vacancies with a derived `deferred_channel: telegram` execution disposition. They are neither web-application failures nor already-applied records. An unknown destination is `review`, not an eligible guessed route.
- Do not open a web form as a fallback for a Telegram-only role, send messages, create per-student submission intents, or tailor CVs during collection. No new notification/assignment workflow is required.
- Later Telegram processing consumes the saved vacancy and destination, checks current availability, channel readiness, authorized student scope, applicable personal restrictions and shared cross-channel application history, then prepares and sends. A successfully applied web alternative prevents a second TG application for the same student/vacancy. Preserve uncertainty and use the existing application identity across channels.
- This requirement covers capturing destinations in the current website phase. Telegram channel discovery and actual TG submission remain deferred integration work. Proposed storage is documented in [SQL route metadata](SQL_PLAN.md#application-destinations-independent-of-discovery).

### Release blocker: stage success is not MVP readiness

**Do not describe the whole MVP as ready until the full pipeline has passed the end-to-end checks in the verification matrix below.** Independent stage verification is the current development method; a successful discovery milestone does not clear this release blocker. Shared browser ownership, student matching, CV/answer preparation, submission/recovery, cross-channel duplicates and evidence-backed reports still require integrated verification. Live acceptance requires an explicitly authorized bounded pilot; old applications and fixture confirmations do not satisfy it.

## Confirmed operating rules

- Launch manually with explicit student IDs, existing stack IDs, application limits, and dry/live mode. Scheduling comes later.
- Reuse HH's rolling bounded-worker strategy. External responses has one shared hard ceiling of three simultaneous actions across its stages/runs; a per-stack pool or second CLI must not multiply the limit. See [the exact concurrency contract](EFFICIENCY_PLAN.md#three-simultaneous-actions-hard-limit).
- Use only existing stacks with students in the selected cohort. A missing description makes the selected campaign configuration invalid until that stack is configured or explicitly removed from scope. Unselected unconfigured stacks do not block the launch; never infer a stack policy from its name.
- Process the entire frozen company/source scope before classifying and applying. A source may finish with an access failure or unsupported status. These outcomes appear in the report and do not block completed sources.
- Inspect each company's careers listings once for all selected populated stacks together, retaining multiple matching roles across stacks; never crawl that company again just for another stack or student.
- Accept fully inspected, employer-bound vacancies even when their source has partial coverage. Keep incomplete/unverified vacancy details in review and the missing pages in the source audit; never promote a partial source to complete.
- A vacancy can belong to several stacks. Each student currently follows the existing primary-stack relation.
- Global selection uses mandatory shared rules and stack requirements without a student's CV. Persist the complete plain-text description and its version before exposing an accepted vacancy.
- Local matching/tailoring consumes saved SQL descriptions. Another student is not a reason to fetch or extract the posting again; availability checks and explicit refreshes are separate.
- Confirmed efficiency choices: applicable restrictions only, decision reuse after fresh gate checks, indexed lookups, and purpose-specific AI context. These remain TODO implementation work; exact model/token/retry/spending settings still require concrete manual approval.
- First derive market from description language and assess stack, then route authorized students, check personal restrictions/history and prepare CVs. An English Python role routes to Python/En. Language detection adds no AI call.
- Treat configured multi-market portals such as EPAM through aggregator sources with explicit market-scoped feeds, preserving employer identity/history. Registration/authentication walls immediately become source human-review items; continue other sources.
- Eligibility is a matching stack/market plus no applicable restriction. No additional CV-similarity or inherited preference filter. Unknown market membership is review, not a guessed En assignment.
- Search a company/source again when its compatible complete scan is seven days old; otherwise reuse it with original search timestamps. Account for every manifest target through live/reused/gap coverage before applying.
- Confirmed closed vacancies leave active results and pending work. Preserve their identity, descriptions, applications and evidence; never cascade-delete history or blindly resolve uncertain submissions.
- Unknown restriction applicability requires review. Missing data never means the student passes the rule.
- Reuse the student's En Dolphin profile. HH, external responses, profile filling, and cleanup must respect the same ownership protocol.
- Preserve application history, immutable selected targets, captured confirmations, and uncertain submissions across resume.
- LinkedIn and lnkd.in navigation remain forbidden, including redirects, popups, and embedded navigation. Blocked links remain visible in audits.
- notify_only companies appear in a report section and receive no automatic applications. No notification assignment or delivery workflow is added for them.
- Contextual restrictions remain external-only; HH retains its company stop-list behavior.
- Start with websites and the existing skill/dialog adapters. Aggregators and Telegram are extension work. Himalayas, HiringCafe, Wantapply, and Hirefy remain deferred until scope changes explicitly.

## Inspected baseline

- [x] Canonical company/source/restriction/vacancy/application SQL tables and migrations 001–004 exist.
- [x] Independent collection, classification, matching, preparation, application, and reporting interfaces exist.
- [x] SQL batches, student locks, submission intent, and outcome projection exist.
- [x] Local Playwright/Patchright browser support and four ATS adapters exist.
- [x] AI usage recorder and CLI reports: HTTP attempts/retries, known tokens, unknown usage, repeated inputs and largest measured operations; verified with mocked transport.
- [x] Java, Python, and FullStack descriptions exist in SQL.
- [x] Live read-only checks on 2026-09-26 found the required table/sequence privileges.

The inspected database had 428 active companies, 750 source records, 125 restrictions, zero vacancies/collection runs, and 28 unconfirmed legacy application records. There were 44 companies without a supported career source. These are a dated baseline, not future run totals or end-to-end acceptance evidence.

Current runtime still implements the old all-sources-successful gate. Candidate/CV state is local; Dolphin integration, Drive intake, tailoring, and durable reusable answers are unfinished.

## Pipeline and stage boundaries

~~~mermaid
flowchart TD
    Launch["Manual launch: cohort, stacks, limits, mode"] --> Scope["Freeze scope and source manifest"]
    Scope --> Context["Load SQL facts and approved Drive CV"]
    Scope --> Collect["Process every manifest target"]
    Collect --> Saved["Checkpoint raw text; reuse compatible scans when refresh is implemented"]
    Saved --> Audit["Close coverage audit: all targets terminal"]
    Audit --> Classify["Global rules + stack + description-language market"]
    Audit --> Gaps["Report partial, failed, unsupported and blocked sources"]
    Classify -->|Accepted| Directory["Commit accepted vacancy text and matched links to SQL"]
    Directory --> Cohort["Students with matching stack + market"]
    Cohort --> Match["Per-student restrictions and history"]
    Match --> Targets["Select and freeze target identities"]
    Context --> Prepare["Inspect forms, prepare answers and tailored CV"]
    Directory --> Prepare
    Targets --> Prepare
    Prepare --> Lease["Acquire student and shared Dolphin ownership"]
    Lease --> Apply["Verify, persist intent, submit once"]
    Apply --> Receipt["Capture receipt or preserve uncertainty"]
    Receipt --> Reports["SQL-backed reports and evidence"]
    Apply --> Handoff["Persist handoff; pause affected browser"]
~~~

Form inspection itself also requires browser ownership. The later ownership step means reacquire or retain ownership for live execution, never open the profile without a lock during preparation.

Every stage takes explicit input, injected dependencies, and saved state identifiers. It returns a typed result and its errors; it does not secretly invoke the next stage. A separate campaign coordinator deliberately composes the stages. Reporting works from SQL or an exported snapshot without Drive, AI, or a browser.

| Folder | Contract and responsibility |
|---|---|
| campaign/ (new) | Validate manual launch, freeze cohort/configuration, coordinate explicit stages, pause/cancel/resume |
| stack_catalog/ | Existing populated stacks, description/version snapshot and student membership |
| company_sources/ | SQL registry and imported file provenance; explicit unsupported/blocked targets |
| candidate_intake/ | Load existing SQL student context and approved Drive document; no onboarding workflow |
| vacancy_collection/ | Global selection input: bounded full-manifest inspection, raw audit/checkpoints and per-target progress; no canonical vacancy insertion |
| stack_classification/ | Global common-rule checks and vacancy × selected-stack decisions, using saved text |
| candidate_matching/ | Local student restrictions/history; reuse saved descriptions and global decisions |
| application_preparation/ | Target plan, reusable answers, form requirements, original/tailored CV manifests |
| applications/ | Four ATS adapters, synchronization, intent, submission, reconciliation and handoffs |
| reporting/ | Consistent developer, manager, student, source and exception outputs |
| infrastructure/ | SQL/storage/AI/browser adapters; shared Dolphin ownership belongs in the existing Dolphin integration |

Do not create services or classes merely to represent these folders. A small function with a documented contract is sufficient.

## Correctness decisions that implementation must preserve

### Collection completion is different from collection success

The frozen manifest is the expected set of targets, including a target for a company with no source. Every target must have exactly one durable current outcome. Equal counts alone are insufficient: compare target identities against the manifest.

Terminal source states: complete, partial, inaccessible, unsupported, blocked.
Nonterminal source states: pending, running, retry_wait.

The barrier opens only when the run has a valid frozen scope and every expected target is terminal. A cancelled or corrupt run never opens it. Reaching the desired number of vacancies cannot stop collection.

A company with no source becomes unsupported/no_supported_source. LinkedIn becomes blocked/linkedin_forbidden without opening it. Parser failure, authentication failure, and a page budget being reached must not become complete/no_vacancies.

Multiple source outcomes aggregate into company coverage without hiding individual failures. One complete source can supply usable vacancies while another source for that company fails. Report this as usable coverage with gaps, not exhaustive company coverage.

An individually verified vacancy with its complete saved description and employer evidence may qualify from a partial source alone. Example: listing pages 1-4 and their vacancy details were read, page 5 failed; use qualifying vacancies from pages 1-4, report page 5 missing, and never infer that unseen vacancies closed. A title/snippet without complete details is insufficient. Merge multiple observations without hiding coverage failures. Source completeness still controls weekly complete-scan reuse, independently of vacancy eligibility.

### Stable vacancy identity and application history

Current canonicalUrl can return greenhouse:<id>, which is an identity rather than a navigable URL. Current isDuplicate also uses company/title equality, which can conflate distinct postings.

- [ ] Separate navigable posting/application URLs from ATS identity.
- [ ] Use verified ATS namespace/tenant plus external posting ID when available; use a normalized official posting URL otherwise.
- [ ] Keep employer binding explicit. An arbitrary gh_jid query parameter on an unrelated host is not verified ATS identity.
- [ ] Treat matching company/title alone as a possible legacy-history match requiring review, not proof of the same vacancy.
- [ ] Distinguish a source/aggregator identity from the employer of a vacancy.
- [ ] Preserve source observations across refreshes instead of replacing all previous provenance.
- [ ] Check existing applications by student + stable vacancy ID across batches and channels.
- [ ] Reconcile submitting/unknown states; never create another application merely because the previous batch ID differs.
- [ ] Keep definite failed attempts in the same application record. Resume the owning batch; any future transfer between batches needs an explicit audited operation.
- [ ] Handle unresolvable legacy history separately. Missing URLs are not evidence that no application exists.

No company-name identification system is part of this work. Unresolved employers remain review items with their original provenance.

### Browser ownership must cover cleanup and connection loss

Current HH lock tags/statuses are visible markers, not atomic exclusion. Current Dolphin preflight/stop helpers can stop existing profiles. Integrating only a new external lock would therefore be insufficient.

- [ ] Acquire the shared lock by the actual provider profile ID, regardless of feature or local candidate alias.
- [ ] Require exactly one unambiguous canonical profile binding before automation.
- [ ] Keep a durable ownership token on the existing profile record in addition to a dedicated PostgreSQL advisory-lock session.
- [ ] Make start, attach, stop, fallback process termination, and preflight cleanup validate that owner token.
- [ ] Never stop an unrelated profile to free capacity. Report busy ownership and wait or skip its student.
- [ ] Use one lock acquisition order everywhere: student ownership where required, then profile ownership; reverse order on release.
- [ ] Keep lock sessions separate from short business transactions. Never hold an open SQL transaction during browsing or human input.
- [ ] Prevent pool starvation: the existing pool size of two cannot simply host arbitrarily many pinned student/profile lock sessions plus writes. Budget lock connections and transaction connections explicitly; reuse one owner session for a worker's advisory locks.
- [ ] On connection loss, halt irreversible browser actions. Retain the durable owner marker for reconciliation.
- [ ] Do not steal browser ownership solely because a heartbeat expired. Verify the old process/browser has stopped before recovery.
- [ ] Require all participating HH/profile-filler entry points and cleanup paths to adopt the protocol before enabling shared-profile external runs.

PostgreSQL releases session advisory locks when a session ends; that does not prove a separately running browser stopped. All participating code must cooperate with advisory locks. See [PostgreSQL locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).

A live human handoff retains profile ownership and pauses automation in that profile. Other students may continue within the configured capacity. A missing answer found before a live handoff can be queued without holding the student's browser indefinitely.

### External submission cannot share a transaction with SQL

The database and the employer form do not participate in one atomic transaction. The design prevents blind duplicates and preserves uncertain outcomes; it must not claim guaranteed exactly-once delivery.

Required order:

1. Recheck ownership, current restrictions/history, posting availability, prepared facts and attachment hashes.
2. Persist the submission intent, attempt ID, exact submitted-document/answer manifest and batch checkpoint in one SQL transaction.
3. Confirm that transaction committed. If acknowledgement was lost, read the stored attempt; do not click merely by retrying the transaction.
4. Perform one submit action for that attempt.
5. Capture and persist explicit confirmation, a definite rejection, or unknown outcome.
6. If the process dies after step 2, resume through reconciliation. A prepared intent does not prove whether the click occurred.

HTTP 200 alone, a closed tab, a missing error, or a generic old thank-you page cannot prove submission. Bind captured evidence to the current student, vacancy, attempt, and observation time. Logging/report failures cannot change submission state or authorize another click.

### Work sharing and bounded complexity

The detailed complexity model and code audit live in [EFFICIENCY_PLAN.md](EFFICIENCY_PLAN.md). Target shared work proportional to unique input plus required output. Global stack decisions can be V × K; full student matching can be students × matched vacancies. Do not claim the whole campaign is O(students + vacancies).

- [ ] Measure page reads, AI requests/tokens, SQL calls/rows and serialized bytes. Verify operation-count scaling before claiming savings.
- [ ] Use maps/sets for source/audit/vacancy/stack/history lookups and indexed handles for validated immutable snapshots. Arbitrary public inputs still require validation.
- [ ] Implement the confirmed company-level grouping: one shared inspection for all selected stacks, followed by saved per-vacancy/per-stack outcomes. Grouping does not skip pagination or the all-company barrier.
- [ ] Share equivalent public fetches/in-flight work while preserving source provenance/coverage. Never share authenticated student sessions.
- [ ] Group stack decisions and unresolved local rules into bounded requests only under an approved token policy. Validate every expected output; fewer requests do not mean fewer required decisions.
- [ ] Filter rule applicability from complete scoped data before evaluation; exact company blocks need no AI, while uncertain applicability stays review. Reuse existing semantic outcomes at application gates only after current dependencies are verified.
- [ ] Build purpose-specific AI inputs, preserving all necessary evidence and omitting unrelated candidate/position/log fields. Present exact prompt/length settings for manual approval before activation.
- [ ] Cache by every consumed semantic dependency, including title/location/company, rule set, student facts and validity, parser/model/prompt versions. Never cache by body alone or share private results across students.
- [ ] Load history/policies in bounded queries, then freshly verify dependencies at execution gates. Unchanged inputs may reuse semantic results; unavailable current data never passes.
- [ ] Bulk validate/write bindings and decisions. Version checkpoints/batch persistence to write only changed application state and small progress, not accumulated full bodies/batches.
- [ ] Prepare essays/tailored CVs only for eligible frozen targets after form inspection; reuse exact artifacts and scoped answers.
- [ ] Make missing-evidence review stable until inputs change; bound retries/fallbacks and reserve concurrent usage under the approved budget.
- [ ] Apply bounded pagination and memory/artifact limits. Never claim exhaustive coverage after a budget limit.
- [ ] Reserve transaction-pool capacity for intent/outcome writes even while discovery, AI and profile sessions are waiting.
- [ ] Keep final snapshots immutable while allowing bounded checkpoint writes during collection/classification.

Performance acceptance: adding another student to an existing stack does not cause another company crawl or full stack-classification pass.

## Ordered implementation checklist

### 1. Contracts, schemas and migration preparation

- [ ] Implement the field definitions and constraints in [SQL_PLAN.md](SQL_PLAN.md) as new migrations; leave applied 001–004 immutable.
- [ ] Add the two proposed tables; extend existing run/batch/profile records rather than duplicating business directories.
- [ ] Define explicit input/output/error contracts for all new adapters before implementation.
- [ ] Add schema/version identifiers to run scopes, source results, answer payloads, preparation snapshots and report exports.
- [ ] Add description quality/hash/extraction metadata and explicit global-selection versus student-match policy staging, as specified in VACANCY_REUSE_PLAN.md and SQL_PLAN.md.
- [ ] Present concrete token-use rules for manual approval; record the approved version/hash and prevent unapproved token-consuming operations.
- [ ] Preserve raw import evidence, archived tables, foreign keys, IDs, restrictions and application history.
- [ ] Validate migration planning against the working database marker and schema inventory.
- [ ] Test migration/backfill locally; prepare a reviewable live migration plan and recovery instructions. Do not run migrations at application startup.
- [ ] Extend SQL catalog mappings and perform Noco Meta Sync after the separately authorized migration; retain the existing PostgreSQL data source.

Acceptance: a clean local database and an existing-data fixture reach the same intended schema; archived records and confirmed outcomes are unchanged.

### 2. Manual campaign scope

- [ ] Add a coordinator that accepts explicit student IDs, stack IDs, per-student target limits, market, strategy set, concurrency/budget settings and dry/live mode.
- [ ] Reuse/extract HH's side-effect-free bounded-worker helper with its tests. Enforce a shared external limit of 3 (lower is allowed; higher is rejected), including standalone CLI execution, nested work, retries and resume. Do not import the HH executable or inherit its business side effects.
- [ ] Preview the exact cohort before launch. Existing studying/paused/graduated rows are not silently selected because their stack has students.
- [ ] Keep explicit selection as the authorization boundary; do not introduce an undisclosed client_status eligibility filter.
- [ ] Validate membership and descriptions. Report empty stacks and unmatched selected students; never expand the cohort silently.
- [ ] Freeze the full company/source manifest, selected stack descriptions, cohort, configuration and code/adapter versions.
- [ ] Extend the versioned scope with canonical student market membership and vacancy description-language evidence; no additional AI call. Preserve explicit authorized student selection and deduplicate across markets.
- [ ] Exclude legacy-reference companies from the directory scope while retaining them for history/restrictions.
- [ ] Store explicit no-source and unsupported-source targets, including company/source IDs and current route.
- [ ] Keep one active collection coordinator in v1; independent later application workers can consume a closed collection.
- [ ] Make resume load the frozen scope. Changes to membership, stack descriptions, source URLs or route need explicit reevaluation, not silent replacement.
- [ ] Make cancellation durable; stop scheduling new work and reconcile any action already in flight.

Acceptance: a company or student added during a run cannot silently enter that run; every original scope member remains accounted for.

### 3. Existing student data and Google Drive CV loading

- [ ] Resolve clients, primary stack, platform contacts, CV processing and En Dolphin binding through existing SQL metadata/adapters.
- [ ] Reuse approved final-CV selection and Drive download/export infrastructure; do not select the newest arbitrary PDF in a folder.
- [ ] Record Drive file ID, revision, approved CV-processing row, language, download time and SHA-256.
- [ ] Preserve original bytes and store files under the existing protected storage root. SQL stores metadata/references.
- [ ] Resolve the intended application contact account explicitly; an HH login is not automatically the correct external application email.
- [ ] Distinguish actual residence, desired location, work authorization and relocation preference.
- [ ] Reuse canonical SQL fields for existing contacts/facts. Do not shadow them with competing copies in the answers table.
- [ ] Extract additional facts with their evidence. Conflicting sources or unknown required facts enter the question queue.
- [ ] Load confirmed prior answers by student, semantic question, scope, version and validity.
- [ ] Save immutable preparation-context snapshots; detect changed or revoked facts before submission.
- [ ] Report one student's missing CV/account/profile without discarding shared collection work for other students.

Acceptance: original PDF hash is unchanged; wrong-student or wrong-language documents are rejected; SQL contacts and CV text cannot silently contradict one another.

### 4. Collection and source checkpoints

- [ ] Implement atomic source claims, bounded retries, per-page checkpoints and durable result observations.
- [ ] Add typed discovery access gates and a durable source review queue: registration/login walls go directly to review with URL/evidence/next action. Persist pending source state separately from immutable run evidence; no auto-registration or repeated retry of unresolved gates.
- [ ] Distinguish genuine listing access gates from optional login/newsletter links and application-only registration. Continue other sources, preserve fully inspected vacancies found before the gate as usable candidates, retain incomplete findings as review, and never classify blocked access as no jobs or vacancy closure.
- [ ] On subsequent launches, project unresolved source review as a terminal gap without visiting again; retain original real-search timestamps. Explicit human resolution/manual retry enables a new attempt.
- [ ] Resume a source from its checkpoint without repeating completed sources. Use a claim token so a superseded worker cannot overwrite newer results.
- [ ] Implement the seven-day compatible-scan reuse rule and SQL-backed last-search/last-complete/next-due status. Reuse must point to the original complete live scan and must not advance its clock.
- [ ] Add live/reused inspection mode to source checkpoints and the collection barrier; validate source/scope/version compatibility before using a cached complete result.
- [ ] Limit discovery to the shared maximum of three active actions and one active crawl stream per host; linked ATS pagination stays inside its owned task. No per-stack pools or nested parallel calls may multiply the limit. Browser asset requests are not a promise of one HTTP connection.
- [ ] Follow verified careers links, search controls and pagination; preserve redirects and canonical posting evidence.
- [ ] Use deterministic page/time/retry budgets and record exhausted budgets as partial coverage.
- [ ] Treat fetched content as data; posting text must not change campaign rules, credentials, instructions or navigation restrictions.
- [ ] Preserve exact file/sheet/row/cell/URL provenance for imports and actual hyperlinks rather than display labels.
- [ ] Require explicit SQL source and employer bindings. Keep unresolved observations for review.
- [ ] Upsert canonical vacancies without conflating separate employers or ATS tenants.
- [x] Checkpoint normalized description text without image/video payloads during collection; save the full body into noco.vacancies only when the vacancy passes classification. Explicit extraction-completeness metadata remains a separate task.
- [ ] Require persisted complete text/hash with the accepted decision before exposing a usable vacancy. Keep summaries optional and never use them to replace the full saved body.
- [ ] Set availability from observed posting evidence. Absence from a partial scan is never proof that a vacancy closed.
- [ ] Retire verified closed vacancies during both discovery and application checks; exclude current closed rows even when an immutable historical classification matched. Preserve history/FKs/receipts and do not replace frozen failed/closed targets.
- [ ] Finalize collection only after verifying the exact manifest-to-outcome correspondence.
- [ ] Atomically freeze the collection checksum and prevent late source workers from changing its results.
- [ ] Publish the full source audit, including companies without vacancies, partial/failed/unsupported sources and blocked LinkedIn.

Acceptance: a 428-company manifest with 44 companies lacking supported sources can close with gaps; applications still wait for every target to finish and use qualified complete vacancy observations, including those from partial sources. Unsupported, blocked and genuinely absent source records remain distinguishable.

### 5. Stack classification and per-student decisions

- [ ] Classify only individually verified, completely described, employer-bound vacancies; their source may remain partial. Keep source coverage and vacancy detail quality separate.
- [x] Read shared rules from [.agents/skills/vacancy-selection/SKILL.md](../../../.agents/skills/vacancy-selection/SKILL.md), evaluate once per vacancy, and pass only eligible roles to stack matching. No student CV is used. Missing AI/evidence remains review. Real model quality still requires the planned representative-posting review.
- [x] Remove CV-derived facts from student restriction inputs and application eligibility gates; policy adapters receive identity and independently confirmed facts only. Matching accepts a student without a CV. Regression tests preserve original CV facts for later preparation and prove they cannot leak through direct restriction-AI calls. The legacy standalone `discover` interface remains separate from shared campaigns.
- [x] Use one editable skill file for global rules, replacing the proposed SQL rule editor/evaluation-stage column. Snapshot active text/hash in existing classification JSON; require global pass before SQL promotion. CLI matching/application checks reject a changed file hash. The salary-floor example is an inactive comment until its period/basis/range semantics are specified. See [rule authoring](stack_classification/README.md#global-vacancy-rules).
- [ ] Version the classification snapshot and completeness checks to distinguish global pass/reject/review outcomes from stack pairs evaluated only for globally passed roles.
- [ ] Read the same saved description for each student's restrictions and tailoring. No re-fetch or AI extraction merely because the student changed.
- [ ] Evaluate the stored stack description semantically and save cited evidence, description hash, model/prompt version and reasons.
- [ ] Use matched/review/excluded for each globally passed vacancy × selected-stack pair. AI errors and uncertain backend/ML balance become review.
- [ ] Reuse decisions across students in the same stack; do not classify the same posting once per student.
- [ ] Route by shared vacancy stack + description-language market (English Python -> authorized Python/En students), then personal restrictions/history. No tailoring or posting-market AI call before/for these routing checks.
- [ ] Persist classification progress and freeze its final checksum only when every expected pair is accounted for.
- [ ] Evaluate current contextual/company restrictions separately for each selected student, including global rules.
- [ ] Keep clear/block/review decisions with policy ID/version, relevant context and supporting posting text.
- [ ] Cache only with keys containing vacancy-content, stack-description, policy and relevant student-context versions.
- [ ] Recheck membership, descriptions, policy changes, application_route and posting state at execution.
- [ ] Treat company/title-only history and unmapped legacy submissions as review evidence; do not call them captured success.
- [ ] Keep report-only companies out of automatic selection while retaining their vacancies in the report.
- [ ] Freeze a deterministic target list within each student's explicit cap. Count distinct vacancies across overlapping stack/source matches.

Acceptance: a matching stack and a complete clear restriction evaluation allow the role. No hidden CV score is introduced; unknown policy data never permits an application.

### 6. Answers, form preparation and tailored CVs

- [ ] Add a semantic question adapter: distinguish salary currency/period/basis, country-specific authorization, employer-specific questions and project stories.
- [ ] Reuse scoped answers only when their meaning and validity match the new field. Similar wording is not enough.
- [ ] Save new factual questions once per student/question/scope and associate all affected targets.
- [ ] Provide a versioned answer update interface; preserve which answer version each preparation used.
- [ ] Derive tailored CVs from the approved original and supported facts. Preserve employers, dates, achievements and qualifications.
- [ ] Reuse the existing CvTailoringService.tailorFromPdf adapter with jobRequirements from SQL; validate its returned artifact and preserve the existing web-console behavior.
- [ ] Save tailored PDF URI/hash, original hash/revision, vacancy content hash, facts/answers version hash, model/prompt/template versions.
- [ ] Reuse a tailored artifact only when the full cache key matches; never cache solely by student or title.
- [ ] Validate rendered PDF content, contact details, selectable text, file type/size and attachment identity.
- [ ] Inspect all four ATS form types, conditional questions, exact options, consent requirements and employer-specific restrictions.
- [ ] Validate saved values, local bytes/hash selected for upload, and the employer's attachment acknowledgement/name in live mode; visual text alone is insufficient. Do not claim the server verified a content hash unless it actually returned comparable evidence.
- [ ] Keep dry runs free of candidate uploads, form submissions, account creation and irreversible form actions.
- [ ] Leave optional demographic/marketing fields unanswered unless the student supplied a choice.

Acceptance: every submitted field has evidence or an explicit configured choice, and the exact submitted CV can be reproduced from its recorded inputs.

### 7. Shared Dolphin ownership and Patchright

- [ ] Implement the shared ownership protocol described above in the existing Dolphin integration.
- [ ] Integrate it into HH runner, profile filler and preflight/cleanup paths; leave their business filtering unchanged.
- [ ] Attach Patchright to the owned student's existing Dolphin browser session through an injected adapter.
- [ ] Validate driver/package/browser versions and required APIs with a harmless local fixture before live use.
- [ ] Fail explicitly if the requested driver or attachment fails; never launch another student profile or silently switch drivers.
- [ ] Keep existing profile/proxy settings; no automatic proxy rotation or profile replacement on rejection.
- [ ] Preserve navigation guards across new tabs, redirects and background navigation.
- [ ] Start the pilot sequentially if needed; never exceed three active actions or three owned open profiles, including parked handoffs. Shared pool/browser/host constraints may lower concurrency further.
- [ ] Keep CAPTCHA/email verification as human handoffs with recorded ownership and resumable checkpoints.

Acceptance: HH cannot attach to or stop a profile owned by external responses, and vice versa, including recovery and cleanup paths.

### 8. SQL application lifecycle and recovery

- [ ] Create queued canonical application rows and frozen batch state together for all selected targets.
- [ ] Keep one application row per student/vacancy; attempts append to existing batch history.
- [ ] Validate batch/run/stack/student/vacancy relationships in the write transaction.
- [ ] Require a ready classified run and a complete verified vacancy observation for every target; partial source coverage is allowed and remains visible.
- [ ] Recheck live facts/policies and availability before filling/uploading and before submit.
- [ ] If posting content changes, preserve the original snapshot and attach a new observation; reclassify/re-evaluate before using it. Never silently alter the frozen target identity.
- [ ] Persist an attempt UUID and exact preparation manifest before clicking Submit.
- [ ] Bound retries to proven pre-submit failures or definite rejection cases. Record every retry reason.
- [ ] Reconcile uncertain submissions without clicking again, even after process/browser/DB restarts.
- [ ] Allow receipt reconciliation and outcome persistence after campaign cancellation or policy changes; these stop new submissions, not recording what already happened.
- [ ] Capture receipts with source URL, time, attempt binding, screenshot and sanitized response evidence where available.
- [ ] Keep candidate-reported success and captured success separate; also independently flag manual assistance.
- [ ] Preserve a captured confirmation across subsequent export, diagnostic or unrelated failure.
- [ ] Recheck data route changes: a company newly marked notify_only cannot receive another automatic submission.
- [ ] Do not replace failed targets or grow limits on resume.
- [ ] Stop the affected student's browser work for live human handoffs; continue other students when capacity permits.

Acceptance: SQL acknowledgement loss, process termination at every submission boundary, simultaneous workers and report failures cannot authorize blind duplicate submissions.

### 9. Logs, reports and operational handoff

- [ ] Implement the event contract, artifacts and report definitions in [OBSERVABILITY_PLAN.md](OBSERVABILITY_PLAN.md).
- [ ] Correlate SQL state and diagnostic events through run/batch/student/vacancy/attempt IDs.
- [ ] Extend implemented per-invocation AI measurements with campaign/entity attribution and actual cache-hit reasons; meter tailoring API calls separately with tokens/cost unknown.
- [ ] Generate reports from durable state; report unavailable evidence explicitly.
- [ ] Export consistent offline snapshots and verify their checksums/schema versions.
- [ ] Prepare per-student reports using only that student's records and verified audience identifiers.
- [ ] Keep report rendering separate from delivery. First release writes local artifacts; a later explicit delivery action can reuse existing messaging infrastructure.
- [ ] Keep notify_only as an end-of-report section, without sending messages or assigning referrals.
- [ ] Document operator actions for missing answers, CAPTCHA/email verification, busy profiles, uncertain outcomes and stale ownership.
- [ ] Document cleanup/retention for temporary files separately from durable intent, answer versions and confirmation evidence.
- [ ] Update stage READMEs and the root routing index when each behavior is implemented. Remove stale TODOs only after their acceptance checks pass.

## Verification matrix and release order

| Area | Required regression cases |
|---|---|
| Scope | Missing/zero-student stack, duplicate selections, membership changes, no implicit status filter |
| Coverage | 44 unsupported companies, one late source, missing task row, wrong task with matching count, page 5 fails while complete vacancies from pages 1-4 qualify, incomplete detail remains review, all sources fail |
| Source resume | Crash per page, stale worker result, duplicate observations, finalization racing a result write |
| Identity | Same title/different posting, tracking aliases, ATS tenant collisions, aggregator versus employer, Greenhouse non-URL legacy identity |
| Application routes | Website advertises TG-only applications; preserve recipient/evidence and accepted stack result, no web fallback/message/tailoring, social link is not an application route, web/TG alternatives share history |
| Restrictions | Clear/block/review, new/edited/revoked rules, location nuance, cache invalidation, HH contextual behavior unchanged |
| Student context | Wrong CV/student/language, inaccessible Drive, conflicting contacts, changed revision, no En profile, duplicate profile binding |
| Answers/CV | Scope leakage, salary units, stale answer, unsupported claim, tailoring cache collision, wrong attachment, rendered-PDF validation |
| Description reuse/token policy | Second student performs zero body re-fetches, API receives saved text, refresh failure preserves full text, unapproved token policy performs zero provider calls |
| Efficiency | Linear shared operation counts at fixed stack/rule size; metadata-aware cache invalidation; single in-flight inference; changed-record persistence; unchanged gate reuses AI after fresh dependency reads |
| Three-action ceiling | Shared max_active <= 3 across task types/stages; no nested fan-out; fourth queued; values above 3 rejected; competing CLI, retry, timeout, failure, cancellation and handoff coverage |
| Markets/refresh/retirement | Stack + market before personal restrictions and CV; exactly seven-day boundary; reused/failed search clock; expanded scope; closed versus inaccessible; retained receipt/history; stale-open race |
| Company markets/source review | Zero per-posting market inference; company config invalidation; configured aggregator feed routing; real login wall versus optional link; deduplicated pending review; manual resume; unchanged successful-search clock |
| Browser ownership | HH versus external race, cleanup of another owner, lock connection loss, old owner cleanup after takeover, handoff and crash recovery |
| SQL lifecycle | Unique student/vacancy, mismatched company FK, immutable targets, ready gate, committed intent with lost acknowledgement |
| ATS fixtures | Ashby, Greenhouse, Lever, Recruitee; conditional fields, saved values, attachments, country/toggle regressions, HTTP 200 with errors |
| Outcomes | CAPTCHA, robot rejection, email verification, definite rejection, unknown, captured manual success, reported-only success |
| Reporting | Disjoint totals, multi-stack duplicates, historical attempt counts, redaction, expired/missing artifacts, disk full, offline replay |

- [ ] Run migration/contract tests with mock adapters and local PostgreSQL-compatible fixtures.
- [ ] Run all four intercepted browser fixtures with Patchright and existing Playwright compatibility checks.
- [ ] Run affected HH ownership/readiness tests without live applications.
- [ ] Dry-run an explicitly selected small cohort through the new public interfaces and publish its audit.
- [ ] Perform an explicitly authorized bounded live pilot with frozen targets; never count fixture or legacy results as live acceptance.
- [ ] Record exact captured successes, reported-only outcomes, failures, uncertainty and human assistance. A shortfall remains a shortfall.

## Deferred work

- Automatic scheduling; any concurrency above three requires a future explicit user change, not automatic wider rollout.
- Aggregator adapters and explicit reactivation of currently excluded aggregator sites.
- Telegram discovery using the existing parser through a future tg-responses integration.
- Proxy provisioning/rotation and Dolphin profile creation.
- A student dashboard built from canonical applications and report projections.
- Automatic report delivery, with separately configured audiences and delivery idempotency.
- Advanced employer identity resolution and repost linking; ambiguous identity remains reviewable in v1.
- Separate normalized attempt/artifact/report tables only if real query or retention requirements justify them.

## Implementation navigation

Current behavior to replace or extend:

- [Collection barrier](vacancy_collection/index.ts) and [classification barrier](stack_classification/index.ts).
- [SQL collection persistence](vacancy_collection/postgres.ts) and [classification persistence](stack_classification/postgres.ts).
- [Candidate/application store](infrastructure/postgres-store.ts), [identity](infrastructure/identity.ts), [ATS lifecycle](applications/execute.ts).
- [Existing Drive adapter](../hh-profile-filler/drive-source.ts) and [student/CV resolver](../hh-profile-filler/noco-repository.ts): reuse capabilities through injected contracts, without importing HH launch requirements.
- [Dolphin runtime](../../integrations/dolphin/runtime.ts), [preflight cleanup](../../integrations/dolphin/preflight.ts), [HH profile handling](../hh-responses/orchestrator/client-runner.ts).
