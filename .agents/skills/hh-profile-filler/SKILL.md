---
name: hh-profile-filler
description: Fill and replace HH resumes in Dolphin from final Google Drive CVs and read-only Noco data. Use when Codex is asked to prepare, dry-run, run, schedule, supervise, diagnose, or report HH profile filling by client/status/market, including About, privacy, employer stop-lists, resume duplicates, and password login.
---

# HH Profile Filler

Operate the repository implementation in `src/features/hh-profile-filler`. Keep Noco read-only.

## Safety invariants

- Resolve the client by numeric Noco ID and market; never guess between duplicate names.
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
- Snapshot old resume IDs/titles before replacement. Create and verify replacements before deleting old resumes, except for the documented one-at-a-time HH limit fallback.
- Send exactly one final Telegram report for the entire client/market skill operation through the existing reporting session to
  `summary_logs_channel_id`. After terminal failure send `⚠️ HH Profile Filler`, a newline,
  `Не получилось заполнить <client_name>`, another newline, and `Причина: <safe_error_message>`, using the
  resolved Noco client name and the sanitized terminal error message. Send the existing success report only
  after verified completion. Do not include client IDs, credentials, stack/stop-list details, dry-run, retry,
  skipped-employer, or unrelated intermediate UI errors in Telegram; keep fuller diagnostics in local artifacts.
  A CLI process ending is not terminal while the skill will fix or retry the operation. Run such attempts with
  `--defer-telegram`, then use `--report-result <result.json>` exactly once after the whole operation has
  permanently succeeded or failed. Never send a Telegram report between attempts.

## Commands

- Start Dolphin in headful mode (`headless: false`) for every Profile Filler dry-run and fill so the live
  HH interaction remains visible to the operator.
- One client, live dry-run: `npm run profile-filler -- --client-id <id> --market ru|en --dry-run`
- Dedicated test profile, full wizard live smoke: set `PROFILE_FILLER_SMOKE_CLIENT_ID` and
  `PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID`, then run
  `npm run profile-filler:smoke -- --client-id <test-id> --market ru|en`. This creates an unpublished
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
- Multi-attempt supervised fill without intermediate Telegram: add `--defer-telegram`; after the terminal
  result run `npm run profile-filler -- --report-result <artifact-result.json>` exactly once.
- Explicitly approved cross-person CV with Noco identity: add `--use-noco-identity`. Never use this
  flag from the status queue or without a direct user instruction naming both people.
- Scan status transitions only: `npm run profile-filler:scan`
- Scan and process pending jobs: `npm run profile-filler:pending`
- Tests: `npm run profile-filler:test && npm run typecheck`

The ordinary `--dry-run` remains read-only. Use `--live-smoke` only for the allowlisted test account when a
real HH DOM regression must be detected before production filling. Browser DOM regression tests use the
sanitized observed-state fixture in `tests/fixtures/hh-wizard-observed.html`.

The pending runner uses the fixed initial watermark `2026-09-03T15:53:37+02:00`, records later status transitions locally, performs a live dry-run before mutation, and retries failures once per day for at most three attempts.

## Source and field policy

Read [field-policy.md](references/field-policy.md) before a run that fills HH. Read [operations.md](references/operations.md) before scheduling, supervising, or diagnosing the runner.

Use the final CV first and Noco only as fallback. In the student's Drive folder, open the exact
`Самопрезентация` subfolder and use supported documents whose filename contains `Описание опыта` to
expand employer candidates. Include employers, brand owners, brands/products, vendors, customers, and
partners; add only unambiguous official HH employer cards and report skipped candidates without stopping.

For En always set `Tbilisi, Georgia` and select work permits through the Russian HH UI using exactly
`Грузия`, `Сербия`, `Армения`, and `Казахстан`. For both markets set business trips ready,
on-site/office + remote + hybrid, preferred contact email, hide structured phone numbers, and visibility
to everyone except the employer stop-list. Build About in Contacts → Summary/About → Skills order. Set
every added HH skill to Advanced.

Never enumerate the entire HH country list one option at a time. Read all currently checked work permits in
one browser-side batch, compare that set with the four required Russian names, and click only selected extras
or missing targets. If the set already matches, close the selector without changing or saving it.

HH uses a Russian site interface in both Ru and En Dolphin profiles. Treat `market` as the language of
resume content and market-specific values, not as the HH UI language. Use Russian UI labels and search
terms for HH controls and taxonomies, including profession specializations, unless the live page itself
shows another language; never derive UI label language from `market`.

Use the exact stack title mapping implemented in `stack-titles.ts`; the malformed Go En fragment `S` is intentionally absent.

Before changing any HH field, read its actual current value. Skip an exactly matching scalar or complete
set without clicking or entering it again. Correct a mismatch only from the final CV or an allowed Noco
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
- Set each duplicate's initial profession to `Программист, разработчик`, select that same Russian
  specialization, and apply its mapped final title only after obtaining the duplicate ID.
  The native duplicate flow can publish on `Save and continue`; this is permitted only for these verified
  title variants. Continue to use safe partial-edit routes for ordinary drafts and never publish them.
- Verify the baseline and every configured title before considering the run successful. Never remove the
  baseline merely to make room for another title unless the user explicitly authorizes replacement.
