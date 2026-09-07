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

## Artifacts and reporting

- Store local artifacts under `logs/hh-profile-filler` or `PROFILE_FILLER_ARTIFACT_ROOT`.
- Save sanitized preparation summaries, resume ID/title snapshots, screenshots and final result JSON.
- Do not store credentials or raw CV data.
- Report to `summary_logs_channel_id` using the existing Telegram session. Send one message only after the
  client/market run reaches verified completion, cancellation, or exhausted third failure; do not send
  dry-run, scheduled retry, or intermediate error messages. The message contains only `Получилось заполнить`
  or `Не получилось заполнить`; IDs and diagnostics stay in local artifacts. A reporting failure must be
  logged but must not re-run an already completed HH mutation.
- Set `TELEGRAM_STORAGE_ROOT` to the main runtime repository's `storage` directory so the runner
  uses `storage/telegram-reporting/.telegram-session`, not a worktree-local session path.

## Recovery

- Missing final CV: no HH changes; retry next day.
- CAPTCHA/2FA/auth failure: stop the Dolphin profile, report, retry next day.
- Employer missing/ambiguous: skip candidate and continue.
- Resume limit: snapshot first, delete at most one old resume immediately before its replacement, and stop further deletions if replacement fails.
- Final verification failure or partial replacement: stop, retain artifacts, send a critical report, and do not continue deleting.
