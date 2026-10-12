# Local student–vacancy consideration

Use this phase only after a shared vacancy has saved complete text and a valid global/stack decision. Read global-selection.md for collection; do not rerun it once per student.

Eligibility inputs: canonical student ID/current stack membership, saved vacancy/global/stack decisions, restrictions/history, confirmed facts and explicit higher-title permission metadata from a CV/student rule. General CV content is not an eligibility input. CV bytes and experience-fit assessment remain outside matching; the narrow permission exception must not become CV scoring.

1. Load the vacancy body and selection evidence from SQL/the immutable saved collection. Another student is not a reason to open the posting page or re-extract the body.
2. Verify the student belongs to one of the vacancy's matched stacks and the global rule/description versions are still applicable. A vacancy is reusable across all of its matched student cohorts; being selected for one stack does not consume it for another. Application history still uses the student/vacancy pair, so two stack paths must not send the same student twice. Changed rules can be reevaluated using stored text in a fresh classification; never edit a frozen decision in place.
3. Evaluate personal policies after current shared selection passes. Above-Senior positions are rejected by the shared selection skill; legacy student seniority permissions cannot override this ceiling. Otherwise matching stack plus no applicable restriction means eligible. Do not add CV-fit scoring or silently import old preferences.
4. Use clear/block/review with policy IDs and evidence. Unreadable/ambiguous policies require review, not assumed eligibility.
5. Check canonical student/vacancy application history and report-only company routes. Unknown prior submissions require reconciliation. Matching titles alone are an ambiguous historical clue.
6. Freeze selected target identities/limits. Prepare scoped answers using [application-answer-policy.md](application-answer-policy.md), then use the same saved description for tailoring. This preparation step may read the student's SQL/CV and apply operator defaults; neither becomes an additional eligibility check. Eligibility does not immediately submit: preparation and authorized live application are explicit later calls.

## Rule sources and application gates

Use `external:responses match` → explicit target selection → `prepare` → authorized `apply --live`. Load the classification with `--collection-run RUN_ID` or its saved `--collection` export. Supply the real `--student DB_ID`, matched `--stack stack-ID` and restriction `--market en|ru`; never relabel a student to force a match. See [student matching](../../../../src/features/external-responses/candidate_matching/README.md) and [applications](../../../../src/features/external-responses/applications/README.md).

| Decision | Authoritative source |
|---|---|
| Shared vacancy rules | [vacancy-selection/SKILL.md](../../vacancy-selection/SKILL.md); reuse the saved result and verify the active rule hash |
| Stack requirements and membership | Existing `noco.stacks.stack_description` and the student's existing stack relation; the DB loader rechecks both |
| Personal/contextual and company restrictions | Existing `noco.client_company_restrictions_from_stop_companies`, its native company links, `noco.clients.stop_list_company` and the existing HH global list, through `createPostgresRestrictionPolicy` / `readPolicies` |
| Report-only companies | `noco.companies.application_route`; include `notify_only` matches in reports, never submit or automatically notify someone |
| Sent, skipped or uncertain applications | Current SQL-backed application history and imported evidence; `applied-list.md` is not the campaign's authority |

The working database uses the original restriction sources after migration 005. Do not create or author rules in the removed `company_restrictions`, `active_restrictions` or `client_company_summary` objects; historical compatibility code is not a new rule editor. Do not copy policies into `profile.md` or hardcode employer/location strings in this skill. Contextual instructions are interpreted with evidence from the saved posting and confirmed facts.

The CLI verifies the current selection-rule hash before matching/preparing/applying. Applications reload the existing restrictions before opening, filling/uploading and submitting; a previous `eligible` result is not permanent clearance. A changed rule/stack description requires reclassification, and an unreadable/incomplete/ambiguous personal policy produces review. Do not bypass these gates by calling the internal ATS executor, supplying `reviewOverride`, editing `fit`, or switching to offline/file history. A complete empty personal restriction set permits a stack match without an extra CV-fit score.

Vacancy market follows description language (English -> Global; Russian -> Ru); the previous company-market rule is superseded. The sequential SQL application workflow verifies the student's current market, stack and matching Dolphin profile, and rechecks that routing at restriction gates. Every source must have a terminal outcome, but complete accepted postings from partial/inaccessible campaigns remain usable; preserve the coverage gaps in reports.

The shared tailoring adapter sends the approved original CV plus the saved complete description as jobRequirements. The application workflow uploads only the bound per-vacancy result, preserving original/result hashes, description hash, result reference and policy version. A consumed generation request is not automatically repeated on resume. Deep semantic and visual checks remain test-only.

Only authorized apply mode fills/uploads/submits forms. Draft/dry-run may inspect forms without filling or uploading. The sequential SQL workflow uses the student's market-matched Dolphin profile through shared lifecycle/ownership helpers and Patchright CDP. Busy profiles are deferred without takeover, stop or a failed application; continue other students. Drive intake and cross-machine ownership coordination remain TODO. Never open LinkedIn or lnkd.in.

Pre-submit availability/form checks remain necessary and are separate from body extraction. Re-extract only for missing/incomplete text, explicit refresh policy, material content-change evidence or manual refresh. A failed refresh cannot erase a complete saved body.

Required values not resolved by student data or the configured answer policy, unsupported forms, CAPTCHA/email verification and uncertain receipts become explicit handoffs. Covered policy defaults do not require another question; retain their assumption provenance separately from verified facts. Retain confirmed versus candidate-reported receipt evidence and manual-assistance provenance. Failed targets do not authorize replacements.

Output: student-specific eligibility/reasons and preparation/application state referencing the shared description version. One student's rejection must not remove a vacancy from the global pool for others.
