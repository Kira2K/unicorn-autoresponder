# Shared vacancy selection, stored descriptions and token approval

Planning clarification from the user's request. Runtime changes below are TODO; updating this document or the skill does not implement them. Links: [full TODO](IMPLEMENTATION_TODO.md), [SQL](SQL_PLAN.md), [logging](OBSERVABILITY_PLAN.md).

Follow-up: [EFFICIENCY_PLAN.md](EFFICIENCY_PLAN.md) adds output-sensitive complexity, bounded multi-stack requests, exact-input caching, incremental writes and measurable token-use proposals. Cache keys must include all consumed title/location/employer/rule/fact metadata, not just the description hash. No proposed inference policy is approved by either document.

## Two decision layers

| Layer | Inputs | Output | Forbidden dependency |
|---|---|---|---|
| Global vacancy selection | Source content, existing populated stacks, stored stack descriptions, explicit common selection rules | Shared pass/reject/review decisions and matched stack IDs, bound to stored description/rule versions | One student's CV, contacts, preferences or application history |
| Local student–vacancy consideration | Saved vacancy description/global decision, current student facts, stack membership, restrictions and history | Eligible/blocked/review for this student; preparation using that same saved description | Re-crawling/re-extracting the posting just because another student is being assessed |

Global selection covers the collection and stack-classification folders; these remain separate implementation stages. Every company/source must reach a recorded terminal outcome before the shared vacancy pool is finalized for applications.

Hard rules are binding stored requirements, not a ranking hint and not hardcoded keyword branches. An explicit rule such as "exclude junior roles" may reject a role whose advertised level is junior. A senior role mentioning mentoring juniors must not be rejected for containing the word. Mixed/unknown levels require evidence or review.

"No junior" is an example to represent explicitly when configured, not a new rule silently inserted into the database by this document. Existing stack descriptions already provide their own seniority requirements.

For a vacancy to enter the usable global pool:

1. The description is complete text with explicit employer/posting identity and acceptable source coverage.
2. Every applicable common global-selection rule passes.
3. At least one selected existing stack matches its description.

Reject if a mandatory applicable rule fails or all selected stacks are excluded. An unresolved common rule cannot be bypassed by a stack match. If no stack matches and at least one is unresolved, the result remains review. Matched and review stack groups can coexist for different stacks.

Version the classification contract: save a common-rule outcome for every sufficiently described, covered vacancy; the expected stack-decision pairs are the common-rule-passed vacancies × selected stacks. Common-rule rejected/review roles stay in the global audit, not silently missing from completeness counts. Cheaply rejected listings retain their listing evidence and reason without requiring an unnecessary body fetch.

Shared vacancy rules now live in the editable [.agents/skills/vacancy-selection/SKILL.md](../../../.agents/skills/vacancy-selection/SKILL.md). The runtime evaluates that file before stack matching and canonical persistence and stores its text/hash plus outcomes in classification JSON. This replaces the proposed SQL evaluation-stage column. Existing student-context restrictions, including ones applying to all students, remain in the personal stage; authorization/residence rules can still require individual confirmed facts.

Global-selection rules may read only vacancy/company/source context and selected stack requirements. A rule that needs student context is invalid in that stage and must be reviewed/reclassified, not guessed from one student's data. Runtime validators and the rule editor must enforce this boundary.

## Extract once, checkpoint discoveries, save accepted roles to SQL

~~~mermaid
flowchart LR
    Sources["Process all sources"] --> Gate["Cheap explicit rule checks"]
    Gate --> Text["Extract complete posting text"]
    Text --> Audit["Checkpoint raw observations for resume"]
    Audit --> Global["Shared rules and stack decisions"]
    Global -->|Passed at least one stack| DB["Save accepted description and matched links in SQL"]
    Global -->|Excluded or review only| Rejected["Audit only; no vacancy row"]
    DB --> Pool["Finalize usable pool after all sources finish"]
    Pool --> Local["Student restrictions and history"]
    DB --> Local
    Local --> Tailor["Existing AI-tailor API"]
    DB --> Tailor
~~~

- Apply only decisive, structured/verified cheap checks before full body extraction. Uncertain listings need the body, not a premature keyword rejection.
- Normalize the posting body to readable text, keeping headings, lists, responsibilities, requirements, seniority, location/remote terms, salary/authorization and application instructions.
- Remove image/video/embed payloads, scripts, styles, trackers and navigation chrome. Do not discard textual requirements merely because they discuss an image/video interview.
- Store the complete readable body in noco.vacancies.description TEXT only after shared selection passes and at least one selected populated stack matches. A generated summary cannot replace it.
- Checkpoint raw page bodies incrementally during collection. Resume and classification consume saved observations without another crawl; canonical vacancy rows are promoted after classification, before student matching or CV preparation.
- Correction: excluded, review-only and missing-description discoveries must not enter noco.vacancies at all. They remain audit/checkpoint evidence, including the immutable collection/classification JSON, without canonical vacancy/stack-link rows. A matched vacancy gets links only to its matched stacks. Do not create unrelated L1-support/PHP/etc. vacancy rows merely because a crawler encountered them; use configured stack requirements, not a hardcoded title blacklist.
- Require the accepted vacancy's complete body/hash to be committed before its global pass/stack links are usable.
- Save description hash, extraction version, source URL and fetched timestamp alongside the text. A complete flag requires extraction coverage evidence, not merely nonempty text.
- Keep historical body versions in the existing immutable run/source observations. Vacancy rows expose the latest complete body; a preparation references the exact version/hash it used.
- Failed, truncated or older delayed observations cannot overwrite a newer complete description. Persist the failed observation separately.
- Image/video-only content without an available text body becomes missing/partial and review; no invented description.

Global classification, local student checks and AI tailoring read the stored body. Adding the second or hundredth student must not trigger another posting download or AI extraction for the same valid description version.

Full text stays in SQL even if the approved inference policy uses selected excerpts. Excerpting, truncation, summarization or chunking for a model must be explicit, versioned and manually approved; silently cutting requirements can change eligibility.

## Freshness without re-extracting per student

Keep posting availability checks separate from description extraction. Opening the actual application form before submitting is still necessary; it does not authorize an unconditional body extraction/AI call.

Re-extract only under an explicit refresh condition: missing/incomplete saved text, a configured freshness rule, evidence that the source content changed, or a manual refresh. Prefer available source revision/ETag/modified-time signals before a full fetch; many sites do not provide them, so do not promise change detection without requests.

An availability/readiness check does not advance description_fetched_at. If content changes, save a new description hash and invalidate the affected global decision/local evaluation/tailoring cache. Preserve previous prepared/submitted snapshots.

SQL-only local matching and tailoring preparation must work with the posting host unavailable when a valid saved body exists. This does not authorize submitting to a closed or unverifiable form.

## Reuse the existing tailoring service

The repository already defines CvTailoringService.tailorFromPdf with:

~~~text
input:
  fileName: string
  mimeType: string
  fileBuffer: Buffer       // approved original CV
  jobRequirements: string // saved complete vacancy description
output:
  url: string
~~~

Current implementation is in [web-console/backend/app.ts](../web-console/backend/app.ts), with regression fixtures in [app.test.ts](../web-console/backend/app.test.ts). The service sends PDF bytes and jobRequirements to the configured tailoring endpoint and returns a URL.

- [ ] Reuse/expose that transport through a small injected adapter; do not import the web server or invent a second tailoring service contract.
- [ ] Feed jobRequirements from the selected saved SQL description snapshot; a vacancy URL alone is not the service input.
- [ ] Verify that saved body/hash and the intended student CV are present before making the call.
- [ ] Preserve the returned artifact reference and validate accessible content/type before attachment. A returned URL alone does not prove a valid PDF.
- [ ] Cache successful tailoring by student CV hash, description hash and the approved service/request/processing version. New student/CV or changed text requires its own result.
- [ ] Do not silently regenerate on timeouts/ambiguous remote results. Record whether retry is allowed by the reviewed API/token policy and reconcile any available request/result reference.

This reuse path does not require visiting the posting page again or calling AI to extract the same description.

## Mandatory manual review of token-related rules

User instruction: the operator must manually verify and explicitly approve all token-related rules before they are activated or changed. Here token-related means model/API usage and cost behavior, not ATS board identifiers or authentication tokens.

The feature/skill must present a concrete policy version covering:

- Which stages may call AI or the tailoring API, including any extraction and verification.
- Provider/model choices, fallback/model escalation and prompt versions.
- Input/output limits; excerpt selection, summarization, truncation and chunking.
- Calls per vacancy/student/stage/campaign, retries and recovery after ambiguous requests.
- Caching, invalidation, reuse and batch grouping.
- Parallel workers/delegation, concurrency and campaign usage/cost caps.
- Behavior at budget exhaustion and when upstream token usage is unavailable.

No silent defaults, self-approval, or automatic policy expansion. Approval of job selection or applications is not approval of an unspecified token-use policy. Existing explicit approval remains valid for the identical reviewed policy version; do not ask again for every vacancy.

Record the reviewed policy reference/hash, version, approving user, approval timestamp and supporting confirmation reference in run.scope.token_policy. Token policy content lives in a versioned configuration/document; a new database table is unnecessary.

- [ ] Add a preflight guard before token-consuming stages. Unapproved/changed policy pauses those stages with token_policy_approval_required; deterministic parsing, SQL reads and reports may continue.
- [ ] Require renewed approval for material changes to any field above. A reduced input budget can remove evidence, so it also needs review.
- [ ] Meter direct provider usage where available. For the existing opaque tailoring API, report API call counts and token usage as unknown unless returned by the provider; never equate missing usage with zero.
- [ ] Present request/call caps and unknown upstream usage honestly during policy review; do not claim a strict downstream token ceiling the client cannot enforce.
- [ ] Log the approved policy version, calls, cache hits/misses, retries and approval-required pauses.

This is a future runtime gate and a current skill instruction. No token policy values are approved by this planning edit.

## Acceptance cases

- [ ] Process a complete posting once, save its text/hash, then assess two different students with zero additional body fetches/extractions.
- [ ] Call the existing tailoring adapter with the approved CV and exactly the saved jobRequirements text; no posting-page request is needed.
- [ ] Crash after one source finishes: its saved description survives and can be used on resume.
- [ ] Senior vacancy mentioning junior mentoring passes an enabled no-junior check; an actual junior vacancy fails.
- [ ] A global-selection rule requiring student residence is rejected as mis-scoped; global rules never consume one candidate's CV.
- [ ] A student-specific block excludes only that student; the shared vacancy remains available for other eligible students.
- [ ] Changing a stack/global rule reevaluates stored text without fetching it again.
- [ ] Changing the posting body invalidates only decisions/artifacts tied to the old content version; prior submission evidence remains unchanged.
- [ ] Refresh failure cannot replace a complete description with an empty/partial body.
- [ ] HTML images, video payloads and scripts are absent from the stored description; substantive textual requirements remain.
- [ ] Availability checks do not masquerade as description refreshes.
- [ ] Unapproved token configuration results in zero calls to token-consuming providers; identical approved policy can be reused, changed policy requires review.
