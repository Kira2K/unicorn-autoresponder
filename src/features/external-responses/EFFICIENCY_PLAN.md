# Work and token efficiency

> Superseded for the active collection path by [scan](README.md), its [source-memory contract](vacancy_collection/README.md) and [combined assessment/cache contract](stack_classification/README.md). Keep remaining student/application optimizations as future work. This historical proposal does not approve paid usage.

Planning audit, 2026-09-27. These are proposed changes, not measured speedups or implemented runtime behavior. Read with [description reuse](VACANCY_REUSE_PLAN.md), [implementation TODO](IMPLEMENTATION_TODO.md), [SQL](SQL_PLAN.md) and [observability](OBSERVABILITY_PLAN.md). No model, prompt, batching, cache or token-limit policy is activated by this document; the user must manually approve its concrete version.

## Confirmed choices

The user explicitly accepted these implementation directions on 2026-09-27. Keep them unchecked until implemented, but do not ask for the same design approval again:

- [ ] Inspect each company's complete careers scope once for all selected populated stacks together. Never repeat the company crawl per stack/student; one company can contribute several roles to several stacks.
- [ ] Assess only restrictions applicable to this student, role, company, market and channel; preserve review for unknown applicability.
- [ ] Reuse decisions at application gates after fresh dependency checks.
- [ ] Replace repeated full-array searches with indexed lookups.
- [ ] Send purpose-specific AI context with the evidence needed for that decision.
- [ ] Reuse HH's rolling bounded-worker strategy and enforce at most three simultaneous external-responses actions in total, as specified below.
- [ ] Tailor only eligible intended applications after shared stack/market routing and personal restrictions/history.
- [ ] Persist only the changed application and small progress while preserving all previous records/evidence.

The user subsequently approved target-only tailoring and changed-application persistence. [MVP_REUSE_PLAN.md](MVP_REUSE_PLAN.md) adds stack/market routing, seven-day scan reuse, logical vacancy retirement and implemented usage measurement. Exact models/prompts, input/output budgets, retry/fallback values and spending caps still need concrete manual review before change. The already confirmed directions and three-action ceiling do not require approval again.

## Three simultaneous actions: hard limit

Source inspected: [runWithBoundedConcurrency in the HH CLI](../hh-responses/cli/orchestrator.ts), [its tests](../hh-responses/cli/orchestrator.test.ts), and [HH configuration](../hh-responses/orchestrator/config.ts). HH uses a rolling worker queue, preserves result ordering and spaces starts with a shared start gate. Supervised HH defaults to three, but its current configurable helper does not itself enforce a maximum of three.

- [ ] Extract/reuse the small bounded-worker helper through a side-effect-free shared module; keep HH's existing behavior/tests intact. Do not import the executable HH CLI, load its ENV, launch HH, or copy its readiness/reporting side effects into this feature.
- [ ] Set an external-responses hard ceiling of 3. Accept a lower positive integer for a smaller pilot; reject configuration above 3 rather than treating three as a default that can be overridden.
- [ ] Use one shared coordinator/queue for external-responses work, not one pool per stack/student/stage. Standalone stages must use that same admission boundary; v1 concurrent CLI launches must join it or refuse to start a second independent coordinator. Three campaigns cannot silently mean nine active actions.
- [ ] An action is an active worker task: source inspection, vacancy assessment, student assessment/preparation or application execution. Its browser/AI/tailoring work is sequential under the same slot. Nested calls do not acquire the same permit again, and may not fan out parallel work beneath one slot. Future concurrent child work must return to the shared queue.
- [ ] Browser asset requests and short SQL/log/checkpoint housekeeping are implementation activity within a task, not separate business actions; this limit is not a promise of only three TCP connections.
- [ ] Keep one crawl stream per host and one automated owner per student/profile, even when global capacity remains. Reuse the start-spacing mechanism with explicitly configured pacing; do not silently copy HH's timing values to every source/API.
- [ ] Preserve the global collection barrier. During collection, up to three source tasks cover all selected stacks; after the pool is finalized, up to three later tasks run. Do not overlap early applications with unfinished sources.
- [ ] Release a slot only when its in-flight operation has ended or stopped. A timeout alone does not prove the old browser/request stopped. Cleanup, cancellation, retries and resume must not start a fourth action.
- [ ] Isolate ordinary task failures into typed results so one broken company/student does not abandon remaining work. On coordinator-fatal errors, stop admission and drain/reconcile active work before another run; HH's Promise.all helper alone does not provide this cancellation contract.
- [ ] A human handoff pauses automated work and retains profile ownership. A parked profile also counts toward the separate maximum of three owned open profiles; do not open a fourth browser because a tab is waiting for a person.
- [ ] Log queued/running/finished/paused states, shared active count and configured ceiling. Test mixed task types, nested calls, retries, exceptions, handoffs and competing CLI starts with max_active <= 3.

This is the external-responses limit. Existing HH runs keep their own configuration; shared profile ownership still prevents HH and external from using the same En profile simultaneously. Reusing the scheduler does not authorize changing HH's launch scope or notification behavior.

## Two approved changes in plain language

**Tailor only selected targets:** first determine which student/vacancy pairs will actually receive an application using the configured stack, restrictions, history and explicit campaign limits. Only then spend on a tailored CV for each pair. If 100 collected vacancies produce 10 applications for one student, generate 10 tailored CVs. If all 100 will receive applications, generate all 100. This adds no hidden fit filter, arbitrary smaller quota or per-vacancy manual approval. Inspect the selected form first so a known blocker does not trigger a pointless tailoring call; retain frozen targets and recorded blockers without automatic replacements.

**Save only the changed application:** if the tenth application changes to submitted, update that application's state/evidence and small batch progress. Applications one through nine are already in SQL and stay there. Do not rewrite those nine with every later click/status update. The final report still reads all ten, and every required attempt/receipt remains durable. This primarily saves database work, not AI tokens.

AI transport measurement is now implemented in [ai-usage.ts](infrastructure/ai-usage.ts) and the CLI. Request/operation summaries expose known input/output tokens, actual retry requests and exact repeated inputs. Full cache integration and the business-state changes above remain TODO; no measured live savings are claimed.

## Token settings in plain language

Tokens are pieces of the text an AI reads and writes. Repeating a long vacancy in many requests repeats input work. Running three requests together limits simultaneous activity; it does not limit how many requests run over a day.

| Setting to review | Plain-language decision |
|---|---|
| Model/provider | Which AI service/model handles each task? Do not silently switch to a more expensive one. |
| Input content | What evidence does the AI need? Keep full source text in SQL; do not silently cut job requirements to make requests smaller. |
| Reply length | A matching decision needs a verdict and short supporting quote, whereas a cover letter needs more space. Set separate limits. |
| Group size | How many stack/rule checks fit in one request without losing required evidence or cutting off the reply? |
| Retry/fallback | If a request fails, how many additional paid attempts are allowed, and can another model be used? No endless automatic retries. |
| Saved-result reuse | Reuse the answer when all relevant inputs are unchanged; reconsider when a rule, vacancy, student fact or its validity changes. |
| Total budget | How much AI work/spend may the whole campaign use before pausing? This is separate from the confirmed three-action limit. |
| Hidden tailoring usage | If the tailoring API returns no token/cost data, report its call count and unknown usage rather than inventing a cost. |

Before activation, present the actual model names and numeric limits in a short table for manual approval. No approval is required anew per vacancy when those approved settings stay unchanged. This document does not choose those remaining values for the user.

## Honest complexity target

Use separate dimensions instead of claiming the entire campaign is O(n):

- C: manifest/source targets; P: distinct permitted pages inspected; L: total text bytes processed.
- V: unique vacancies; K: selected, configured stacks with selected students; S: selected students.
- M: vacancy/stack decisions required by the global contract, at most V × K.
- E: student/vacancy pairs actually assessed. With one primary stack per student, the full set is the sum of students-in-stack × matched-vacancies-in-stack.
- Q: applicable restriction checks across those pairs; H: relevant history rows; A: frozen application targets.

Aim for expected linear in-memory work in input plus output: O(C + P + L + M + S + E + Q + H), with separately bounded attempts/form work for A targets. This assumes hash-map/set lookup, bounded retries and no repeated scans of growing arrays. Database lookups have index/IO costs; this is not a guarantee that SQL or remote latency is O(1).

Account for byte lengths explicitly: reading/sending a long description is not a constant-time pair check. L includes text actually processed; measure unique shared bytes and repeated consumer bytes separately so the formula cannot hide duplicated model context.

If all S students match all V vacancies and a full per-student report is required, E = S × V is unavoidable output. K is currently small, but M is not mathematically O(V) when K grows. One batched AI request does not turn its input/output tokens into O(1).

All companies still finish before application selection. Limits do not authorize stopping shared collection early. Student checks can stream/page through this completed pool without loading an entire Cartesian product into memory. A future stop-after-target-cap mode must explicitly label remaining pairs not evaluated; it cannot claim a complete student matching report or replace frozen failures.

## Findings in current code

| Location | Repeated work observed | Planned replacement |
|---|---|---|
| [collection index](vacancy_collection/index.ts) | Each manifest source filters the entire audit; vacancies scan the source array | Build source/audit maps once; preserve missing, duplicate and unexpected identities |
| [website discovery](vacancy_collection/discover.ts) | queue.shift/queue.includes, repeated positions.filter per source, indexOf inside audit sorting; visited state is source-local | Queue cursor + queued/visited sets; source-local result buffers; manifest ordinal; share equivalent public page reads |
| [classification](stack_classification/index.ts) and [AI](stack_classification/ai.ts) | One full-description request per vacancy/stack; readiness uses repeated ids.includes and hashes the complete snapshot on each consumer | Bounded multi-stack assessment; sets; validate immutable snapshots once per trusted load and reuse indexed handles |
| [student matching](candidate_matching/index.ts) and [identity](infrastructure/identity.ts) | Full vacancy filtering against a matched-ID array and linear history scans for each student | Indexed stack groups and canonical history lookups; preserve ambiguous legacy-history review |
| [restriction evaluator](candidate_matching/restriction-ai.ts) | Full description and all candidate facts sent once for each rule; application gates may repeat this evaluation | Cheap applicable-scope checks, exact-input reuse and bounded grouped semantic checks |
| [collection persistence](vacancy_collection/postgres.ts) and [classification persistence](stack_classification/postgres.ts) | Sequential source checks/upserts per vacancy and INSERT per decision | Resolve bindings in chunks; parameterized set-based writes; short checkpoint transactions |
| [application lifecycle](applications/execute.ts) | Reads all earlier batches/history for each target | Resolve history once for matching; fresh indexed student/vacancy checks at execution |
| [SQL store](infrastructure/postgres-store.ts) | Each save reprojects every accumulated record and serializes the growing full batch | Persist only the changed application/attempt and small batch progress; freeze batch manifest once |
| [answer generation](application_preparation/answers.ts) | Sends the entire Position object plus all candidate facts | Purpose-specific context with unresolved fields, relevant confirmed facts and needed vacancy evidence |

The current repeated readiness membership checks can be O(K × V²) per invocation. Reprojecting 1, 2, ..., A accumulated records is O(A²) writes across a growing batch even before retries. These are code-level findings, not production benchmark results.

## Priority 0: remove accidental repeated work

- [ ] Use Map/Set indexes for canonical source, vacancy, stack membership, audit and history identities. Compute canonical identity/source keys once per observation.
- [ ] Keep queue order with an array cursor and a separate queued set. Do not sort by repeatedly searching the source array; render by frozen manifest order.
- [ ] Deduplicate public page requests before body extraction. Within the same freshness window, share an in-flight result for identical URL/tenant/locale/adapter/request context; retain each source's provenance and independent coverage result.
- [ ] Do not share authenticated pages, form sessions, CSRF tokens, cookies or candidate-specific content across students. A shared ATS hostname is not a shared employer/tenant.
- [ ] Finish and store each source/page checkpoint without rewriting all previously collected bodies. Repeated copies of a growing source result JSON can also become quadratic; use bounded immutable observation chunks and references, then one final snapshot.
- [ ] Avoid holding an entire campaign's body copies per student. Pass vacancy IDs/content-version references and load bounded working sets. Full latest text stays in noco.vacancies.description; historical evidence remains resolvable.
- [ ] Validate a saved immutable collection/checksum and build indexes at its trust boundary. Public functions accepting arbitrary objects still validate them; a caller-supplied digest or ready=true cannot bypass validation. Cached handles cannot reference mutable input.
- [ ] Replace all-record batch saves with a changed-application transition contract. Preserve atomic intent/outcome, owner checks, uniqueness and captured-success protection.
- [ ] Do not assume jsonb_set or changing one element of a large JSON document gives constant physical write cost. Keep mutable checkpoint rows small and benchmark bytes written.

## Priority 1: spend inference on unresolved semantics

### Shared vacancy interpretation

Use ATS structured data/HTML parsing without AI first. Persist exact evidence and unknowns; no screenshot/OCR/LLM extraction by default when readable text exists. This does not mean seniority/framework/contextual rules can be replaced with keyword guesses.

- [ ] Extract common factual attributes once per complete description version: role/seniority evidence, required versus optional technologies, actual location/remote terms, and responsibility evidence. Derived facts are versioned caches, not new authoritative requirements or replacements for full text.
- [ ] When semantic fact extraction is necessary, prefer returning needed facts with the global assessment rather than adding a mandatory preliminary LLM call. Benchmark any two-pass design against the simpler direct assessment; extra extraction is not automatically cheaper.
- [ ] For small K, evaluate the common rules and selected stacks in one bounded request per changed vacancy, returning a keyed decision/evidence for every expected stack and each common rule. Short-circuit decisive global rejection where safe. Large inputs require the separately approved batching/chunking policy.
- [ ] Preserve explicit global pass/reject/review and per-stack outcomes. Missing/duplicate output keys, unsupported quotes and malformed responses are invalid, not default passes. Repair only invalid work under an approved retry policy.
- [ ] Perform deterministic checks where complete structured evidence and an explicit rule settle the result. Retain semantic assessment/review for nuanced descriptions. Do not use embeddings, title keywords or extracted percentages as silent eligibility gates.
- [ ] Store request/input hashes and reuse unchanged successful results across students/resume. Cache a combined request with all of its stack/rule inputs; changing one supplied stack can invalidate that combined result. Claim per-stack invalidation only for independently evaluated, independently keyed inputs.

### Local restrictions and application answers

- [ ] Read complete applicable policy sets in chunks, indexed by student/global scope, company/subsidiary scope, channel/market and validity. Exact company-ID blocks and notify_only routes need no LLM. Unknown scope/identity must remain review, not be discarded by an optimization.
- [ ] With no applicable restrictions, stack match proceeds without local eligibility AI. Do not introduce a CV-fit score.
- [ ] Group unresolved applicable rules for a student/vacancy into one bounded request when approved, with distinct rule IDs, cited evidence and validated per-rule results. If a definite block already settles eligibility, later expensive rules may be recorded not_evaluated_due_to_block; do not label them clear or claim every rule was evaluated.
- [ ] Persist/reuse exact decisions at pre-open/pre-upload/pre-submit gates after a fresh read verifies their complete dependencies and time validity. Fresh checks remain; an unchanged dependency check need not rerun AI. Added/revoked rules and unreadable dependencies invalidate reuse.
- [ ] Start with per-student decision keys. Sharing local semantic decisions between students is deferred until dependency projection is proven complete; two people with the same stack or residence are not automatically interchangeable.
- [ ] Resolve facts and scoped confirmed answers deterministically first. Send only unresolved questions plus sufficient supporting facts/evidence. Excluding context that can affect the answer is not an acceptable token saving.
- [ ] Inspect the actual selected form before spending on tailoring/essays. Prepare only frozen, eligible targets with required facts available, not every collected vacancy or every potential student/vacancy pair.
- [ ] Reuse original Drive bytes/extraction by approved student/file revision/hash. Reuse tailored artifacts by exact student, original CV, full description/request and service version. Never reuse another student's CV or blindly retry an ambiguous tailoring request.
- [ ] Reuse ATS structural form descriptions only as inspection hints; recheck actual fields/options/conditions. Never reuse verification tokens or skip saved-value/attachment validation.

Global parsing produces facts once; local policies still decide differently for different students. A dependency list inferred by AI is not sufficient proof that omitted context is irrelevant. Any optional translation of free-text rules into typed predicates must preserve the original rule, cite its version, receive explicit review, and fall back to semantic review for unsupported meaning.

## Cache and invalidation contract

Use a replaceable cache port beside existing persistence. Begin with indexed saved decisions and protected content-addressed artifacts, not an extra cache server or vector database. Cache loss permits recomputation under the approved budget; it never authorizes duplicate submission. Artifact/approval history remains separate from disposable cache retention.

| Result | Required key/dependencies |
|---|---|
| Public fetch/extraction | Verified source/tenant, locale, request context, freshness/revision evidence, extractor version |
| Global derived facts/decisions | Hash of exact semantic input: body, title, location, employer/source facts used; applicable rule and supplied stack versions; schema/model/prompt/parser/approved policy versions |
| Local restriction outcome | Canonical student ID, relevant confirmed fact versions, full applicable-rule-set fingerprint including additions, vacancy semantic hash, route/company/market/channel context and time-validity dependencies |
| Answer | Student, semantic question + options/units/country/conditions/scope, supported fact versions, relevant employer/vacancy context, generator version |
| Tailored PDF | Student, approved original CV hash, exact jobRequirements/request hash, service/configuration version; facts if used by that adapter |

Do not include collection run ID in a semantic reuse key unless it affects the result; record the consuming run separately. Do not exclude semantic fields merely because the body hash is unchanged. Hash a defined canonical representation and keep serializer/schema versions; absence differs from empty, false or revoked.

Use exact keys; no approximate/fuzzy decision cache. Deduplicate simultaneous identical calls under owned work items; persist operation/result references before releasing work. After a crash/timeout, unresolved provider outcomes consume an uncertain usage reservation until reconciled; do not assume cancellation prevented billing.

Successful evidence-valid semantic review results can be reused until dependencies change. Transport failures are not reusable semantic decisions. Do not automatically retry the same missing-information review for every student/gate; queue the missing evidence once with all affected consumers.

## SQL and persistence implications

No additional business tables are proposed by this efficiency review. Reuse the existing/proposed tables from SQL_PLAN.md:

- Add an optional versioned decision_key text to existing vacancy_stacks, with an index for retrieving prior exact-key evidence. Preserve its existing run/vacancy/stack PK; reuse creates evidence references for the consuming run, not shared mutable decisions. The evidence describes the full input/dependency key.
- Keep derived vacancy facts/cache metadata alongside versioned source observations; load them in bounded batches. Full descriptions stay in SQL. First implementation may limit cross-run reuse to retrievable prior decisions; do not claim a cache that requires scanning every historical JSON blob.
- Read matched pairs with an index on (run_id, stack_id, decision, vacancy_id). Reuse the existing unique (client_id, vacancy_id) application index for duplicate/state lookups. Verify existing indexes/query plans before adding equivalent ones.
- For current campaign matching, bulk-load scoped restrictions and relevant history then build maps. Re-read current state at irreversible boundaries. Indexes/joins must preserve nullable global rules, validity windows and unresolved identity behavior.
- Use parameterized batch writes with explicit chunk/transaction limits. Resolve source/company bindings without an N+1 query loop; validate them in the write transaction, not only from an old memory cache.
- Introduce a versioned batch persistence contract: freeze targets/bindings/limit once; store per-application preparation, attempts and handoff data in existing canonical application records; update only the affected record and small batch progress. Export the public BatchState from those records. Keep legacy full-batch snapshots readable.
- Never reconstruct an old preparation from the latest mutable vacancy text. Store its exact description/version or immutable retrievable reference and original hashes. Logging failure must not lose business evidence.
- Keep per-source incremental observation chunks bounded and durable through the artifact/checkpoint adapter. Raw/rejected/review bodies remain audit observations; only accepted vacancies and matched links are promoted to the canonical SQL directory. Missing historical chunks block replay explicitly; they do not become empty evidence.

Changing the batch/source snapshot shape needs versioned serializers, migration/backward-read tests and contract updates. This is a deliberate replacement for repeatedly growing snapshots, not an unannounced side effect of using a faster query.

## Token policy proposal, still requiring manual approval

Present actual values to the user before activation; this document supplies no approved model or limit defaults.

- Stage-specific input/output/call budgets. The current client exposes a shared maxOutputTokens=8000 ceiling; that ceiling is not actual usage, but concise decisions and essays need different reviewed budgets.
- Concise structured decisions with short exact evidence or validated text spans; no chain-of-thought, repeated full HTML, source logs or entire candidate objects in prompts.
- Explicit batching limits and output-cap handling. Truncated output becomes incomplete/review and must not silently permit a missing stack/rule.
- Retries/model fallback/repair have a total cap covering SDK and outer retries together. Missing evidence differs from retryable transport failure.
- Atomic budget reservation before concurrent calls, then reconciliation to actual usage. Store operation/reservation references in owned work checkpoints and cumulative counters in run operational metadata, separate from immutable approved scope. Unknown outcomes keep a reservation pending.
- Tailoring API usage remains unknown if the service returns no token counts. Enforce reviewed call limits, and do not claim to enforce a hidden provider's token ceiling.
- No extra agent per company/student by default. Additional workers require explicit delegation and reviewed token/concurrency limits; more parallel calls change latency, not asymptotic work or total tokens.
- Reports use deterministic SQL/JSON projections; no AI is needed to count outcomes or render standard manager/student summaries.

Illustration only: for 1,000 vacancies and 10 selected stacks, the current global adapter can make 10,000 description-bearing requests. Batching all stacks could reduce this to about 1,000 requests if input/output budgets fit. It still produces up to 10,000 stack outcomes and sends rule context; this is not a promise of 90% total token savings. Local-rule sparsity, cache hits and number of actually prepared targets determine further savings.

For comparable prompt shapes, let D be description tokens and R average stack-rule tokens. Separate stack requests repeat roughly V × K × D description tokens; one bounded multi-stack request repeats roughly V × D. Rule context/output remains on the order of V × K × R plus the per-stack decisions. This estimates the duplicated component, not billed usage; actual provider counters and quality checks decide whether batching is beneficial.

## Verification and rollout

- [ ] Establish operation counters on mock fixtures before optimization: page/body reads, semantic requests, description input bytes, actual returned tokens, SQL round trips/rows/bytes, snapshot serialization bytes and cache outcomes.
- [ ] For fixed K, rules, source behavior and document length, doubling unique vacancies should approximately double shared-stage work rather than quadruple it. Check counts, not brittle wall-clock timing assertions.
- [ ] Increasing students does not increase shared fetch/extraction/classification calls. Local output/calls may grow with E/Q and actual unresolved needs; report these separately.
- [ ] Identical descriptions across two independent employers do not collide when employer context differs; authenticated sessions never cross students.
- [ ] Repeated unchanged restriction gates perform fresh dependency reads with zero repeated semantic calls. A new restriction, changed residence, expired fact or notify_only switch blocks/invalidate as required.
- [ ] Changed title/location without changed body invalidates affected semantic results. Changed run ID alone does not invalidate valid semantic caches.
- [ ] Combined-stack outputs account for all expected IDs. Partial/malformed responses, oversized documents and exhausted budgets stay explicit review/pending states.
- [ ] Validate decision quality on labelled boundary cases before approving a new classifier prompt: senior mentoring juniors, required versus optional Spring, Django-heavy versus FastAPI roles, dominant ML work and JS-focused fullstack responsibilities. Fewer calls cannot justify worse eligibility; any billable evaluation needs the approved token policy.
- [ ] N target transitions touch N changed application projections, not 1+2+...+N accumulated projections. Serialization/checkpoint growth is measured separately.
- [ ] One student/vacancy's history or policy cannot leak into global selection or another student's cache.
- [ ] Full reports enumerate every requested pair or clearly declare unevaluated scope. SQL totals remain reproducible without AI.
- [ ] Crashes during chunk persistence, inference, intent and receipt handling retain deduplication and uncertainty safeguards.

Rollout order: add counters and fixtures; remove map/queue/query/batch-save repetition; add exact-input caches and version invalidation; present concrete inference/batching/token policy for manual approval; then activate approved AI changes and compare measured results. No live application is required for these performance checks.
