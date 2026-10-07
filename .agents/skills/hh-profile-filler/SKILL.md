---
name: hh-profile-filler
description: Manually fill and replace HH resumes in Dolphin from final Google Drive CVs and read-only application data (PostgreSQL or Noco). Use when asked to prepare, dry-run, fill, supervise, diagnose, or report HH profile filling for a specified client and market, regardless of client status, including About, privacy, employer stop-lists, resume duplicates, and password login. Do not schedule filling or trigger it from database status changes.
---

# HH Profile Filler

Operate the repository implementation in `src/features/hh-profile-filler`. Keep application data read-only.

A manual production fill means complete, publish, and activate every mapped resume, unless the user
explicitly requests drafts only. A saved draft is an intermediate checkpoint, never successful completion.
Finish the filled wizard after verifying content and privacy, then read HH's server state for each exact
resume ID/title. Require a supported active status and `isSearchable: true`. Do not infer activation from
a saved title, an existing resume URL, a successful click, or the absence of a draft label.

Mandatory post-publication step, in both Ru and En: set the HH job-search status to exactly
`Активно ищу работу` (actively looking for work). Perform this check after EACH resume publication,
including copies and resumed operations, and verify the saved status after reloading before reporting
success. If it is already selected, verify it without toggling to another status. This is HH's job-search
status, separate from resume publication/searchability and the client's read-only database status.
Never change the database status as a substitute. Missing or unpersisted job-search status blocks
successful completion. Dry-run/live-smoke do not change it; read-only final verification must check it.

Hard En condition: every resume in an En profile must have the resume's own language set to English
(`In English`, persisted HH language `EN`). This includes the baseline, every native copy, existing
published resumes and recovery. English text alone does not satisfy this condition. Use the language
selector in the resume's top toolbar (`По-русски` → `In English`), then reload the exact resume and
verify the persisted selection. This is separate from the HH site interface language and the person's
spoken languages/CEFR levels; do not change either as a substitute. Missing or Russian resume language
blocks successful En completion. Preserve the already filled content, skills, levels and publication.

Hard completion condition: EVERY resume, including the baseline, native copies and recovered/previously
published resumes, must have exactly 30 distinct structured HH skills, EVERY one at Advanced
(`Продвинутый`). Select from the final CV in category rounds: first skill from each bullet/category in
source order, then second from each, and continue until 30 unique skills are filled. Deduplicate names;
use remaining explicitly listed CV/experience technologies only when category items run out. Never
invent skills to reach 30. Skills mentioned only in About do not count. A selected chip, clicked level,
active publication status or a clone operation is not evidence of saved skills. Save, reopen the exact
resume's skill and level editors, and verify the persisted names, count and all 30 Advanced levels.
Missing/unavailable skills, fewer than 30 or any unset/lower level must block successful completion and
old-resume deletion. Repair the affected skills section; never silently skip it or report a full fill.

Run filling only on a manual user request for a client and market. The requested market selects the CV,
Dolphin profile and HH account regardless of `client_status`, including a different market, an empty or
an unknown status. Never change the client's database status to enable filling. Do not enqueue, schedule
or automatically retry jobs based on database status or elapsed time.

## Storage

- `APP_DB=postgres` selects the existing SQL reader through `repository.ts`; other values retain the Noco path.
- All modes use this choice: preparation, filling, recovery and live smoke. A SQL failure must not fall back to Noco.
- Record IDs are preserved from Noco. `--client-id` means that same ID in the selected database.
- CV files still come from Drive. Artifacts remain local files, not SQL records; legacy queue state is not processed.
- The legacy `--use-noco-identity` flag means identity from the selected repository; its name is kept for compatibility.
- Use the existing SQL connection settings from the runtime. Do not change the database schema or create a second client for this feature.

## Safety invariants

- Resolve the client by numeric record ID and market; never guess between duplicate names.
- Treat `client_status` as informational only; it never gates a manually requested market.
- Require a final CV with status `moved to filling` or `filled`. If it is missing, make no HH changes.
- Treat CAPTCHA, 2FA, unknown mandatory fields, missing/ambiguous stack/profile/account, and rejected credentials as typed failures. Do not bypass them.
- Never log passwords, Noco tokens, Dolphin tokens, raw CV bytes, or full credentials.
- Run the full wizard live smoke only against the dedicated test target explicitly allowlisted by both
  `PROFILE_FILLER_SMOKE_CLIENT_ID` and `PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID`. Snapshot existing resume
  IDs first, never publish, and delete only IDs created during that smoke in a `finally` cleanup. Never use a
  production client as the smoke target and never send smoke results to Telegram.
- Never start autoresponses. Prepare content and title variants as drafts, verify privacy, then activate
  the complete target set. Publication is part of a requested production fill, including recovery of these
  same resumes; do not repeatedly request permission for that already-authorized step. Dry-run stays
  read-only and live-smoke never publishes. Preserve manual edits and skip activation for an already active ID.
- Snapshot old resume IDs/titles before replacement. Create and verify replacements before deleting old resumes, except for the documented one-at-a-time HH limit fallback.
- The user explicitly authorizes final HH Profile Filler reports to `VEU Менеджерский чатик`
  (Telegram chat ID `-1003187558078`) without per-run confirmation. This includes the resolved client's
  name and sanitized terminal failure reason in the report format below. When `summary_logs_channel_id`
  resolves to this exact ID, send the single terminal report through the existing reporting session without
  asking again. This standing authorization covers only this skill's final reports to this destination;
  a different destination requires separate authorization. It does not override tool-level approval blocks.
- Send exactly one final Telegram report for the entire client/market skill operation through the existing reporting session to
  `summary_logs_channel_id`. After terminal failure send `⚠️ HH Profile Filler`, a newline,
  `Не получилось заполнить <client_name>`, another newline, and `Причина: <safe_error_message>`, using the
  resolved client name from the selected repository and the sanitized terminal error message. Send the existing success report only
  after verified completion. Do not include client IDs, credentials, stack/stop-list details, dry-run, retry,
  skipped-employer, or unrelated intermediate UI errors in Telegram; keep fuller diagnostics in local artifacts.
  A CLI process ending is not terminal while the skill will fix or retry the operation. Run such attempts with
  `--defer-telegram`, then use `--report-result <result.json>` exactly once after the whole operation has
  permanently succeeded or failed. Never send a Telegram report between attempts.
  A reporting permission or delivery failure does not cancel independently authorized HH recovery.
  Keep the unsent result locally, respect the delivery block, and continue filling when the user requests it.
  Do not resend a previous failure after the operation has resumed; report only its new terminal outcome.

## Commands

- Start Dolphin in headful mode (`headless: false`) for every Profile Filler dry-run and fill so the live
  HH interaction remains visible to the operator.
  The shared Dolphin runtime must honor this per-call option; verify it instead of relying on its default.
- One client, live dry-run: `npm run profile-filler -- --client-id <id> --market ru|en --dry-run`
- Dedicated test profile, full wizard live smoke: set `PROFILE_FILLER_SMOKE_CLIENT_ID` and
  `PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID`, then run
  `npm run profile-filler -- --live-smoke --client-id <test-id> --market ru|en`. This creates an unpublished
  temporary draft, traverses the wizard through experience, verifies it, and removes it.
- One client, dry-run then real fill: `npm run profile-filler -- --client-id <id> --market ru|en`
- Resume a known incomplete first-title draft that HH no longer exposes in its list: add
  `--resume-id <draft-id>` from the sanitized local profession-state artifact. Never guess this ID.
- When the primary draft's content is complete, use `--resume-from title-variants --resume-id <baseline-id>`
  to create only missing title copies. To reuse already created copies, pass `--resume-ids <baseline-id,copy-id,...>`
  in mapped-title order; a trailing missing variant is created once. This recovery preserves content/privacy
  and old resumes, then activates and verifies every target. Verify content/privacy before this recovery.
- If content/privacy are already complete, including after manual user edits, use `--resume-from activate`
  with the known ordered `--resume-ids <id1,id2,...>`. This only completes publication and verifies searchability;
  it must not recreate copies, refill content, change visibility or delete any resumes.
- When artifacts and the visible HH draft confirm that every earlier section is complete and the run stopped
  at work permits, resume that exact draft with `--resume-id <draft-id> --resume-from work-permits`. This
  stage-specific recovery must not re-run earlier filled sections; other target drafts still use the normal flow.
- When every mapped target draft is present and confirmed complete and the operation stopped on privacy, use
  `--resume-from privacy`. Require every target by exact mapped title, open each direct
  `/resume/edit/<id>/visibility` route, then activate all targets without reprocessing resume content.
- When a run completed and verified privacy for every target and then stopped before deleting an old resume,
  use `--resume-from delete-old`. Verify all replacements are active before deleting old resumes; skip
  content and privacy mutations. Inactive replacement resumes must be activated first.
- For read-only final recovery, pass known target IDs in mapped-title order with
  `--resume-ids <id1,id2,...> --resume-from verify-final`. Require each exact ID/title to be active and
  searchable in HH server data. If one remains a draft, report incomplete activation; never return success.
- Multi-attempt supervised fill without intermediate Telegram: add `--defer-telegram`; after the terminal
  result run `npm run profile-filler -- --report-result <artifact-result.json>` exactly once.
- Explicitly approved cross-person CV with repository identity: add `--use-noco-identity`. Never use this
  flag without a direct user instruction naming both people.
- Legacy `--pending`, `--scan-only`, `profile-filler:scan` and `profile-filler:pending` entry points are disabled.
  Use only the explicit client/market commands above; do not register scheduled Profile Filler tasks.
- Tests: `npm run profile-filler:test && npm run typecheck`

The ordinary `--dry-run` remains read-only. Use `--live-smoke` only for the allowlisted test account when a
real HH DOM regression must be detected before production filling. Browser DOM regression tests use the
sanitized observed-state fixture in `tests/fixtures/hh-wizard-observed.html`.

## Source and field policy

Read [field-policy.md](references/field-policy.md) before a run that fills HH. Read [operations.md](references/operations.md) before supervising or diagnosing a manual run.

Use the final CV first and fields from the selected repository only as fallback. In the student's Drive folder, open the exact
`Самопрезентация` subfolder and use supported documents whose filename contains `Описание опыта` to
expand employer candidates. Include employers, brand owners, brands/products, vendors, customers, and
partners; add only unambiguous official HH employer cards and report skipped candidates without stopping.

For En always set `Tbilisi, Georgia` and select work permits through the Russian HH UI using exactly
`Грузия`, `Сербия`, `Армения`, and `Казахстан`. For both markets set business trips ready,
on-site/office + remote + hybrid, preferred contact email, hide structured phone numbers, and visibility
to everyone except the employer stop-list. Build About in Contacts → Summary/About → Skills order. Set
exactly 30 structured HH skills to Advanced, following the hard completion condition above.

Never enumerate the entire HH country list one option at a time. Read all currently checked work permits in
one browser-side batch, compare that set with the four required Russian names, and click only selected extras
or missing targets. If the set already matches, close the selector without changing or saving it.

HH uses a Russian site interface in both Ru and En Dolphin profiles. Treat `market` as the language of
resume content and market-specific values, not as the HH UI language. Use Russian UI labels and search
terms for HH controls and taxonomies, including profession specializations, unless the live page itself
shows another language; never derive UI label language from `market`.

Use the dedicated `/profile/block/languages` editor for language reads, updates and persistence checks.
An `/applicant/profile/me` redirect into an unfinished wizard does not mean language editing requires
publication. Inspect the actual destination before diagnosing a missing control. Use the editor's named
Magritte selectors and visible options; translate source language names such as English/Russian to the
Russian UI taxonomy and preserve their source-supported levels. Edit an existing language instead of
adding a duplicate; correct the native-language slot only from an explicit native language in the CV.
After saving, reload the dedicated editor and verify the language and level. Missing controls require
bounded DOM diagnosis and a regression fix when possible, not publication as a workaround.

Use the exact stack title mapping implemented in `stack-titles.ts`; the malformed Go En fragment `S` is intentionally absent.

Before changing any HH field, read its actual current value. Skip an exactly matching scalar or complete
set without clicking or entering it again. Correct a mismatch only from the final CV or an allowed repository
fallback. If a field is already populated and the approved sources are silent, leave it unchanged. Do not
duplicate matching experience, education, language, or skill records.

## Resume title variants

- Build the complete title set for the resolved stack and market from `stack-titles.ts`.
- In the initial HH creation wizard, for every stack and both markets, enter and select exactly the Russian
  profession `Программист, разработчик`. Never enter an English or mapped final title on that screen.
  In `Уточните специальность`, search `разработчик` and select exactly `Программист, разработчик`, checking
  the real hidden radio/checkbox state. Only after HH assigns the draft ID, set the mapped final title through
  the safe partial profession editor and verify the exact saved title without publishing.
- When one fully filled resume already exists under the primary mapped title, preserve it as the content
  baseline and create only missing title variants with HH's native `Duplicate` action. Reuse an incomplete
  draft whose profession matches a target variant instead of creating a second draft.
- Every variant must contain the same contacts, About, experience, education, languages, skills, skill
  levels, work preferences, anonymity, and employer stop-list. Only the resume title changes.
- When a resumed wizard step is already filled and HH shows no explicit validation or verification request,
  wait for the asynchronous transition and retry `Сохранить и продолжить` once instead of failing
  immediately. Do not jump directly to another URL or bypass an explicit HH validation error.
- Native `Duplicate` uses `POST /applicant/resumes/clone?resume=<source-id>` in the authorized HH session.
  The request works even when the resume list redirects into an unfinished wizard. Use the repository's
  `requestNativeResumeClone` adapter, record the distinct returned ID before editing, and never retry an
  uncertain POST automatically. Recover the recorded ID rather than creating another copy.
- A native copy retains the baseline specialization and content but clears its title. Set the mapped
  title directly at `/resume/edit/<copy-id>/position` and use its plain `Сохранить` control. This only prepares
  the draft; it does not activate it. After content/privacy verification, continue that exact ID's filled
  wizard through `Сохранить и продолжить` with the activation adapter. Stop on validation, CAPTCHA or
  unknown screens. Re-read server status after transitions and require searchability before success.
- Verify the baseline and every configured title are active before considering the run successful. Never remove the
  baseline merely to make room for another title unless the user explicitly authorizes replacement.
