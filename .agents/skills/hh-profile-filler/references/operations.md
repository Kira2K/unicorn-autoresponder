# Operations

## Status queue

- State defaults to `storage/hh-profile-filler/state.json`; override with `PROFILE_FILLER_STORAGE_ROOT`.
- The first scan establishes observed client statuses and queues only target-status rows updated after the fixed watermark.
- Later scans queue only actual transitions into `on ru market` or `on en market`.
- Revalidate status immediately before source preparation.
- Failed jobs retry after 24 hours, at most three attempts. A client leaving the target status cancels its pending job.
- Reuse one NocoDB snapshot for the whole pending run; do not refresh all source tables per client.
- Treat NocoDB HTTP 429 as `profile_noco_rate_limited`, honor `Retry-After` (or use the safe fallback delay), and defer without consuming an HH attempt or losing `dry_run_passed` state.

## Daily sequence

Run Profile Filler through its own Windows task and process. It must not be started by, chained to,
or share a wrapper with HH autoresponses. The repository default is `HH-Profile-Filler-Daily` at
12:00 Europe/Warsaw; autoresponses remain a separate task at 03:40 Europe/Warsaw. For each pending
job, run source/auth/UI dry-run first and execute only on success.
Run Profile Filler Dolphin sessions in headful mode so the active HH window is visible on the desktop.

## Full wizard live smoke

- Reserve a separate Noco client and Dolphin/HH profile that are not used for production filling.
- Allowlist both numeric IDs with `PROFILE_FILLER_SMOKE_CLIENT_ID` and
  `PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID`; a mismatch must fail before opening Dolphin.
- Run `npm run profile-filler:smoke -- --client-id <test-id> --market ru|en` manually or as a separate
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
  Noco client name and a sanitized, single-line terminal error message. IDs and fuller diagnostics stay in
  local artifacts. A reporting failure must be logged but must not re-run an already completed HH mutation.
- Set `TELEGRAM_STORAGE_ROOT` to the main runtime repository's `storage` directory so the runner
  uses `storage/telegram-reporting/.telegram-session`, not a worktree-local session path.

## Recovery

- Missing final CV: no HH changes; retry next day.
- CAPTCHA/2FA/auth failure: stop the Dolphin profile, report, retry next day.
- Employer missing/ambiguous: skip candidate and continue.
- If a supervised run stopped at work permits after artifacts and the visible draft confirm all prior sections,
  use the known draft ID with `--resume-from work-permits`. Resume only that draft from the confirmed stage;
  do not re-run its identity, education, skills, experience, contacts, About, or title pages.
- If all mapped drafts are complete and a run stopped while configuring privacy, use `--resume-from privacy`.
  It must require every exact mapped draft, use the direct visibility editor for each resume ID, and skip all
  content-filling stages.
- A direct visibility editor with an empty body/title is a failed asset load, not a missing UI control. Retry
  that exact URL up to three times and wait for body hydration before inspecting selectors; record the terminal
  failure only if all bounded attempts stay empty.
- If both target drafts passed privacy verification and the run stopped at old-resume deletion, use
  `--resume-from delete-old`. Require both exact target drafts and their unpublished status, then skip content
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
- Resume limit: snapshot first, delete at most one old resume immediately before its replacement, and stop further deletions if replacement fails.
- Final verification failure or partial replacement: stop, retain artifacts, send a critical report, and do not continue deleting.
