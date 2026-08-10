# HH Autoresponses Operations

This reference expands the launch, scheduling, and monitoring routines for the HH autoresponse orchestrator.

## Source Map

- Orchestrator entrypoint and market execution: inspect the current package scripts, then the orchestrator source they invoke.
- Browser responder/injected script: inspect the code that clicks HH vacancy response buttons and emits parser logs.
- Auth/readiness logic: inspect Noco target loading, HH auth checks, readiness filtering, and Telegram readiness reporting.
- Stop-list logic: inspect client stop-list fields, stop-company expansion, and `COMPANY_STOP_LIST_SKIPPED` handling.
- Diagnostics: inspect JSONL run logs under `logs/` and Telegram report send records.
- Source docs: `docs/hh-autoresponses-skill-playbook.md`, `docs/hh-autoresponses-successful-profile-steps.md`, and `docs/hh-autoresponses-unfixed-unsuccessful-profile-runs.md`.

## Scope Parsing

- "All" means both `Ru` and `En`.
- "All profiles" means all enabled Noco targets that pass readiness for each requested market.
- If the user asks to launch or schedule HH autoresponses without profile/client details, use all enabled Noco targets that pass readiness.
- A market name narrows only that market.
- A client name narrows with `ORCHESTRATOR_CLIENT_NAMES`; prefer names over IDs when the user gives human-readable names.
- Exclusions use `ORCHESTRATOR_EXCLUDE_CLIENT_NAMES` or IDs only when the user explicitly asks.
- If the user provides no response limit, use `120`.
- If the user provides no market, run `Ru` then `En`.
- If the user asks to schedule without a time, use the next `04:40 GMT+3`.
- A scheduled time must be converted to an exact date/time with timezone and checked for AM/PM mistakes.

## Prelaunch Readiness

Before starting a market:

1. Confirm there is no active orchestrator already managing profiles.
2. Confirm Dolphin local API availability at `http://localhost:3001/v1.0`.
3. Confirm Dolphin profile capacity is acceptable for configured concurrency.
4. Confirm Noco targets are readable for the requested market.
5. Let production readiness classify accounts before Dolphin starts.
6. Confirm the readiness report is sent to `summary_logs_channel_id`.
7. Confirm blocked accounts are reported and skipped before profile start.

Readiness-blocked accounts are not runtime failures. They are skipped and reported.

## Extra Dolphin And Client-State Checks

Use this extra check at schedule time, one hour before a scheduled launch, launch preflight, and manual status/debug time.

- Reuse existing repo mechanisms: Dolphin integration/preflight checks, Noco readiness or target inspection, process checks, local logs, and the existing Telegram messenger when an error alert is needed.
- For scheduled task verification, record the task name and wrapper path in the local check log.
- Treat an active HH orchestrator as expected only when the check is explicitly being run during a known active run; otherwise an active HH orchestrator is a reportable error.
- Verify Dolphin local API availability at `http://localhost:3001/v1.0`.
- Verify no unexpected active HH orchestrator or node process is already managing profiles.
- For scheduled runs, verify the main launch task exists and points at the intended wrapper.
- Resolve the requested Noco target scope enough to classify the state check.
- Record every OK result in local logs or the user-visible status summary only.
- Send no new Telegram message for OK results. Existing readiness, run-summary, client, manual-vacancy, and parser-log sends still run exactly as they already do.
- For error results, immediately send one compact state alert to `summary_logs_channel_id` only.
- Do not send extra Dolphin/client-state check alerts to client chats.

Reportable error states include Dolphin closed/unreachable, an unexpected active orchestrator, a broken or missing scheduled task, and unresolved required target state.

## All-Market Launch Shape

Run `Ru`, wait for exit, then run `En`.

```powershell
$env:APP_DB = 'noco'
$env:ORCHESTRATOR_SUPERVISED = 'true'
$env:ORCHESTRATOR_CONCURRENCY = '3'
$env:ORCHESTRATOR_RESPONSE_LIMIT = '120'
$env:ORCHESTRATOR_WATCH_MS = '7200000'
$env:ORCHESTRATOR_IDLE_TIMEOUT_MS = '600000'
Remove-Item Env:\ORCHESTRATOR_CLIENT_IDS -ErrorAction SilentlyContinue
Remove-Item Env:\ORCHESTRATOR_CLIENT_NAMES -ErrorAction SilentlyContinue
Remove-Item Env:\ORCHESTRATOR_EXCLUDE_CLIENT_IDS -ErrorAction SilentlyContinue
Remove-Item Env:\ORCHESTRATOR_EXCLUDE_CLIENT_NAMES -ErrorAction SilentlyContinue
Remove-Item Env:\ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES -ErrorAction SilentlyContinue

$env:ORCHESTRATOR_WORK_WITH_MARKET = 'Ru'
npm run orchestrator

$env:ORCHESTRATOR_WORK_WITH_MARKET = 'En'
npm run orchestrator
```

If a detached or scheduled wrapper is needed, write wrapper stdout/stderr under `logs/`, keep the same env values, and make the wrapper run the two markets sequentially.

## Startup Verification

After launching each market:

- Confirm a new `logs/orchestrator-run-*.jsonl` appears.
- Confirm `run-start` or early market/client lifecycle records are for the requested market.
- Confirm a readiness report send starts and succeeds before Dolphin profile start events.
- Confirm blocked accounts are skipped before Dolphin starts.
- Confirm up to three clients can be in lifecycle startup/running state at once when enough ready targets exist.
- Confirm first batch reaches either `auto responder started` or a terminal global blocker.

If Dolphin/global preflight fails before profiles start, stop the market sequence and report the global blocker.

## Supervision Loop

While a run is alive:

- Poll the process and newest JSONL log.
- Watch `client-lifecycle` for profile lock, profile start, scenario open, auth check, responder start/stop, report send, profile stop, tag removal, and status restoration.
- Watch `client-final-status` for per-client outcomes.
- Watch `run-checkpoint`, `run-results`, `run-summary-*`, and `run-exit`.
- Treat one broken client as isolated unless the logs show a global preflight or shared infrastructure failure.
- If the log has no new meaningful events for about `ORCHESTRATOR_IDLE_TIMEOUT_MS`, classify the current state before acting.

## Expected Per-Client Lifecycle

1. Client run starts.
2. Automation profile lock is applied and verified.
3. Dolphin profile starts.
4. Scenario opens and reaches DOM content loaded.
5. HH auth is checked.
6. Manual vacancies are cleaned or kept.
7. Auto responder starts.
8. Auto responder reaches a terminal reason, manual-only state, daily limit, or watch/idle timeout.
9. Client Telegram report is sent.
10. Parser logs are sent or intentionally skipped.
11. Dolphin profile stops.
12. Automation tag is removed and verified.
13. Previous Dolphin status is restored.
14. Client final status is written.

## Cleanup Verification

For every profile that started, verify final status includes:

- `profileStopped: true`
- `profileTagRemoved: true`
- `profileTagVerifiedAfterRemove: true`
- `profileStatusRestored: true`
- report delivery status or an explicit report failure

If profiles remain open after a failed run, identify exact affected Dolphin profile IDs from logs and use only the existing Dolphin integration to stop those exact profiles.

## Scheduled Runs

When scheduling:

- If no time is supplied, schedule the next `04:40 GMT+3`.
- Convert the requested or default time to an absolute local date/time and include the timezone in the schedule notes.
- Verify AM/PM and date boundaries, especially for `GMT+3` versus local machine time.
- Run the extra Dolphin/client-state check immediately. If it is OK, do not send a new Telegram message. If it errors, report it to `summary_logs_channel_id` only.
- Include scheduled task metadata in the local check log when a task has been registered.
- Use the same all-market wrapper shape: `Ru` then `En`.
- Schedule a companion extra Dolphin/client-state check for one hour before launch. If the one-hour mark is already in the past, run that check immediately instead of creating a stale task.
- Ensure the one-hour precheck uses the same error-only Telegram rule: local logs only on OK, immediate Telegram alerts only on errors.
- Keep wrapper stdout/stderr in `logs/`.
- Confirm the scheduled task or background process exists and points at the intended wrapper.
- When the scheduled time arrives, perform the startup verification steps for `Ru`, then later for `En`.
