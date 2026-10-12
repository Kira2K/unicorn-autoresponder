# External responses: logs, evidence and reports

> Standard `scan` now uses one diagnostic stream, SQL source action history and one default Markdown report; [reporting/README.md](reporting/README.md) supersedes collection-output proposals below. Other workflow reporting proposals remain historical/future work.

Proposed contract, not an implemented logging change. Read with [implementation TODO](IMPLEMENTATION_TODO.md) and [SQL plan](SQL_PLAN.md).

Implemented subset: external CLI AI calls now emit request metrics and per-invocation JSON/Markdown/CSV summaries. [MVP_REUSE_PLAN.md](MVP_REUSE_PLAN.md#usage-measurement-implemented-now) describes exact scope and limitations. Remaining campaign-wide event/report contracts below are still proposed.

SQL owns application/run state. Diagnostic logs explain execution. Evidence supports specific claims. Reports are reproducible projections of saved state; they never trigger applications.

Efficiency measurement follows [EFFICIENCY_PLAN.md](EFFICIENCY_PLAN.md). Distinguish unique shared work, student-specific output and retries; increased student counts must not be reported as increased unique vacancy discovery.

## Storage and audience boundaries

| Data | Proposed location | Audience |
|---|---|---|
| Current business state | Existing PostgreSQL tables | Authorized operators and scoped student views |
| Run/source checkpoints and attempts | Existing noco workflow tables plus proposed noco.collection_source_runs | Workers and developers |
| Reusable answers and preparation snapshots | Protected SQL rows/JSON | Assigned operators and the relevant student |
| Approved/tailored CV bytes | Existing protected storage adapter; original source stays in Drive | Application worker and authorized reviewers |
| Structured diagnostic events | logs/external-responses/runs/<run>/events/<worker>.jsonl | Developers |
| Browser/network/evidence artifacts | logs/external-responses/runs/<run>/evidence/<attempt>/ | Developers; selected receipt evidence for operators/student |
| Rendered reports | logs/external-responses/runs/<run>/reports/<edition>/ | Per-report audience |
| Offline export manifest | Same report edition, with hashes and generation timestamp | Authorized recipient |

Per-worker event files avoid unsafe concurrent appends from multiple machines. An export merges events by correlation IDs and per-worker sequence; timestamps alone do not establish causal order.

The storage adapter starts on the existing host. Artifact URIs must identify their storage location/host and checksum; an absolute local path is not automatically accessible from another worker or NocoDB. Shared storage can replace this adapter later.

## Structured event envelope

Every event uses the following envelope. Shared collection events have null student/application fields; do not invent a candidate merely to satisfy the old event type.

~~~json
{
  "schema_version": 1,
  "event_id": "uuid",
  "at": "UTC ISO-8601 timestamp",
  "level": "info",
  "event_type": "application.intent_committed",
  "stage": "applications",
  "run_id": "collection-run-id",
  "batch_id": "student-batch-id",
  "client_id": "123",
  "stack_id": "5",
  "company_id": "456",
  "source_id": "789",
  "vacancy_id": "1001",
  "application_id": "1002",
  "attempt_id": "uuid",
  "browser_session_id": "uuid",
  "worker_id": "host-worker-id",
  "worker_sequence": 42,
  "operation_id": "uuid",
  "parent_operation_id": null,
  "duration_ms": 87,
  "reason_code": null,
  "data": {
    "state_from": "preparing",
    "state_to": "submitting",
    "preparation_hash": "sha256",
    "artifact_refs": []
  }
}
~~~

IDs above are illustrative, not actual student data. Envelope fields irrelevant to an event are null or omitted according to the versioned schema. Entity IDs remain strings; durations/counters are numeric. Include code revision and package/config versions in one referenced run manifest instead of repeating large metadata on every event.

Levels: debug, info, warn, error. Use stable event/reason codes and typed payloads; human-readable messages supplement them. Each operation records a start and terminal result where practical. Log SQL timings/outcomes and safe error codes, not SQL parameter values or connection strings.

## Log types

All categories use the same envelope; category-specific payloads have their own validation.

| Category | Example events | Useful payload |
|---|---|---|
| Campaign lifecycle | campaign.created, campaign.paused, campaign.cancelled, campaign.completed | Frozen scope hash, limits, phase, counts, code/config version |
| Work scheduling | work.queued, work.started, work.finished, work.paused | Shared coordinator ID, task type, active/queued counts, hard ceiling 3, host/profile wait reason; no per-stage multiplication |
| Student readiness | candidate.context_loaded, candidate.requirements_missing | Document/answer revision IDs, missing-field keys, profile-binding status; no contact values |
| Source discovery | source.claimed, source.page_read, source.retry_scheduled, source.finished | Source/target ID, sanitized URL, pagination cursor hash, pages/counts, coverage status, budget use |
| Source access review | source.review_required, source.review_reused, source.review_resolved | Source/context review key/version, registration/auth/CAPTCHA/robot/unsupported reason, safe evidence reference, explicit human next action and resolution; no credentials |
| Source reuse/freshness | source.scan_reused, source.refresh_due | Original actual scan reference/time, last attempt/complete times, next due, scope/version match; reuse never resets the search clock |
| Vacancy retirement | vacancy.closed, vacancy.reopened | Verified availability evidence, observation order/time, active-work removal and retained application/history references |
| Description persistence/reuse | vacancy.description_saved, vacancy.description_reused, vacancy.description_refresh_required | Description hash/quality/version, consumer stage, refresh reason, avoided body fetch/extraction |
| Vacancy identity | vacancy.observed, vacancy.reused, vacancy.identity_review | ATS namespace/identity evidence, canonical record ID, provenance refs, reason |
| Classification | stack.decision_saved, stack.review_required | Stack description/content hashes, decision, short evidence reference, model/prompt version |
| Restriction evaluation | restriction.checked, restriction.blocked, restriction.review | Policy ID/version, decision, evaluation-context hash and explanation reference |
| Answer/CV preparation | answer.reused, answer.required, cv.prepared, form.verified | Scoped answer-version IDs, file hashes, required/verified field counts; no complete answers |
| Browser ownership | browser.ownership_acquired, browser.busy, browser.connection_lost, browser.released | Profile/session/owner references, driver/browser versions, state, lock timing |
| Application lifecycle | application.queued, application.intent_committed, application.submit_observed, application.outcome_saved | Attempt/preparation IDs, state transitions, receipt/rejection references |
| Human assistance | handoff.queued, handoff.resumed, handoff.completed | CAPTCHA/email/missing-answer/unsupported type, actor reference, explicit recorded action |
| Recovery | recovery.started, recovery.receipt_found, recovery.unresolved | Previous attempt, current evidence, allowed next action; never a guessed success |
| AI operations | ai.started, ai.completed, ai.failed | Operation/model/prompt version, tokens where returned, latency/retries, input/output hashes |
| Token policy | token_policy.approval_required, token_policy.approved, token_policy.budget_reached | Reviewed policy version/hash, human approval reference, configured limit and observed usage |
| Reuse/work accounting | cache.hit, cache.miss, cache.invalidated, work.shared, work.measured | Stage, exact input-key hash, invalidation reason, reused result reference; page/body reads, SQL calls/rows and serialized bytes |
| Infrastructure failure | storage.failed, database.unavailable, artifact.missing, diagnostic.degraded | Sanitized error class/code/stack, affected operation, retry eligibility |
| Reporting | report.snapshot_exported, report.rendered, report.failed | Edition/schema/hash, input cutoff, audience and row totals |

AI logs contain evidence references and schema-validation failures, not free-form chain-of-thought. Record provider-returned token usage; unavailable usage/cost is unknown, not zero or an invented estimate.

The token policy requires the user's manual approval as specified in [VACANCY_REUSE_PLAN.md](VACANCY_REUSE_PLAN.md). Approval records are operator-input events, never an AI-generated approval. For the existing tailoring API, report call counts and unknown token usage if the service does not return usage data.

## Browser/network evidence

- Runtime manifest: selected driver and exact package version, browser version, Dolphin profile/session reference, host and start/end time.
- Form inspection: stable field keys/types/options/required flags, with private labels or values excluded from ordinary reports.
- Saved-value verification: field-key pass/fail and attachment hash/name; do not log all candidate values.
- Screenshots: before-submit verification when needed, failure/handoff context and confirmation. Treat screenshots as private candidate evidence.
- Network markers: timestamp, method, sanitized host/path, status, relevant allowlisted response fields and request correlation. HTTP status is evidence metadata, not application success.
- Receipt: confirmation URL/message/ID where available, timestamp, attempt binding, screenshot hash/URI and confirmation kind.
- Optional deep browser traces/HTML snapshots: debug-only, access-restricted and size-bounded after redaction review. No blanket raw HAR capture by default.

Patchright diagnostics cannot rely on browser console events. Screenshots, DOM inspection, network outcomes and explicit workflow events provide the required evidence.

Mask verification inputs and sensitive UI regions before capture where possible. If an artifact cannot be safely sanitized, mark it restricted and omit it from general exports. A screenshot is not made safe merely by removing secret keys from JSON.

## Report types and formats

| Report | Audience | Contents | Formats |
|---|---|---|---|
| Preparation/readiness | Operator | Selected cohort/stacks/limits, missing descriptions, CV/contact/profile/answer blockers, target plan | Markdown, JSON; CSV readiness rows |
| Token-policy review/usage | Operator | Concrete proposed AI stages/models/prompts/limits/retries/cache rules, approval status/version, call counts, tokens where known, cache reuse and unknown upstream usage | Markdown, JSON |
| Efficiency | Developer/operator | Unique sources/pages/vacancies, required stack/student pairs, requested/executed/reused AI operations, input/output tokens where returned, cache misses/reasons, SQL round trips, bytes written/serialized, pending usage reservations | Markdown, JSON; stage counters CSV |
| Source audit | Operator/developer | Every company and source, provenance, pages inspected, final coverage, raw/unique postings, matches, access failures and next action | Markdown, JSON, companies.csv, sources.csv |
| Stack catalog | Operator | Unique vacancies by selected stack, responsibilities/evidence, review/exclusion reasons; no automatic new stacks | Markdown, JSON, vacancies-by-stack.csv |
| Student matching | Operator/private student view | Eligible/excluded/reviewed roles, policy IDs/reasons, prior-application exclusions, selected and unselected targets | JSON, CSV; concise Markdown |
| Manager campaign summary | Manager | Cohort size, source coverage, selected/prepared/confirmed/blocked/failed/unknown totals, manual assistance, next actions | Markdown, JSON summary, applications.csv |
| Individual student report | One student | Company, role, URL, application date/status, captured/reported confirmation, required action; only that student's records | Markdown, JSON; message-ready rendering |
| Failure list | Operator/developer | Every currently failed/blocked/uncertain target, stable reason, attempt, evidence and recovery action | failures.csv, failures.json, Markdown section |
| Robot-rejection list | Operator/developer | Each robot-rejected attempt, employer/ATS, eventual application state, human assistance and evidence | robot-rejections.csv/json, Markdown section |
| Human-action queue | Operator/relevant student | Missing questions, CAPTCHA/email/unsupported-form handoffs, browser ownership, unresolved submissions | actions.csv/json, Markdown |
| Source-review queue | Operator | One pending access review per source/context/reason; company/source URL, first/latest actual attempt, registration/login blocker, evidence, next action and human resolution; separate from student application handoffs | source-actions.csv/json, Markdown |
| Developer diagnostic bundle | Developer | Event timelines, adapter/driver/model versions, safe exceptions, latency/retry counts and artifact manifest | JSONL, JSON manifest, diagnostic.md |
| Report-only companies | Operator | notify_only company/role/source references and referral/context note when permitted | End section of manager/source report; JSON rows |

Separate reports may be generated from one consistent export rather than maintaining separate editable SQL totals. No new report table is proposed for v1.

Rendering and delivery are different operations. First release creates artifacts. A future explicit delivery adapter may use the existing Telegram reporting infrastructure with verified student/chat routing. Generating a report sends no messages.

## Counting rules

1. Source targets and companies have separate totals. One company may have several sources; a general aggregator may have no owning company.
2. Every company in the frozen manifest has a coverage row, including companies with no source. Unsupported/blocked/inaccessible is not zero matching jobs.
3. Raw posting observations, unique canonical vacancies and stack memberships are separate counts. A vacancy in two stacks is counted once in a global unique-vacancy total.
4. Student counts refer to explicitly selected students. Profile/CV availability counts are separate and do not imply launch readiness.
5. Each selected student/vacancy has one current application state. Report selection/batch exclusions separately from owning application rows.
6. For a batch, selected equals queued + preparing + needs_action + submitting + submitted + failed + unknown + skipped across its frozen targets.
7. submitted is further partitioned into captured_without_manual_assistance, captured_with_manual_assistance and candidate_reported_only.
8. A captured receipt after a human click is a captured success with manual assistance. A user saying they saw success, without captured evidence, remains candidate_reported.
9. Keep current application outcomes separate from historical attempt failures. A role rejected as robotic and later successfully submitted contributes one current success and one historical robot-rejected attempt.
10. Distinguish robot-rejected attempts from distinct applications ever rejected as robotic. Do not add either figure to disjoint current-status totals.
11. Imported legacy history and dry-run preparations never count as new live successes.
12. Frozen target limit measures selected distinct applications, not successful receipts. Failed targets do not free slots for replacements.
13. If fewer eligible vacancies exist than requested, report requested, selected and shortfall separately. Do not weaken stack/restriction rules to fill the quota.
14. Aggregate across batches/runs by canonical application IDs; rerendering/resuming cannot increase success totals.
15. Every report has generated_at, data_as_of, source schema versions and snapshot checksum. Mark a partial/interrupted export as incomplete.
16. Separate shared global decisions from student-specific decisions. Reusing one description for ten students is one extracted body and ten consumers, not ten vacancy extractions.

Build the export in a consistent SQL read snapshot, then render all formats from that export. Reports must remain possible when CV downloads, browsers, AI or local candidate cache are unavailable.

## Failure taxonomy and next actions

| Reason family | Meaning | Next action |
|---|---|---|
| source_inaccessible / source_partial | Listing could not be completely inspected | Report gap; re-collect in an explicit later run |
| adapter_required / no_supported_source | Source cannot currently be processed | Configure adapter/source; completed sources may proceed |
| linkedin_forbidden | Deliberately blocked navigation | Report only; never open |
| stack_configuration_required | Selected stack lacks its rule description | Configure the selected stack and create a valid scope |
| token_policy_approval_required | Token-use rules lack manual approval or changed since approval | Present the concrete policy for the user's explicit review; continue work that does not consume provider tokens |
| identity_review | Employer/posting identity is unresolved | Review binding; no automatic name merge |
| restriction_applies / restriction_review | Policy blocks or cannot be decided | Skip or request contextual clarification |
| input_required / cv_unavailable / profile_ambiguous | Student preparation is incomplete | Resolve that student's requirement |
| browser_busy / ownership_uncertain | Another workflow owns profile or recovery is unresolved | Wait/reconcile; never steal or globally clean profiles |
| validation_error / unsupported_form | Form cannot be safely completed | Correct supported input or hand off |
| captcha_required / email_verification_required | Human verification required | Preserve checkpoint and browser ownership |
| robot_rejected | Explicit employer anti-automation/spam rejection | Separate report; bounded reviewed/manual next action |
| network_error_before_submit | Proven failure before irreversible submission | Bounded retry if identity/ownership remain valid |
| unknown_outcome | Submission may have reached employer | Reconcile evidence; no blind resubmit |
| already_applied / posting_closed / company_report_only | Submission is not applicable now | Preserve history and skip |
| evidence_unavailable / report_failed | Receipt artifact or rendering failed | Repair export/evidence access; do not reapply |

Keep phase and evidence with a reason. A timeout after clicking is not network_error_before_submit. A generic error page is not automatically robot_rejected. CAPTCHA and robot rejection remain different categories.

## Redaction, retention and delivery boundaries

- Remove credentials, authorization headers, cookies, access/refresh tokens, CAPTCHA tokens, email/SMS codes and signed URL secrets before diagnostic serialization.
- Redact URL query values, exception messages, nested arrays/objects, HTTP evidence and UI artifacts; key-name masking alone is insufficient.
- Ordinary developer logs use IDs/hashes, not complete CV text, contact values, full generated answers, passwords or private restriction prose.
- Manager summaries show necessary company/role/outcome details, not student answer banks or CV contents.
- Student exports are filtered by canonical client ID before rendering. A guessed name or chat match is insufficient.
- Keep durable state valid: do not run a lossy generic log-redactor over business records in a way that corrupts required resumable values. Persist only necessary non-secret business data, and render sanitized projections separately.
- Apply configured size/retention limits to debug traces and temporary downloads. Do not automatically purge unresolved intent, current answer provenance or confirmation evidence as if they were disposable logs.
- Preserve hashes/metadata and mark unavailable artifacts explicitly if an approved retention action removes bytes.
- Do not expose private artifacts through public links merely to make a report clickable.
- Report delivery failure cannot change application results. Re-rendering must not send messages implicitly.

## Logging failure behavior

- Failure to persist business intent prevents submission.
- Failure after submission to persist a receipt leaves the durable intent unresolved; keep browser/evidence and reconcile.
- Failure to append a diagnostic event emits a minimal sanitized stderr warning and continues according to already durable business state.
- Failure to write a screenshot is recorded as evidence unavailable. Other explicit receipt evidence may still establish confirmation; do not fabricate a screenshot path.
- Failure to write a CSV/Markdown report is repairable through report regeneration.
- Logging a logging failure must not recurse indefinitely.

## Acceptance checks

Efficiency figures must include denominators: unique description versions, supplied stacks, assessed student/vacancy pairs, applicable rules and selected targets. Keep actual tokens separate from estimates and API-call counts. Compare the same fixture/scope when claiming savings; one combined call can contain more tokens than one earlier call. Deterministic reports use no AI. Do not put private full prompts or repeated complete descriptions into ordinary performance logs.

- [ ] The same snapshot produces matching Markdown/JSON/CSV totals.
- [ ] Source failures close the audit without being represented as successful scans.
- [ ] A multi-stack vacancy and a resumed batch do not inflate global application counts.
- [ ] A robot rejection followed by captured manual success appears correctly in both views.
- [ ] Legacy and reported-only successes never enter the new captured-success counter.
- [ ] A student receives no other student's contacts, CV, questions or applications.
- [ ] Secrets are absent from nested JSON, URLs, error strings and general report artifacts.
- [ ] Restricted screenshots/traces are not included in default manager/student bundles.
- [ ] Lost logs, disk-full errors and failed exports cannot cause another submission.
- [ ] Offline rendering requires neither AI/browser nor a live candidate cache.
- [ ] Event versions, deterministic artifact manifests and data_as_of make a report reproducible.
- [ ] Description extraction/fetch counts stay unchanged when another student consumes the same saved description version.
- [ ] Token-policy approval and unknown opaque-API token usage are represented accurately; absent usage is not reported as zero.
- [ ] Counters expose repeated descriptions/queries/snapshot bytes and cache invalidation reasons without publishing candidate facts or full prompts.
- [ ] Efficiency reports separate reduced provider calls from actual token/cost savings and retain unresolved usage reservations.
- [ ] Scheduler evidence proves the shared active-action peak never exceeds three, including retries, nested tasks and competing launches; parked profiles remain visible in ownership counts.
- [ ] Weekly reports distinguish actual scans from reused scans and last attempt from last complete search. Closed active listings disappear without changing historical application totals.
- [ ] Registration/login gates appear directly in the source-review queue, with other sources continuing. Pending-review projections preserve actual search times; optional login links do not create false blocks. No per-posting market AI operation exists for configured company markets.
