# Operations

## Manual execution

- Filling starts only from a manual user request naming the client and market. `client_status` does not
  gate preparation, filling or recovery, and must not be changed to match the requested market.
- Resolve the numeric client ID unambiguously. Use the requested market for the final CV, Dolphin profile
  and HH account. Continue to require a confirmed final CV (`moved to filling` or `filled`).
- Run source/auth/UI dry-run before ordinary filling and execute only on success. Use headful Dolphin
  sessions so the active HH window is visible on the desktop.
- Status scans, pending queues, daily tasks and automatic retries are disabled. Legacy CLI commands and
  scheduler scripts fail without running jobs. Preserve old local queue files; never process them.
- Do not start Profile Filler from HH autoresponses or register a schedule. Supervised recovery attempts
  belong to the active manual operation; a later run after terminal failure requires a new manual request.
- With `APP_DB=postgres`, use the existing repository factory and preserve record IDs and CV revisions.
  A SQL read failure stops preparation; do not fall back to Noco.
- On NocoDB HTTP 429, honor `Retry-After` within the active manual operation or report the terminal failure;
  do not create an automatic retry job.

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
- Report to `summary_logs_channel_id` using the existing Telegram session. Send one message only after the
  entire supervised client/market skill operation reaches verified completion or a genuinely terminal
  failure. The end of one CLI process is not terminal when a code fix or another attempt will follow. Use
  `--defer-telegram` for every such attempt, and call `--report-result <result.json>` exactly once for the
  final result; its marker prevents reporting the same result file twice. Never send a message for a dry-run,
  Noco 429, network error, diagnostic failure, scheduled retry, code correction, or other intermediate error.
  A terminal failure message is
  `⚠️ HH Profile Filler\nНе получилось заполнить <client_name>\nПричина: <safe_error_message>`, using the resolved
  client name from the selected repository and a sanitized, single-line terminal error message. IDs and fuller diagnostics stay in
  local artifacts. A reporting failure must be logged but must not re-run an already completed HH mutation.
- Set `TELEGRAM_STORAGE_ROOT` to the main runtime repository's `storage` directory so the runner
  uses `storage/telegram-reporting/.telegram-session`, not a worktree-local session path.

## Recovery

- After publishing each resume (including native copies/recovery), ensure `Активно ищу работу` in
  HH's job-search status and reload to verify it. Reuse an already matching status. An active resume
  or `isSearchable: true` does not prove the job-search status. `verify-final` checks without writing.

- En resume language: inspect the language selector in the exact resume's top toolbar. Change
  `По-русски` to `In English`, reload, and verify persistence independently for every resume ID.
  An English title/About, English C1 in spoken languages, an En Dolphin name or native duplication
  does not prove that the resume language is English. Already-English resumes require verification only.
  Read-only final verification must fail if any En resume still has Russian/unknown language.

- Skills recovery uses the exact resume's `/resume/edit/<id>/keySkills` editor, including already active
  resumes. Read selected chips separately from recommendations; a visible recommended skill is not saved.
  Complete the 30-skill contract in SKILL.md and verify persisted levels after reloading. Do not substitute
  the first unrelated suggestion or accept a missing search sheet as proof that 30 skills were saved.
  The desktop `chips-trigger-input` can be directly editable, while a readonly trigger opens a search
  sheet. Use the exact `suggest-item-user-input` option when the source name is absent from the catalog.
  Set levels in `/resume/edit/<id>/skillsLevels`; read the actual checked radio in each skill's Advanced
  label after reopening. Use `domcontentloaded` for save redirects, since unrelated assets can delay `load`.
  Read-only `verify-final` and publication-only `activate` must also verify this contract; if incomplete,
  fail with a skills-specific result rather than claiming that activation alone completes filling.

- Production completion requires every exact mapped ID/title to have active, searchable HH server state.
  `not_finished` is always incomplete, regardless of saved content. Use the publication adapter to finish
  the prefilled wizard after content/privacy checks; do not retype matching fields. Read state after each
  transition. A published but non-searchable/blocked/unknown state is not success.
- After manual user actions, re-read every target first. Preserve edits and skip publishing clicks for
  active IDs. `--resume-from activate --resume-ids <mapped-order-ids>` only finishes publication and verifies;
  it does not recreate variants, edit privacy or delete anything. Do not remove old resumes until all
  replacements have passed active-state verification. Allow HH's delayed post-publication redirect to settle
  before navigating to the next resume; retry only read-only navigation when a page load fails.
- A native copy can retain its title while still showing `Кем вы хотите работать?` with `Укажу профессию`
  and no Next button. This is not a completed profession step. During activation use
  `completeKnownResumeProfession`: select the canonical Russian programmer profession/specialization,
  finish that step, restore the exact mapped title through the partial editor, and recheck active server state.
  Never treat the saved title alone as evidence that the wizard has been completed.
  Selecting a popular profession radio may not open specialization automatically: first open the picker
  through Continue, then confirm the existing/missing specialization. Do not silently accept a missing picker
  or uncheck an already selected specialization. Empty mounted error containers are not validation failures;
  require non-empty error text or an explicitly invalid field.

- Employer stop-list: confirm each selected search result into the employer list before changing the
  search query; HH may discard unconfirmed checkboxes when results change. Save visibility and reopen
  the editor to verify persistence. A selected official employer that did not persist is a verification
  failure, not a missing/ambiguous candidate to silently skip. Respect any tool approval block on this write;
  keep it pending while completing independently authorized work.
  If a tool approval permits only a named employer, pass only that employer to the recovery write;
  do not rerun the entire CV-derived candidate list. Reuse that approval without asking again. Record
  the verified subset and remaining candidates separately; subset completion is not full completion.

- New-resume creation may redirect to an existing unfinished wizard when no published baseline exists.
  Treat this as `profile_hh_new_resume_redirected`, not a missing profession field. Keep the known draft ID,
  verify its completed sections, and use the native clone adapter for missing variants. Finish that draft's
  privacy independently of missing title variants and save a local checkpoint. Do not restart filled sections
  or publish a baseline merely to make the profile overview available.
- Native clone recovery: use the returned clone ID from `duplicate-<id>.json` (or a recorded native clone
  response), never infer it from whichever wizard HH opens by default. Rename through the safe partial
  position editor; it retains the copied specialization while preparing the draft. Verify each known ID directly
  when HH hides all drafts. Use `--resume-from title-variants` with ordered known IDs to reuse partial copies.
  A lost/invalid clone response is an uncertain external write: inspect existing drafts before any retry.
  HH can reset the separate Setka visibility flag to `no_one` in native copies. Record this difference;
  do not enable cross-service visibility while preparing unpublished HH title variants.

- Language editing: use `/profile/block/languages`, including when every resume is an unfinished draft.
  The profile overview can redirect to the experience wizard; never search for language controls there or
  infer that publication is required. Read both overview-card and dedicated-editor card layouts. Use
  `profile-language-add`, the language editor's `magritte-select-activator` controls and visible options,
  then `profile-modal-button-save`. Reopen the editor to verify every source-supported language and level.
- If an editor click happens during hydration, wait for the modal and retry once before reporting a
  missing control. Scope language controls to their exact labels so the site-language menu is never selected.
- A blocked Telegram report remains pending independently of HH work. Continue authorized recovery and
  report only its eventual terminal result; do not resend an obsolete failure or bypass a delivery block.

- Missing final CV: no HH changes; report the blocker and wait for a new manual request.
- CAPTCHA/2FA/auth failure: stop the Dolphin profile, report, and wait for a new manual request after resolution.
- Employer missing/ambiguous: skip candidate and continue.
- If a supervised run stopped at work permits after artifacts and the visible draft confirm all prior sections,
  use the known draft ID with `--resume-from work-permits`. Resume only that draft from the confirmed stage;
  do not re-run its identity, education, skills, experience, contacts, About, or title pages.
- If all mapped drafts are complete and a run stopped while configuring privacy, use `--resume-from privacy`.
  It must require every exact mapped resume, use the direct visibility editor for each resume ID, skip all
  content-filling stages, and finish with activation and active-state verification.
- A direct visibility editor with an empty body/title is a failed asset load, not a missing UI control. Retry
  that exact URL up to three times and wait for body hydration before inspecting selectors; record the terminal
  failure only if all bounded attempts stay empty.
- If all targets passed privacy verification and the run stopped at old-resume deletion, use
  `--resume-from delete-old`. Require all exact targets to be active before deletion; skip content and privacy
  mutation, finish any pending activation, then perform deletion and final verification.
- In the current HH profile-card menu, a published resume may expose `Редактировать` but no delete action.
  Open that exact resume through `Редактировать` and accept only an explicit `Удалить резюме` control on its
  edit page; never use a generic `Удалить` action that could belong to experience, education, or another draft.
  In the confirmation dialog select exactly `Удалить навсегда`; never choose `Просто скрыть от всех` when the
  approved replacement plan requires deletion.
- Use `/applicant/profile/me` as the canonical resume list. When no published resume remains,
  `/applicant/resumes` may redirect into an unfinished draft wizard and must not be interpreted as an empty
  resume list.
- Final verification reads exact IDs/titles and publication attributes directly, even if a list redirects.
  `--resume-ids <mapped-order-ids> --resume-from verify-final` is read-only and must fail for a draft or
  non-searchable resume. Never interpret an unfinished wizard as a successfully completed production fill.
- Resume limit: snapshot first, delete at most one old resume immediately before its replacement, and stop further deletions if replacement fails.
- Final verification failure or partial replacement: stop, retain artifacts, send a critical report, and do not continue deleting.
