# Operations

## PostgreSQL source preflight

- Identify the authoritative PostgreSQL connection from the current application runtime/deployment
  configuration. Check the effective environment of the exact process being launched, including its working
  directory and dotenv path; an old worktree or inherited environment may select a different database.
- Require `APP_DB=postgres`. Use the existing SQL reader to confirm the connected database identity and
  expected schema/table mapping with read-only checks. Compare the effective host, port and database with
  the authoritative runtime configuration. A database name, including one without a `restore` suffix,
  is not proof of freshness. Do not guess endpoints or change ENV files merely to pass this check.
- Read the target client's identity, current status, update timestamp and related source metadata afresh
  from that verified PostgreSQL source. Record a sanitized source identity and read timestamp locally,
  without passwords, tokens or connection strings. Old artifacts may locate a draft but cannot establish
  current eligibility. An old row timestamp alone does not prove that a database is stale.
- If a status conflicts with the operator's current view, check the database/environment and record mapping
  before concluding that the client changed status or asking the user to change it. Report an unresolved
  source mismatch and request the authoritative connection if it cannot be identified. Never overwrite a
  client status, switch to NocoDB or mix data from multiple sources to make the eligibility check pass.
- A missing/unverified current connection or SQL read failure stops the operation before HH mutation.
  This preflight is required for retries and recovery as well as fresh runs. The implementation blocks mismatched configuration; it never repairs ENV automatically.

## Status queue

- State defaults to `storage/hh-profile-filler/state.json`; override with `PROFILE_FILLER_STORAGE_ROOT`.
- The first scan establishes observed client statuses and queues only target-status rows updated after the fixed watermark.
- Later scans queue only actual transitions into `on ru market` or `on en market`.
- Revalidate status immediately before source preparation.
- Every attempt performs a fresh dry-run; a previous `dry_run_passed` state is not sufficient.
- Failed jobs retry after 24 hours, at most three attempts. A client leaving the target status cancels its pending job.
- Refresh approved client/profile/account/stack/CV metadata before dry-run, mutation and deletion; changed source records invalidate preparation. Never trust a pending-run snapshot as current authorization.
- After the PostgreSQL source preflight, read current SQL columns through the existing repository factory.
  Preserve the CV revision format and local queue file; revalidate queued IDs against the verified source.
  Do not restart old jobs just because the connection changes.
- A SQL read failure stops preparation; do not retry through Noco. If a legacy execution path attempts a
  Noco read, stop and correct source routing before continuing; do not treat it as an allowed fallback.

## Daily sequence

Run Profile Filler through its own Windows task and process. It must not be started by, chained to,
or share a wrapper with HH autoresponses. The repository default is `HH-Profile-Filler-Daily` at
12:00 Europe/Warsaw; autoresponses remain a separate task at 03:40 Europe/Warsaw. For each pending
job, run the PostgreSQL source preflight and source/auth/UI dry-run first and execute only on success.
Run Profile Filler Dolphin sessions in headful mode so the active HH window is visible on the desktop.
Apply the [baseline-first sequence](../SKILL.md#resume-title-variants) within each client/market job.
Before a live run, confirm that the selected execution path completes baseline content, privacy and
verification before creating variants. A runner that creates all drafts first does not satisfy this sequence;
do not launch that path unchanged or treat a skill-document edit as an implementation fix.

## Full wizard live smoke

- Reserve a separate client in the selected database and a Dolphin/HH profile that are not used for production filling.
- Allowlist both numeric IDs with `PROFILE_FILLER_SMOKE_CLIENT_ID` and
  `PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID`; a mismatch must fail before opening Dolphin.
- Run `npm run profile-filler -- --live-smoke --client-id <test-id> --market ru|en` manually or as a separate
  pre-production check. Do not substitute a real client when the test target is unavailable.
- The smoke snapshots existing resume IDs, traverses the real wizard to the final experience screen without
  submitting the publishing step, and removes only resume IDs absent from the initial snapshot.
- Cleanup runs after both success and failure. Treat a cleanup failure as critical and inspect the local
  artifact directory before another smoke attempt. Live-smoke output is local only; do not send Telegram.
- Keep the sanitized real-DOM fixture and Playwright checks aligned with observed HH controls, especially
  nested profession/specialization sheets, hidden checked inputs, split birth-date controls, and delayed
  wizard transitions.

## Artifacts and reporting

- Store local artifacts under `logs/hh-profile-filler` or `PROFILE_FILLER_ARTIFACT_ROOT`.
- Save sanitized preparation summaries, resume ID/title snapshots, screenshots and final result JSON.
- On browser failure save a sanitized `failure.json` with path-only URLs, current wizard screen, visible
  errors, failed-request status/path, and page errors plus `failure.png`; never include request bodies.
- Do not store credentials or raw CV data.
- A successful report requires version 2 of the full persisted contract, unique target IDs, exact mapped
  titles, identical verified content and the final inventory. An old `operationComplete=true` boolean is
  not accepted without all checks. The queue marks completed only after this same validation.
- Use the shared operation reporter. Success: `✅ HH Profile Filler\nПрофиль Dolphin: <actual_name>\nПолучилось заполнить.`
  Failure: `⚠️ HH Profile Filler\nПрофиль Dolphin: <actual_name>\nНе получилось заполнить.\nПричина: <safe_reason>`.
  Do not include a separate client name or repeat it in the reason. Fetch the actual Dolphin name by ID;
  never synthesize it. Failure before name resolution explicitly states that the profile is unknown and
  filling has not started. Other diagnostics stay local.
- For supervised attempts use `--defer-telegram`, including pending mode. Send `--report-result` only
  once the whole operation is terminal. Dry-run and smoke never send reports. Delivery intent is saved
  by operation ID before sending. A timeout/crash leaves delivery unknown: inspect it rather than
  automatically resending. A reporting failure never re-enters filling or changes a completed queue job.
- Set `TELEGRAM_STORAGE_ROOT` to the main runtime repository's `storage` directory so the runner
  uses `storage/telegram-reporting/.telegram-session`, not a worktree-local session path.

## Recovery

- Resume the baseline-first sequence from the first incomplete resume. Finish and verify the baseline
  before creating variants; after a variant failure, preserve completed resumes and recover that variant
  before proceeding. Keep the stage-specific CLI preconditions below: `--resume-from privacy` requires
  all mapped drafts and is not a baseline-only recovery command. Do not create extra drafts to satisfy it.
- Missing final CV: no HH changes; retry next day.
- CAPTCHA/2FA/auth failure: stop the Dolphin profile, report, retry next day.
- Employer missing/ambiguous: skip candidate and continue.
- Employer selection not persisted after reopening the direct visibility editor: stop with
  `profile_hh_employer_selection_not_persisted`; do not downgrade it to a skipped candidate.
- If a supervised run stopped at work permits after artifacts and the visible draft confirm all prior sections,
  use the known draft ID with `--resume-from work-permits`. Resume only that draft from the confirmed stage;
  do not re-run its identity, education, skills, experience, contacts, About, or title pages.
- If all mapped drafts are complete and a run stopped while configuring privacy, use `--resume-from privacy`.
  It must require every exact mapped draft, use the direct visibility editor for each resume ID, and skip all
  content-filling stages.
- Every recovery command returns `stage=recovery_completed`. Before treating it as terminal, run the common
  read-only contract verification for every target: exact title, expected draft/publication state, required
  experience selection, blacklist visibility, hidden structured phones and accounted employer candidates.
  Only that verifier may set `operationComplete=true`.
- For `--resume-from skills`, require every ordered target ID. Preserve existing tags, add supported
  catalog matches to exactly 30, set all 30 to Advanced, reopen and verify the same saved tag/level set.
  Drafts use the wizard keyskills route; published resumes use the partial keySkills editor. If HH drops
  tags when saving levels, restore the prior saved tags, verify restoration and stop. A featured subset
  or a smaller stable server set never satisfies the contract. Do not create/delete resumes or mutate
  privacy or unrelated sections. Full operation success still requires every contract section.
- A direct visibility editor with an empty body/title is a failed asset load, not a missing UI control. Retry
  that exact URL up to three times and wait for body hydration before inspecting selectors; record the terminal
  failure only if all bounded attempts stay empty.
- If every target draft passed full contract verification and the run stopped at old-resume deletion, use
  `--resume-from delete-old`. Require every exact target draft and their unpublished status, then skip content
  and privacy mutation and perform only the pending deletion plus final list verification.
- In the current HH profile-card menu, a published resume may expose `Редактировать` but no delete action.
  Open that exact resume through `Редактировать` and accept only an explicit `Удалить резюме` control on its
  edit page; never use a generic `Удалить` action that could belong to experience, education, or another draft.
  In the confirmation dialog select exactly `Удалить навсегда`; never choose `Просто скрыть от всех` when the
  approved replacement plan requires deletion.
- Use `/applicant/profile/me` as the canonical resume list. When no published resume remains,
  `/applicant/resumes` may redirect into an unfinished draft wizard and must not be interpreted as an empty
  resume list.
- If HH also redirects `/applicant/profile/me` after the last published resume is deleted, verify every known
  target ID directly with `--resume-ids <mapped-order-ids> --resume-from verify-final`: read its exact title
  from the safe position editor and require its ID to open the unfinished draft wizard. This stage is read-only.
- Resume limit: stop, preserve all existing resumes and artifacts. Never delete to make room.
- Delete only old snapshot IDs after all target contracts pass; never delete the primary or target resumes.
- Final verification failure or partial replacement: stop, retain artifacts, send a critical report, and do not continue deleting.
