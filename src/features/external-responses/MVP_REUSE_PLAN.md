# MVP: stack and market routing, reuse, weekly refresh

> Historical planning reference. Source recipes, seven-day reuse, exact decision caching, combined assessment and explicit closure handling are now implemented by `scan`; the [feature README](README.md) and affected stage contracts supersede those sections below. Scheduling, student routing and application ownership remain separate work. This plan does not activate paid AI.

Confirmed requirements, 2026-09-27. This document refines the [implementation TODO](IMPLEMENTATION_TODO.md), [SQL plan](SQL_PLAN.md), [efficiency plan](EFFICIENCY_PLAN.md) and [reports](OBSERVABILITY_PLAN.md). Routing, refresh and retirement changes remain TODO. AI request measurement is implemented as described below; no live AI requests are required to test it.

## Required order

Current milestone is [discovery and sorting first](IMPLEMENTATION_TODO.md#current-milestone-discovery-and-sorting-first). Approved coverage clarification: a fully inspected vacancy from a partially inspected source may qualify. If listing page 5 fails, complete verified vacancies from pages 1-4 remain usable; incomplete job details stay in review. Every manifest target must still reach a terminal outcome, and reports retain the missing page. This does not make a partial source scan complete for seven-day reuse, renew old observations, or establish closure of unseen vacancies. Terminal/partial runtime gates are implemented; weekly reuse remains TODO.

~~~mermaid
flowchart TD
    Companies["Company sources; fresh scan or due search"] --> Pool["Saved vacancies: global rules + stack + description-language market"]
    Pool --> Cohort["All students with matching stack + market in authorized campaign"]
    Cohort --> Personal["Applicable personal restrictions and existing history"]
    Personal --> Targets["Eligible application targets and form checks"]
    Targets --> CV["Reuse or generate this student's tailored CV"]
    CV --> Apply["Recheck current state, apply, save changed application"]
~~~

- A Python vacancy from a company configured as Global routes to every Python/En student inside the manually authorized campaign cohort. No CV-fit scoring or extra shortlist is introduced.
- Updated 2026-09-28: vacancy description language owns market: English -> Global, Russian -> Ru; ambiguous -> unknown. The deterministic helper adds no AI call. This supersedes the old company-jurisdiction/default policy; company tags do not override posting language.
- Stack and vacancy market routing happen before personal evaluation or tailoring. Reuse shared decisions across students. A language-policy/description change invalidates routing decisions; existing saved bodies can be re-evaluated without another crawl.
- Personal restrictions such as "no English-language positions" may exclude a routed student. En membership selects who to consider; it does not override personal restrictions or establish language fluency, residence or work authorization.
- Preserve location, eligible countries and remote terms for personal restrictions. Market labels express the operator's language-routing convention, not proof that a person is legally eligible everywhere. Global routes to En; Ru routes to Ru.
- Resolve canonical student market membership through existing adapters. Add versioned stack/market/student bindings and the vacancy language decision to the stack-only CampaignScope. Do not infer student membership solely from an available Dolphin browser or English CV. Unknown membership or vacancy language requires review.
- A student may have more than one market binding. Deduplicate applications by canonical student/vacancy, not by market/profile. Do not expand a manually selected student scope to the entire database silently.
- Approved: tailor only the pairs that will receive applications, after stack/market and personal restrictions/history. Known form blockers pause preparation. An unchanged successful tailored artifact is reused for the same student/CV/vacancy/service inputs.
- Approved: persist only the changed application and small progress. Earlier applications, confirmations and attempt evidence remain saved and included in reports.
- Three simultaneous external-responses actions remains the shared hard maximum.

## Aggregator routing for multi-market portals

The user's EPAM example remains an explicit aggregator-source choice. Language-based markets now allow postings from one source to route differently. Source type is configured, never a hardcoded company-name rule.

Preserve actual employer identity for restrictions, ownership and past applications. Changing strategy must not delete history or make the platform the employer of every listing. Feed scope may guide searching but cannot override the latest description-language routing rule.

Current loadDatabaseSources only supports website sources and reports aggregator sources as adapter_required. Registering EPAM as aggregator does not itself implement collection. The aggregator adapter remains required; Himalayas, HiringCafe, Wantapply and Hirefy remain outside the current scope. No live source-type change is made by this plan.

## Discovery failures requiring a person

Current infrastructure includes typed listing access gates, durable local source reviews and SQL run evidence. Distributed mutable source-review state remains TODO. The application VerificationHandler remains separate from discovery reviews.

Required behavior for a confirmed registration/login wall that prevents reading vacancies:

1. Stop the affected source immediately; no account creation, paid access, login guessing, bypass attempts or repeated AI interpretation of the same wall.
2. Save inaccessible coverage (or partial when some content was read), a specific registration_required/authentication_required reason, URL, timestamp, safe screenshot/text evidence and checkpoint.
3. Create a pending source review with a clear action: provide authorized access, configure a public official source, or explicitly skip it. Report it directly in the human-action queue; no automatic message delivery is added.
4. Release unused worker capacity and continue other sources. The blocked source is a recorded terminal coverage gap, not complete/no_vacancies. Do not reset the weekly complete-search clock or close old vacancies because access failed.
5. Preserve the pending review across launches. No blind weekly retries of the same known registration wall. Resume only after the person resolves access/configuration or explicitly requests another attempt; record resolution and verify access again.

Detect an actual access gate, not merely a footer login link, optional newsletter registration or an application-only account requirement when listings remain public. Distinguish CAPTCHA and robot rejection with their own reasons. Temporary network failures may use bounded retries; persistent failures/unsupported parsers also enter review with their actual reason.

Use existing source/run storage rather than a new task system: immutable source-run evidence plus a proposed mutable sources.access_review object for current pending/resolved/skipped state, review key/version, reason, originating evidence references and resolution. Deduplicate by source/access context/reason, not student count. A source-based read queue is distinct from per-student application handoffs and the notify_only company report.

Frozen run evidence stays immutable when a person resolves a review. Current review resolution lives on the source and is version-checked; unresolved reviews can be projected into new runs without reopening the website. Preserve original last_search_at. Secrets, credentials and verification codes belong in protected existing account storage, never in the review record or manager report.

## Reuse opportunities in MVP

| Saved result | Reuse when | Recompute when |
|---|---|---|
| Company/source search | Complete, same search scope/source/adapter, under seven days old | Seven days elapsed, missing/incomplete coverage, source/scope changed, explicit refresh |
| Full vacancy text | The saved version is complete and no change is established | New posting, changed details, incomplete body, approved refresh condition |
| Global stack decisions | Exact vacancy and applicable stack/global-rule versions match | Any input to that assessment changes |
| Market routing | Same description-language decision/policy and student membership | Description/language-policy/membership changes; no extra AI call |
| Student restriction checks | Same student facts, complete applicable rule set, vacancy context and validity | Rule added/edited/revoked, fact/market/context changes or expiry |
| Original CV bytes/extraction | Same approved Drive file revision/hash and student | Approved document changes |
| Confirmed application answers | Same student, semantic question, country/units/scope/options and valid supporting facts | Facts/meaning/options/validity change |
| Tailored CV | Same student, original CV, exact saved job requirements and service/request version | Any of those inputs changes |

Do not reuse another student's private output. No similarity search is needed for MVP: exact inputs and known dependencies are enough. An unchanged decision may be reused only after fresh submission checks verify current policies/history/availability. Closed vacancies never become active simply because an old cached result says eligible.

## Weekly search contract

The default search interval is exactly seven days (168 hours), stored/compared as UTC timestamps. Scheduling is still manual in MVP: the next launch refreshes due sources and reuses eligible fresh scans; this does not create a background weekly job.

Save actual attempt start/end and result in the already proposed noco.collection_source_runs. Expose source/company status with:

- last_search_at: most recent real search attempt, including failure.
- last_complete_search_at: completion time of the latest real complete scan of this scope.
- next_search_due_at: last_complete_search_at + seven days; never a synthetic reset after reuse.
- last_search_status and the scan/scope/version reference.

These are SQL-backed projections from scan records; avoid a second editable timestamp copy. The planned PostgreSQL status view can be exposed in the existing Noco source after migration/sync. A company with several sources shows per-source results and the earliest due source; one successful URL must not hide failed/unsupported sources. No prior complete scan means due immediately. If none of its sources are usable, report unsupported instead of retrying forbidden links.

At launch, every manifest target is accounted for by a real attempt, a reference to a complete compatible saved scan younger than seven days, or an existing unresolved human-review gap. Add inspection_mode=live|reused|review_pending to the source-run contract. A reused row points to the original live scan and copies neither a fake new search time nor proof of a fresh website visit. review_pending references original access evidence and never qualifies as complete inspection. Real last-seen/search times are not advanced by reuse or pending review. Imported legacy data with unknown timestamps remains unknown/due.

Failed/partial real attempts update attempt time/status, but do not move last_complete_search_at or next_search_due_at. Due refresh failures are reported; other valid sources may proceed. Expired snapshots from failed sources stay historical/review data. Bounded transient retries within a run remain under the approved policy; another manual launch may retry due transient failures. Known registration/authentication and other pending access-review holds require explicit human resolution/retry, not another automatic weekly attempt.

A fresh scan is reusable only if it covers the requested search scope. A prior Python-only filtered query is not proof of Java coverage. Changes to source URL, geography/query filters or extraction contract can require earlier refresh. Rule changes use stored full text where coverage exists; they do not automatically require a whole-site revisit.

For unchanged listings, prefer reliable source revision/content signals and stored bodies. A board returning full descriptions may still transfer those bytes at weekly refresh; do not promise zero network transfer or change detection without requests. Avoid redundant detail-page and AI-extraction calls when returned complete text is unchanged.

Pre-application availability checks happen even inside the seven-day window. They update vacancy availability evidence, not the timestamp of a complete company search. If a campaign crosses the seven-day boundary, do not admit newly discovered replacement targets silently; refresh into a new explicit collection version when needed.

## Closed vacancy lifecycle

The user confirmed: remove closed vacancies from active results; preserve application history and evidence. This is logical retirement, not cascading SQL deletion.

- During discovery/refresh and application checks, record verified closure in noco.vacancies.availability='closed', closed_at and closure_evidence; last_checked_at records the actual observation time.
- Closure requires trustworthy posting-specific evidence: explicit closed/inactive state, confirmed no-longer-accepting response, or a verified missing canonical posting. CAPTCHA, 403/429, timeout, parser failure or absence from a filtered/partial list means unknown, not closed. Check redirects/alternate official posting identity before treating a changed URL as a disappeared vacancy.
- Remove it immediately from active discovery results, current stack/market queues and future matching/tailoring. Active queries must join current availability even when an immutable past run contains a match.
- Keep canonical vacancy identity, saved descriptions, immutable run/stack evidence, application rows, prior CV versions and captured confirmations. Do not delete FK-bound history or purge the duplicate-prevention record.
- Mark selected but unsubmitted work skipped/closed with evidence; preserve frozen target identities/limits and do not replace it automatically.
- A submitting/unknown application stays unresolved until receipt reconciliation; vacancy closure does not prove failure or erase a successful submission. Confirmed applications retain their outcome.
- Use observation ordering and current ownership/transaction guards so an older delayed open scan cannot overwrite a newer closure. Reopening requires new positive official evidence; historical applications still prevent automatic repeats.

No physical vacancy/history deletion is planned for this lifecycle. Artifact retention is a separate reviewed maintenance policy, not a side effect of closing a posting.

## Usage measurement implemented now

[infrastructure/ai-usage.ts](infrastructure/ai-usage.ts) wraps the external feature's existing AI transport without changing prompts, models, limits or retries. [cli.ts](cli.ts) attaches the recorder to all its AI clients.

Each invocation that makes AI requests writes under logs/external-responses/ai-usage/<invocation-uuid>/:

- requests.jsonl: request start/result, operation/model, logical call and HTTP-attempt IDs, timing, safe counts and exact request-body hash; no prompts, contacts, CV text, filenames, headers or API keys.
- summary.json and summary.md: logical calls, actual HTTP attempts, retries, known input/output tokens, provider-reported cached input, unknown usage and diagnostic failures.
- operations.csv: operations ranked by known input + output tokens to show the largest measured consumers.

Repeated exact inputs across logical calls are flagged as reuse candidates; retries are counted separately. A repeated failed request does not prove avoidable spend. Cached input tokens are a subset of input tokens, not an extra amount to add. Request bytes are not labelled tokens. Incomplete/invalid structured output can still consume tokens, and its reported usage is retained before answer parsing.

Known totals exclude missing provider usage, so unknown attempts remain visible. HTTP failure or timeout without returned usage is not asserted to be free. No currency costs are invented. The external tailoring service returns no usage: when integrated here, record call/retry/result/reuse counts and unknown tokens/cost. The current recorder covers this feature's AI transport, not the separate web-console tailoring endpoint.

Metrics writing failures never trigger provider retries or application resubmission. JSONL request starts survive normal process-level interruptions; a killed process may lack final summary files. Public API users can inject the recorder; CLI integration is automatic. No paid request was made for the mock verification.

Next measurement TODOs: shared cache-hit/miss reasons, effective tokens per successfully classified vacancy, usage per matched student/vacancy, and campaign-wide aggregation across invocation IDs. Reuse and measuring actual use are the MVP priority; no silent new model/truncation/fallback policies are introduced.

## Acceptance checks still needed for pipeline implementation

- [ ] An English Python vacancy routes to authorized Python/En students without another AI call; a personal no-English rule blocks that student before CV generation.
- [ ] Description-language/policy or student-membership changes invalidate routing using saved data. Aggregator discovery preserves actual employers; feed/company labels do not override posting language.
- [ ] Registration/login walls create one durable source review immediately; optional login links do not. Other sources continue, repeat launches do not retry a pending wall, and human resolution creates an auditable retry.
- [ ] Duplicate En/Ru bindings cannot create duplicate student/vacancy applications.
- [ ] Day six reuses a compatible scan; at exactly seven days a real refresh is due. Failed refresh/reuse never resets the successful-search clock.
- [ ] Every company/source still has a terminal live/reused/gap audit before any application begins.
- [ ] Expanded search scope cannot reuse an incompatible filtered scan as complete.
- [ ] Confirmed closure during discovery or application removes active work while retaining historical evidence, and cannot downgrade a receipt or resolve an unknown submission.
- [ ] A temporary website/robot failure cannot close vacancies. An old open observation cannot resurrect a newer closed vacancy.
- [x] Mock AI transport verifies retries versus logical calls, private-data omission, repeated inputs, missing usage, metering before output failure and nonfatal metric-write errors.
