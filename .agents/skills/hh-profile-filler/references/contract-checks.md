# Mandatory contract and regression map

Contract version: **2**. This document describes the implemented gates, not a live HH acceptance report.
An unreadable or failed applicable check blocks dependent writes and whole-operation success. A click,
successful HTTP response or old artifact alone is never persisted-state evidence. No bypass flag exists.

## Preparation and order

| Requirement / applicability | Gate | Regression |
| --- | --- | --- |
| Every source-reading entrypoint uses PostgreSQL | `repository.ts`, `source-preflight.ts`: require postgres; compare effective configuration to the main repository runtime `.env`; existing read-only reader checks database marker/schema | `repository-routing.test.mts`, `strict-invariants.test.ts`, PostgreSQL reader tests: unset/legacy/mismatched/stale connection rejected |
| Client ID, status, market, unique profile/account, stack, final market CV | `noco-repository.ts` domain selection over SQL adapter; refresh source records before dry-run, mutation and deletion | Repository tests: missing/ambiguous selection, changed profile/status; SQL execution parity |
| Approved sources only | `profile-builder.ts`, service loads final CV only; no identity-override flag | Profile builder / CV extractor / PostgreSQL workflow tests; service override rejection |
| Actual Dolphin name and visible browser | `prepareResolved` reads API detail before HH; `hh-session.ts` passes `headless:false`; Dolphin runtime forwards it | Service preparation failure retains name; `dolphin/runtime.test.ts` inspects actual start request body |
| Fresh attempt and exclusive profile | Service consumes fresh dry-run evidence; recovery checks known IDs and stage preconditions; fixed-path atomic profile lock | Service dry-run and recovery tests; strict-invariants lock contention |
| Baseline -> content -> privacy -> verification -> native duplicate -> verification | Service validates each target before the next; reads all targets again before deletion | Service: failed baseline prevents duplicate; failed copy prevents next; corruption after duplicate prevents deletion |
| Reuse exact/legacy mapped target, no guessed extra wizard | Exact old transformation in `legacyProfessionForTitle`; multiple matches block; persistent operation ID/target journal | Service ambiguity, native-duplicate-unavailable, known-ID recovery tests |
| Preserve old resumes at HH limit | No deletion fallback; deletion only of initial snapshot IDs after all target contracts pass | Service limit and per-section failure tests retain old IDs |
| Resume after failure without losing original observations | Versioned operation and immutable preservation journals; old artifacts only locate IDs | Strict-invariants persistence; service recovery and incomplete-contract tests |
| CAPTCHA/2FA/unknown required controls/save failure | Typed UI/auth errors; no bypass or success on missing DOM | Existing HH DOM/auth tests plus contract failure gates |

## Persisted contract of each resume

`contract.ts` requires every section below. `contract.test.ts` and `service.test.ts` remove each check
in turn and prove no terminal success, following duplicate, or deletion. This is supplemented by UI
and policy cases listed below. `passed` requires observed state; missing sections do not default to pass.

| Section | Applicability and saved-state evidence | Specific regression |
| --- | --- | --- |
| title | All: exact Ru bilingual mapping or English mapping, after ID; initial wizard profession remains `Программист, разработчик` | All stack mappings; legacy title transform; observed wizard fixture |
| publication | All: ordinary creation remains draft; native copies may be published; reopen inventory/known draft | Unexpected ordinary publication blocked; old contract rejected |
| identity | All supported name/birth fields; split HH birthday controls or exact date input; absent source preserves prior value | Contract DOM and birthday normalization; missing mandatory evidence blocks |
| contacts | Saved source email, preferred-email checkbox, normalized phone; source-silent phone preserved | Contact editor DOM checks and full contract gate |
| about | Exact normalized Contacts -> Summary -> Skills from prepared CV, retaining categories/wording | Builder tests; changed About DOM fails |
| experience | Every required content/date/location record AND membership in current resume; preserve unrelated records | Content-policy mismatch; observed membership checkbox/reopen tests |
| education | Required content and membership; retain unrelated selected records | Education selection/preservation DOM tests; missing section gate |
| languages | Required English CV -> DB -> B2; recognized additional languages; read saved card levels | Language policy and nested HH language-card DOM tests |
| skills | Exactly 30 distinct saved tags and Advanced for each of those same 30 after reopening | 29 tags; 29 levels; missing source candidates; tag loss/restore/stop; correct 30; matching state no rewrite |
| resumeLanguage | En: resume-scoped `In English`, persisted English evidence; already-English skip; new ID tracked | Synthetic DOM: conversion/new ID, already English, footer button rejected |
| location | En Tbilisi; Ru approved source or unchanged prior value | Full reader and required-section gates |
| permits | En exactly Georgia/Serbia/Armenia/Kazakhstan; Ru explicit `not_applicable` reason | Existing batch checked-country set tests |
| workPreferences | Business trips ready; office/remote/hybrid persisted | Existing work preference DOM tests |
| privacy | Blacklist visibility, Anonymous enabled; phones hidden; names/photo, email, other contacts, experience visible | Exact switches and mandatory flags; no success from click alone |
| employers | Every candidate accounted; existing selections retained; each addition saved/reopened separately | Employer tests: selected/ambiguous/not-found, search unavailable, checkbox lost |
| preservation | Immutable original hashes of source-silent fields, skills and unrelated experience/education; original employer selections | Persistence test; contract-section gate; education selections preserved |

Only a missing/ambiguous official employer card is a permitted `exception`, with a local reason per
candidate. A unavailable search or unchecked saved candidate is failure. Ru permits are explicitly
not applicable; an absent field/control is never an applicability exception.

## Finalization, recovery and reporting

| Requirement | Gate and regression |
| --- | --- |
| One source of `operationComplete` | `verifyOperationContract`: version, all sections, expected unique titles/IDs, identical observed content fingerprints, exact final ID inventory. Contract tests cover old/missing data, duplicate IDs, different content and extra inventory. |
| Stage boundary | Experience/skills/verify-final never repair privacy or delete; complete scoped work with old inventory is not whole-operation completion. Service tests cover all recovery scopes. |
| Queue | Validate terminal contract before completed; preserve watermark/status cancellation/3 attempts/24h. State-store/pending-runner tests cover transitions; reporter failures are caught after completed state. |
| Smoke | Both configured IDs must match before browser; initial snapshot and cleanup on success/error; local result only. Service smoke tests and reporter guard. |
| Task isolation | Separate Profile Filler process/task, 12:00 Europe/Warsaw; registration rejects incompatible Windows time zone. Process-isolation tests inspect wrapper; development does not register tasks. |
| Report | Shared formatter for result paths, exact Dolphin name, client name scrubbed from reason, unresolved profile explicit. Format tests cover success/error and old incomplete success rejection. |
| Exactly once delivery intent | Journal keyed by operation ID before sending; sent skips; unknown refuses retry. Strict-invariants tests simulate duplicate finalization and timeout. Report errors never restart filling. |

## UI workflow

1. Resolve approved SQL/CV inputs and actual Dolphin name; start a visible, locked session. Inspect HH
   login, required controls and existing resume inventory. Stop on authentication challenges.
2. Snapshot old IDs. Locate the unique mapped/legacy primary resume. For a new one open the normal HH
   creation wizard, select `Программист, разработчик`, fill approved fields and obtain the draft ID.
3. Use the ID-specific editors: profession, contacts (preferred email), About; profile experience and
   education cards with resume membership; languages; skill tags and all levels; common location/permits;
   work preferences. Read before writing, save only differences, reopen to verify.
4. For En, open that resume and click its own `In English` only if not already English. Track any new
   ID, reopen and verify language. A publication requirement or unrecognized language evidence stops.
5. Open visibility, choose everyone except selected employers. Enable Anonymous, hide phones only.
   Search each employer individually, select one unambiguous official card, confirm/save, reopen and
   verify its checkbox. Keep previous selections.
6. Read the full contract. Only then open the verified baseline's native `Дублировать` action for the
   next missing mapped variant; set its title, verify its content/language/privacy, then proceed.
7. Reopen and check all variants together. Delete eligible old snapshot IDs only after this succeeds;
   reread final inventory. Limited recovery that cannot finish this step has no whole-operation success.
8. Persist the versioned result. Only terminal operations use the common report and delivery journal.

## Validation boundary

Tests use local fixtures and injected adapters; they do not access real accounts, send messages,
change ENV files or register Windows tasks. The new language-conversion fixture is synthetic because
no captured resume-level language DOM was available in the repository. Runtime accepts only its
explicit observed controls/evidence and stops on other layouts. Live compatibility of `In English`
and simultaneous 30-tag/30-Advanced persistence remains unverified; this is never an exception to
the contract. Refresh sanitized observed fixtures before asserting live acceptance.
