---
name: hh-profile-filler
description: Fill and replace HH resumes in Dolphin from final Google Drive CVs and read-only data from the current authoritative PostgreSQL database. Use when Codex is asked to prepare, dry-run, run, schedule, supervise, diagnose, or report HH profile filling by client/status/market, including About, privacy, employer stop-lists, resume duplicates, and password login.
---

# HH Profile Filler

Operate the repository implementation in `src/features/hh-profile-filler`. Keep application data read-only.

## Storage

- Always use the current authoritative PostgreSQL application database, read-only, through the existing
  SQL reader in `repository.ts`. Require `APP_DB=postgres` for preparation, filling, recovery, diagnostics,
  scan/pending and live smoke. The legacy Noco code path is not an allowed data source for this skill.
- Before resolving a client or interpreting its status, perform the
  [PostgreSQL source preflight](references/operations.md#postgresql-source-preflight). `APP_DB=postgres`
  and a successful connection alone do not prove that the database is current. Do not use an archive,
  restored snapshot or stale replica in place of the authoritative database, including the previously
  observed stale `unicorn_noco_copy_restore` connection. Do not guess the correct endpoint by renaming it.
- If the current PostgreSQL connection cannot be identified or read, stop with a source-configuration
  blocker. Never fall back to NocoDB, an old dump, cached artifacts or another database to continue a run.
- Resolve `--client-id` and all related records in that same verified PostgreSQL source; verify identity
  before reusing IDs from previous runs. Do not mix client status, accounts or CV metadata across sources.
- CV files still come from Drive. Queue state and artifacts remain local files, not SQL records.
- The legacy `--use-noco-identity` flag is rejected. Identity conflicts must be resolved in approved sources before preparation; the flag cannot bypass validation.
- Use the existing SQL connection settings from the runtime. Do not change the database schema or create a second client for this feature.

## Safety invariants

- Resolve the client by numeric record ID and market; never guess between duplicate names.
- Require current `client_status` to match `on ru market` or `on en market`.
- Require a final CV with status `moved to filling` or `filled`. If it is missing, make no HH changes.
- Treat CAPTCHA, 2FA, unknown mandatory fields, missing/ambiguous stack/profile/account, and rejected credentials as typed failures. Do not bypass them.
- Never log passwords, Noco tokens, Dolphin tokens, raw CV bytes, or full credentials.
- Run the full wizard live smoke only against the dedicated test target explicitly allowlisted by both
  `PROFILE_FILLER_SMOKE_CLIENT_ID` and `PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID`. Snapshot existing resume
  IDs first, never publish, and delete only IDs created during that smoke in a `finally` cleanup. Never use a
  production client as the smoke target and never send smoke results to Telegram.
- Never start autoresponses. Do not publish a newly built resume. A title variant made with HH's native
  `Duplicate` flow may be published by HH when its profession is saved; allow that only after the filled
  baseline was verified and the mapped variant is missing.
- Snapshot old resume IDs/titles before replacement. Create and verify replacements before deleting old resumes, without exceptions for the HH resume limit. At the limit, stop and preserve every old resume.
- Use the shared operation reporter for one terminal report per operation, through the existing reporting
  session to `summary_logs_channel_id`. Every user-facing final report identifies the actual Dolphin profile
  name returned by the read-only Dolphin API. Never construct that name from client/stack fields.
- Success requires contract version 2 and verified `operationComplete=true` for every mapped title.
  Format: `✅ HH Profile Filler\nПрофиль Dolphin: <actual_name>\nПолучилось заполнить.`
- Failure format: `⚠️ HH Profile Filler\nПрофиль Dolphin: <actual_name>\nНе получилось заполнить.\nПричина: <safe_reason>`.
  Never add the client name separately or repeat it in the reason. Preserve the actual Dolphin name even
  when that name itself contains a person's name, stack or market. An unresolved profile is explicitly
  reported as `не определён; заполнение не начиналось`; do not fabricate a name.
- Use `--defer-telegram` for supervised attempts and `--report-result <result.json>` only at terminal
  completion/failure. No intermediate, dry-run or smoke reports. Delivery is tracked by operation ID,
  independently of artifact filenames. Unknown delivery blocks automatic resend; report failure never
  reruns HH mutation. Keep IDs, credentials, stop-list details and intermediate errors out of Telegram.

## Mandatory execution contract

- All applicable rules are enforced in the shared execution and verification path. Unknown or unreadable
  state is failure, not success. Do not bypass guards using ad-hoc scripts, direct UI helpers, ENV flags,
  alternate data sources, or old artifacts. Use the repository service/CLI entrypoints.
- Before changing each field, read it. Save only a mismatch supported by approved sources, reopen and
  verify persisted state. Check primary content, privacy and preservation before the first duplicate;
  check each duplicate completely before starting another. Preserve completed work after failures.
- The contract covers title, publication, identity, contacts, About, experience content/dates/membership,
  education/membership, languages, all skill tags and levels, resume language, location, permits, work
  preferences, exact privacy switches, employer candidate accounting and preservation of existing data.
- Require exactly 30 distinct persisted HH skill tags and Advanced for every one of those same 30 tags.
  Existing tags count and must be preserved; new tags require CV support and exact catalog matches or
  approved aliases. Never invent skills. Fewer than 30, missing levels, a five-skill featured subset, or
  unreadable persisted state blocks success. If saving levels discards tags, restore and verify the
  previous saved set, then stop. Restoration is not completion of the original operation.
- Each section reports passed, failed, justified not-applicable, or an explicitly permitted employer
  exception. Only missing/ambiguous official employer cards may be skipped with recorded reasons.
  Unavailable employer search and a lost checkbox are failures.
- Before each attempt, verify current source/status and perform a fresh dry-run. Recovery validates its
  stage prerequisites without replaying prior stages. Limited recovery never repairs unrelated sections
  and never reports whole-operation success if any full-contract check is missing.
- Lock the Dolphin profile locally for the browser session. An existing lock blocks a competing run.
  Inspect an interrupted session before manually removing its stale lock; never steal it automatically.
- Read [contract-checks.md](references/contract-checks.md) when changing enforcement or testing it.

## Commands

- Run the PostgreSQL source preflight before any command below; do not launch a data-reading command
  with an unset/non-PostgreSQL `APP_DB` or an unverified database connection.
- Start Dolphin in headful mode (`headless: false`) for every Profile Filler dry-run and fill so the live
  HH interaction remains visible to the operator.
- One client, live dry-run: `npm run profile-filler -- --client-id <id> --market ru|en --dry-run`
- Dedicated test profile, full wizard live smoke: set `PROFILE_FILLER_SMOKE_CLIENT_ID` and
  `PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID`, then run
  `npm run profile-filler -- --live-smoke --client-id <test-id> --market ru|en`. This creates an unpublished
  temporary draft, traverses the wizard through experience, verifies it, and removes it.
- One client, dry-run then real fill: `npm run profile-filler -- --client-id <id> --market ru|en`
- Resume a known incomplete first-title draft that HH no longer exposes in its list: add
  `--resume-id <draft-id>` from the sanitized local profession-state artifact. Never guess this ID.
- When artifacts and the visible HH draft confirm that every earlier section is complete and the run stopped
  at work permits, resume that exact draft with `--resume-id <draft-id> --resume-from work-permits`. This
  stage-specific recovery must not re-run earlier filled sections; other target drafts still use the normal flow.
- When every mapped target draft is present and confirmed complete and the operation stopped on privacy, use
  `--resume-from privacy`. Require every target by exact mapped title and draft status, open each direct
  `/resume/edit/<id>/visibility` route, and do not reopen the unfinished wizard or reprocess resume content.
- When a run completed and verified privacy for every target and then stopped before deleting an old resume,
  use `--resume-from delete-old`. Require every exact mapped target to remain an unpublished draft and skip
  all filling and privacy mutation before attempting the old-resume deletion and final verification.
- After the last published resume is deleted, HH may redirect every list/profile URL into one unfinished
  wizard. For final recovery, pass all known target IDs in mapped-title order with
  `--resume-ids <id1,id2,...> --resume-from verify-final`. Read the exact title from each safe position editor
  and require each ID to open an unfinished draft wizard; do not mutate content, privacy, or deletion state.
- To repair experience in known existing drafts without recreating them, pass every target ID in mapped-title
  order with `--resume-ids <id1,id2,...> --resume-from experience`. Add missing CV experience records,
  select the required cards separately for every draft, reload and verify the checked state, and do not
  change privacy, delete resumes, create drafts, publish, or send an intermediate Telegram report.
- Multi-attempt supervised fill without intermediate Telegram: add `--defer-telegram`; after the terminal
  result run `npm run profile-filler -- --report-result <artifact-result.json>` exactly once.
- Recovery results are scoped. Treat `stage=recovery_completed` as final only when the result also contains
  `operationComplete=true`, produced by the read-only full resume contract verification. Never report a
  successful result whose `operationComplete` is absent or false.
- The legacy `--use-noco-identity` override is rejected by the execution service. It cannot disable
  source-identity checks; an approved source correction must precede a new preparation.
- Scan status transitions only: `npm run profile-filler:scan`
- Scan and process pending jobs: `npm run profile-filler:pending`
- Tests: `npm run profile-filler:test && npm run typecheck`

The ordinary `--dry-run` remains read-only. Use `--live-smoke` only for the allowlisted test account when a
real HH DOM regression must be detected before production filling. Browser DOM regression tests use the
sanitized observed-state fixture in `tests/fixtures/hh-wizard-observed.html`.

The pending runner uses the fixed initial watermark `2026-09-03T15:53:37+02:00`, records later status transitions locally, performs a live dry-run before mutation, and retries failures once per day for at most three attempts.

## Source and field policy

Read [field-policy.md](references/field-policy.md) before a run that fills HH. Read [operations.md](references/operations.md) before scheduling, supervising, or diagnosing the runner.

Use the final CV first and fields from the selected repository only as fallback. Build employer stop-list
candidates from the comma-separated `clients.stop_list_company` value plus employers and explicitly named
organizations in the final CV. Split the repository field only on commas, trim and case-insensitively dedupe
the values. Do not load or parse `Самопрезентация` or `Описание опыта` files for Profile Filler. Add only
unambiguous official HH employer cards and report missing or ambiguous candidates without stopping.

For En always set `Tbilisi, Georgia` and select work permits through the Russian HH UI using exactly
`Грузия`, `Сербия`, `Армения`, and `Казахстан`. For both markets set business trips ready,
on-site/office + remote + hybrid, preferred contact email, hide structured phone numbers, and visibility
to everyone except the employer stop-list. Build About in Contacts → Summary/About → Skills order.
Require exactly 30 persisted tags, all Advanced, in the same reopened resume state. Never accept a
smaller stable server set or fewer levelled tags as completion.

Never enumerate the entire HH country list one option at a time. Read all currently checked work permits in
one browser-side batch, compare that set with the four required Russian names, and click only selected extras
or missing targets. If the set already matches, close the selector without changing or saving it.

HH uses a Russian site interface in both Ru and En Dolphin profiles. Treat `market` as the language of
resume content and market-specific values, not as the HH UI language. Use Russian UI labels and search
terms for HH controls and taxonomies, including profession specializations, unless the live page itself
shows another language; never derive UI label language from `market`.

Use the exact stack title mapping implemented in `stack-titles.ts`. Ru titles retain the ENTIRE mapped
string, including the slash and English part, original spelling and case. Do not translate Backend,
Frontend or Fullstack within that string. En titles contain only the English mapped title. The malformed
Go En fragment `S` remains absent. Reuse one unambiguously matched old shortened title and rename it;
ambiguous matches block the operation without creating another copy.

For `on en market` in its linked Dolphin En profile, convert every target resume using the resume's own
`In English` action. This is not the site-language selector. Reopen and verify saved resume language;
English CV text and disappearance of the button alone do not prove conversion. Skip the action only if
English is already verified. Track a new language-version ID if HH creates one and verify its title,
content and publication state. Never publish an ordinary draft to unlock conversion. Unknown controls
or unverified conversion block success. Read-only and unrelated recovery modes verify without conversion.

Before changing any HH field, read its actual current value. Skip an exactly matching scalar or complete
set without clicking or entering it again. Correct a mismatch only from the final CV or an allowed repository
fallback. If a field is already populated and the approved sources are silent, leave it unchanged. Do not
duplicate matching experience, education, language, or skill records.

For employer privacy, preserve already selected employers and add only missing candidates. Process one
candidate per save transaction, reopen the direct visibility editor, search that candidate again, and require
its real checkbox to remain selected before continuing. A transient selection that does not persist is a
typed failure, not a skipped employer.

## Resume title variants

- Build the complete title set for the resolved stack and market from `stack-titles.ts`.
- Process resumes strictly sequentially: fully complete and verify one primary-title baseline first,
  then create its title duplicates one at a time. Never create all target drafts before configuring privacy.
- Create or reuse the primary-title baseline and finish all source-supported content, contacts, About,
  experience selection, education, languages, skills and supported levels, work preferences and permits.
  Then configure anonymity, hidden structured phones, visibility and the employer stop-list. Reopen the
  saved sections and verify the full per-resume contract, including persisted employer selections and
  candidate accounting, before starting any duplicate. A saved draft ID or completed content alone is not
  a completed baseline. Keep an ordinary baseline unpublished; completion does not authorize publication.
- In the initial HH creation wizard, for every stack and both markets, enter and select exactly the Russian
  profession `Программист, разработчик`. Never enter an English or mapped final title on that screen.
  In `Уточните специальность`, search `разработчик` and select exactly `Программист, разработчик`, checking
  the real hidden radio/checkbox state. Only after HH assigns the draft ID, set the mapped final title through
  the safe partial profession editor and verify the exact saved title without publishing.
- When a primary-title baseline already exists, preserve it, finish any missing settings and verify it
  against the same full contract before duplication. Create only missing title variants from that verified
  baseline with HH's native `Duplicate` action. Reuse an incomplete draft whose profession matches a target
  variant instead of creating a second draft.
- Every variant must contain the same contacts, About, experience, education, languages, skills, skill
  levels, work preferences, anonymity, and employer stop-list. Only the resume title changes.
- For each duplicate, save its mapped title, check all copied fields and privacy settings, correct missing
  values, and reopen to verify the full per-resume contract before proceeding to the next title. Do not
  assume that HH copied visibility, hidden-phone state or employer selections correctly.
- If the baseline cannot be completed or verified, stop before creating variants. If duplication or a
  variant check fails, retain the completed baseline and verified variants; recover the current variant
  before starting another. Do not bypass a blocked native duplication flow by opening additional creation
  wizards or publishing the baseline. Record the blocker without claiming the whole operation succeeded.
- When a resumed wizard step is already filled and HH shows no explicit validation or verification request,
  wait for the asynchronous transition and retry `Сохранить и продолжить` once instead of failing
  immediately. Do not jump directly to another URL or bypass an explicit HH validation error.
- Set each duplicate's initial profession to `Программист, разработчик`, select that same Russian
  specialization, and apply its mapped final title only after obtaining the duplicate ID.
  The native duplicate flow can publish on `Save and continue`; this is permitted only for these verified
  title variants. Continue to use safe partial-edit routes for ordinary drafts and never publish them.
- Verify the baseline and every configured title before considering the run successful. Never remove the
  baseline merely to make room for another title unless the user explicitly authorizes replacement.
