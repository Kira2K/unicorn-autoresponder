# Operations

## Status queue

- State defaults to `storage/hh-profile-filler/state.json`; override with `PROFILE_FILLER_STORAGE_ROOT`.
- The first scan establishes observed client statuses and queues only target-status rows updated after the fixed watermark.
- Later scans queue only actual transitions into `on ru market` or `on en market`.
- Revalidate status immediately before source preparation.
- Failed jobs retry after 24 hours, at most three attempts. A client leaving the target status cancels its pending job.

## Daily sequence

The Windows task starts at 04:40 GMT+3. Preserve the existing autoresponse sequence. Execute Profile Filler in a PowerShell `finally` block so Ru/En responder failures cannot suppress it. For each pending job, run source/auth/UI dry-run first and execute only on success.

## Artifacts and reporting

- Store local artifacts under `logs/hh-profile-filler` or `PROFILE_FILLER_ARTIFACT_ROOT`.
- Save sanitized preparation summaries, resume ID/title snapshots, screenshots and final result JSON.
- Do not store credentials or raw CV data.
- Report to `summary_logs_channel_id` using the existing Telegram session. A reporting failure must be logged but must not re-run an already completed HH mutation.

## Recovery

- Missing final CV: no HH changes; retry next day.
- CAPTCHA/2FA/auth failure: stop the Dolphin profile, report, retry next day.
- Employer missing/ambiguous: skip candidate and continue.
- Resume limit: snapshot first, delete at most one old resume immediately before its replacement, and stop further deletions if replacement fails.
- Final verification failure or partial replacement: stop, retain artifacts, send a critical report, and do not continue deleting.
