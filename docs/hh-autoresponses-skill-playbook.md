# HH Autoresponses Skill Playbook

This document is the current end-to-end operating description for HH autoresponses and orchestrator runs. It is written as source material for a future Codex Skill, so it favors step order, decision rules, and stable commands over narrative.

## Coverage Audit

No existing Markdown file fully covered the current live scenario.

- `src/features/hh-responses/orchestrator/README.md` explains the orchestrator runtime flow and normal stop reasons, but it does not cover daily operation, scheduling, both-market runs, support calls, Noco readiness, or recent failure lessons.
- `docs/hh-orchestrated-run-instruction.md` captures the supervision principle, but it is narrower and partly stale: it was written around one RU run shape, older limits, and specific exclusions.
- `docs/DEBUGGING.md` contains useful snippets, especially around selected-client behavior, but it is not a runbook.
- `docs/AI_CONTEXT_FULL.md`, `docs/ONBOARDING.md`, and root TODO files contain broader project context, but they are not a complete HH autoresponses process.

This playbook should be the single scenario source until a real Codex Skill is created from it.

## Evidence Base

The workspace did not contain a `.codex` session-log directory, so this audit used repo-local HH automation logs and docs.

Audit window: 2026-04-26 through 2026-07-26.

Primary logs:

- `logs/orchestrator-run-*.jsonl`
- `logs/orchestrated-run-*.out`
- `logs/orchestrated-run-*.err`
- related Noco and Dolphin audit logs where they explain readiness or profile state

Three-month aggregate from `orchestrator-run-*.jsonl`:

- 431 JSONL run log files
- 277 `run-start` records
- 899 `client-final-status` records
- 20,746 recorded responses
- Markets: 788 RU final statuses, 111 EN final statuses

Most common final outcomes:

- `manual_targets_only`: 330
- `error_before_requirement`: 242
- `orchestrator_stop_after_watch`: 134
- `limit_reached`: 93
- `hh_response_daily_limit_exceeded`: 31
- `vacancy_processing_error`: 28
- `no_new_targets`: 15
- `parser_errors_only`: 6
- `auth_required`: 3
- `instance_lock_busy`: 1

Observed operational lessons:

- RU and EN are separate market invocations. When the user says "all", treat that as both RU and EN unless they explicitly narrow the scope.
- One bad client must not fail a 20-client run. Missing credentials, disabled clients, missing selected IDs, auth issues, or captcha should become per-client outcomes whenever possible.
- `hh_response_daily_limit_exceeded` is an HH-side terminal limit, not an internal bug.
- `manual_targets_only`, `no_new_targets`, `targets_processed`, `limit_reached`, `user_stop`, and HH daily limit are normal outcomes.
- Captcha is common. It is terminal for that client/profile, but it must not pause the whole orchestrator when concurrency has other work available.
- Dolphin local API availability is a process-level prerequisite. If Dolphin is not reachable on `http://localhost:3001/v1.0`, the run can fail before client work starts.
- Hardcoded `ORCHESTRATOR_CLIENT_IDS` for "all" runs causes stale selection and missed clients. Use DB-driven all-client selection for all-market runs.
- Stop-list behavior exists in production and has real log evidence through `COMPANY_STOP_LIST_SKIPPED`.

## Core Mental Model

There are two layers:

1. The orchestrator picks clients for one market, starts Dolphin profiles, locks/tags profiles, opens the HH scenario, injects the browser responder, monitors completion, sends Telegram reports, cleans up tags/status/profile state, and writes JSONL logs.
2. The browser responder runs inside HH, clicks real vacancies, applies stop-list/manual/error rules, sends responses, records parser logs, and writes its state into browser storage for the orchestrator to collect.

One client means one client profile in one market. The same person can have separate RU and EN profiles with separate scenarios and credentials.

An all-market run is not one magical command unless a wrapper handles both markets. It is conceptually:

1. Run all eligible RU targets.
2. Run all eligible EN targets.
3. Report both market summaries.
4. Verify no stale Dolphin profiles remain.

## Source Files

Primary orchestration:

- `src/features/hh-responses/cli/orchestrator.ts`
- `src/features/hh-responses/orchestrator/client-runner.ts`
- `src/features/hh-responses/orchestrator/clients.ts`
- `src/features/hh-responses/orchestrator/config.ts`
- `src/features/hh-responses/orchestrator/local-run-log.ts`
- `src/features/hh-responses/orchestrator/reporting.ts`
- `src/features/hh-responses/orchestrator/telegram-reporting.ts`
- `src/features/hh-responses/orchestrator/recovery.ts`

Browser responder:

- `src/features/hh-responses/browser-responder/index.js`
- `src/features/hh-responses/auto-responder/*`
- `src/features/hh-responses/shared/hh-storage.ts`

Auth:

- `src/features/hh-responses/hh-auth/orchestrator.ts`
- `src/features/hh-responses/hh-auth/make-hh-auth.ts`
- `src/features/hh-responses/hh-auth/auth-selectors.ts`
- `src/features/hh-responses/hh-auth/validate-auth.ts`

Data/readiness:

- `src/platform/db/types.ts`
- `src/platform/db/noco/noco-db.ts`
- `src/integrations/noco/hh-response-readiness/index.ts`

Stop-list:

- `src/features/hh-responses/orchestrator/blocked-companies.ts`
- `shared/company-stop-list.ts`
- Noco source fields/relations for `clients.stop_list_company` and `client_company_restrictions_from_stop_companies`

Diagnostics and tests:

- `src/features/diagnostics/orchestrator-run-analysis.ts`
- `src/features/hh-responses/cli/orchestrator.test.ts`
- `src/features/hh-responses/orchestrator/clients.test.ts`
- `src/features/hh-responses/orchestrator/config.test.ts`
- `src/integrations/noco/hh-response-readiness/index.test.ts`
- `src/platform/db/noco/noco-db.test.ts`

## Data Sources

For production runs, use Noco as the source of truth via `APP_DB=noco`.

The orchestrator target must contain:

- client name
- market: `Ru` or `En`
- stack
- HH scenario/search URL for that market
- Dolphin profile id
- common Telegram chat id
- HH email/phone/password credentials where login may be needed
- enabled/readiness flags
- stop-list sources

Do not trust cached client selections for "all" runs. Re-read Noco readiness close to launch time.

## Stop-List Behavior

Current production stop-list behavior:

1. Always add global `Comtek` for every client.
2. Merge company names from `clients.stop_list_company`.
3. Merge linked restriction companies from `client_company_restrictions_from_stop_companies`.
4. Merge run-only extras from `ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES` when explicitly testing.
5. Normalize/deduplicate by compact company name.
6. Skip matching vacancies through the normal `COMPANY_STOP_LIST_SKIPPED` path.

Important constraints:

- Do not permanently add random companies to a client just to test stop-list behavior.
- Use `ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES` for a run-local proof.
- `Trynexis` was a mock-only default and should not be reintroduced into default runtime behavior.
- Archive `client_company_restrictions_from_stop_companies` later only after data is consolidated into the client/profile source of truth.

Real proof pattern:

1. Use a test profile such as Kira.
2. Open the actual HH search/list page.
3. Collect real visible company names.
4. Pass around 10 observed names in `ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES`.
5. Run the normal responder.
6. Verify the skip count and parser logs include `COMPANY_STOP_LIST_SKIPPED`.

## Environment Knobs

Core:

- `APP_DB=noco`
- `ORCHESTRATOR_WORK_WITH_MARKET=ru` or `en`
- `ORCHESTRATOR_RESPONSE_LIMIT=<number>`
- `ORCHESTRATOR_SUPERVISED=true`
- `ORCHESTRATOR_CONCURRENCY=3`
- `ORCHESTRATOR_IDLE_TIMEOUT_MS=600000`
- `ORCHESTRATOR_WATCH_MS=7200000` for a 2-hour per-client cap

Selection:

- `ORCHESTRATOR_CLIENT_NAMES=<comma separated names>` for targeted runs
- `ORCHESTRATOR_CLIENT_IDS=<comma separated ids>` only for targeted runs where exact IDs are required
- `ORCHESTRATOR_EXCLUDE_CLIENT_NAMES=<comma separated names>` for exclusions
- `ORCHESTRATOR_EXCLUDE_CLIENT_IDS=<comma separated ids>` for exclusions
- `ORCHESTRATOR_CONTINUE_FROM_LOG=<path>` for recovery/continuation

Testing/smoke:

- `ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES=<comma separated names or JSON array>`

Auth/debug:

- `HH_AUTH_DEBUG=true`
- `HH_AUTH_TOTAL_TIMEOUT_MS=<ms>`
- `HH_SCENARIO_AUTH_MAX_RECHECKS=<number>`

Dolphin:

- `MAX_PREEXISTING_DOLPHIN_PROFILES=3`
- `DOLPHIN_PREFLIGHT_AUTO_CLEANUP=true`
- `DOLPHIN_KEEP_PROFILE_OPEN_AFTER_RUN=false`

Rules:

- Supervised default concurrency is 3 if `ORCHESTRATOR_CONCURRENCY` is not explicitly set.
- Unsupervised default concurrency remains 1.
- For live all-market runs, set the response limit explicitly. Do not rely on defaults.
- For long daily runs, use a 2-hour watch cap per client to avoid rotting concurrency.

## Readiness Procedure

Before a run:

1. Confirm the requested scope.
2. If the user says "all", include both RU and EN.
3. If they name clients, use selected-client mode by names whenever possible.
4. If scheduling, convert the requested time to an absolute trigger. For "5am GMT+3", that is `05:00` in UTC+3, not 5pm.
5. Check Noco readiness for missing scenario, disabled client, missing Dolphin profile, missing chat, missing credentials, or missing market-specific account.
6. Check Dolphin local API availability and current open profile count.
7. Check no stale automation locks/tags would block profiles.
8. Decide whether failures should exclude only those clients or block the whole run.

Readiness command pattern:

```powershell
$env:APP_DB='noco'
npm run noco:hh-response-readiness -- --market=ru --json
npm run noco:hh-response-readiness -- --market=en --json
```

Selected-client readiness pattern:

```powershell
$env:APP_DB='noco'
npm run noco:hh-response-readiness -- --market=en --client-names="Артем Пыркин,Кира" --json
```

If Noco responds with 429:

- Back off.
- Avoid repeated broad concurrent fetches.
- Prefer sequential readiness paths already implemented in code.
- Do not assume the DB data is missing just because one Noco request hit rate limits.

## Launch Procedure

Single market, all eligible clients:

```powershell
$env:APP_DB='noco'
$env:ORCHESTRATOR_SUPERVISED='true'
$env:ORCHESTRATOR_CONCURRENCY='3'
$env:ORCHESTRATOR_WORK_WITH_MARKET='ru'
$env:ORCHESTRATOR_RESPONSE_LIMIT='120'
$env:ORCHESTRATOR_WATCH_MS='7200000'
$env:ORCHESTRATOR_IDLE_TIMEOUT_MS='600000'
npm run orchestrator
```

Targeted client:

```powershell
$env:APP_DB='noco'
$env:ORCHESTRATOR_SUPERVISED='true'
$env:ORCHESTRATOR_CONCURRENCY='3'
$env:ORCHESTRATOR_WORK_WITH_MARKET='en'
$env:ORCHESTRATOR_CLIENT_NAMES='Артем Пыркин'
$env:ORCHESTRATOR_RESPONSE_LIMIT='50'
$env:ORCHESTRATOR_WATCH_MS='7200000'
$env:ORCHESTRATOR_IDLE_TIMEOUT_MS='600000'
npm run orchestrator
```

All markets:

1. Run the RU command.
2. Run the EN command.
3. Keep the same response limit and safety timers unless the user explicitly asks otherwise.
4. Do not pass hardcoded client IDs unless the user explicitly requested those exact IDs.

If one client has a setup problem in an all-client run:

- Skip that client with a clear reason.
- Continue other clients.
- Include the skipped client in the summary.

If the whole run fails before any clients start:

- Check Dolphin local API first.
- Check Noco availability second.
- Check whether too many Dolphin profiles were open before launch.
- Rerun only after the process-level issue is resolved.

## Scheduled Runs

For scheduled all-market runs:

1. Create or update a wrapper under `tmp/` that runs RU then EN.
2. Set `APP_DB=noco`.
3. Set `ORCHESTRATOR_SUPERVISED=true`.
4. Set `ORCHESTRATOR_CONCURRENCY=3`.
5. Set `ORCHESTRATOR_RESPONSE_LIMIT` to the user-requested limit.
6. Set `ORCHESTRATOR_WATCH_MS=7200000` for a 2-hour per-client cap.
7. Set `ORCHESTRATOR_IDLE_TIMEOUT_MS=600000`.
8. Do not set `ORCHESTRATOR_CLIENT_IDS` for an all-client run.
9. Register the task for the requested local absolute time.
10. Verify the task trigger says AM/PM correctly.

The wrapper may be local runtime state and does not need to be committed unless it becomes a maintained script.

## Supervision Loop

While a run is active:

1. Find the newest `logs/orchestrator-run-*.jsonl`.
2. Read the latest `run-start`, `client-lifecycle`, `client-final-status`, `run-checkpoint`, `run-results`, `run-summary-sent`, and `run-exit` lines.
3. Track running profiles, finished profiles, skipped profiles, response counts, manual counts, stop reasons, and time since last lifecycle event.
4. If a client appears idle for around 10 minutes, inspect that client, not the whole run.
5. If the profile hit captcha, auth, HH daily limit, manual-only, no-new-targets, or response limit, classify it and move on.
6. If there is no new lifecycle event and no open browser work, treat it as a stall and investigate.
7. Verify Telegram client reports and run summary were sent.
8. After run exit, verify Dolphin profiles are stopped and automation tags/statuses were cleaned.

Useful status command:

```powershell
Get-ChildItem logs -Filter 'orchestrator-run-*.jsonl' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 FullName,LastWriteTime,Length
```

For deeper summaries, use:

```powershell
npm run orchestrator:run-analysis -- --latest
```

If that script does not support the required filter yet, parse JSONL by `kind`:

- `run-start`
- `client-final-status`
- `run-results`
- `run-fatal-error`
- `run-exit`

## Outcome Taxonomy

Healthy or expected terminal outcomes:

- `targets_processed`
- `no_new_targets`
- `limit_reached`
- `manual_targets_only`
- `hh_response_daily_limit_exceeded`
- `user_stop`
- `orchestrator_stop_after_watch` when the watch cap intentionally stopped a long-running profile

Recoverable per-vacancy outcomes:

- `COMPANY_STOP_LIST_SKIPPED`
- `NO_APPLY_RETURNED` from an opened vacancy, until the profile reaches the conservative recovery threshold

Terminal per-client outcomes:

- captcha
- auth required or logged out when login cannot complete
- missing HH email/phone/password
- missing scenario
- missing Dolphin profile
- disabled selected client
- profile/browser disconnect
- selector breakage
- repeated recoverable vacancy failures beyond threshold, reported as `vacancy_recovery_limit_exceeded`

Process-level failures:

- Dolphin local API unreachable
- Dolphin local API invalid/stuck session
- too many pre-existing Dolphin profiles when preflight cannot clean them
- Noco unavailable for initial target selection
- broad code/config error before target selection

Support-call rules:

- Do not call support for normal HH/user outcomes: response limit, HH daily limit, manual-only, no-new-targets, targets processed.
- Do not call support just because one vacancy is broken and recoverable.
- Do call or mention `@veu_support` for actionable real failures such as auth validation/logged out, captcha requiring human action, broken HH UI selectors, or profile/data setup that the user cannot fix directly.
- For Kira/test proof runs, captcha is expected: stop that client and ask the user to solve it before retrying.

## Broken Vacancy Recovery

`NO_APPLY_RETURNED` means the vacancy/page was bad, not necessarily that the client profile is bad.

Expected behavior:

1. Mark that vacancy processed/skipped.
2. Record a parser warning.
3. Return to the search list.
4. Continue processing.
5. Do not set profile stop reason `vacancy_processing_error` for a single `NO_APPLY_RETURNED`.
6. Stop only after 5 consecutive recoverable vacancy failures in one profile.
7. Use stop reason `vacancy_recovery_limit_exceeded` for that threshold.

`ERROR_NO_MODAL` and `NO_CONFIRM` remain terminal unless intentionally reclassified later.

## Cleanup Checks

Every profile must end with:

- Dolphin profile stopped, unless the user explicitly requested keeping it open
- automation tag removed
- previous Dolphin status restored
- Telegram report sent or a clear report-send failure recorded
- final JSONL status written

If profiles remain open after a run:

1. Identify exact Dolphin profile IDs from the latest run log.
2. Try graceful stop through the existing Dolphin integration.
3. Only kill processes for exact affected profile IDs.
4. Never close unrelated user-opened profiles.

## Current Daily-Run Defaults

For normal daily all-client runs:

- Scope: both RU and EN
- Selection: all enabled/readiness-valid clients from Noco
- Limit: user-provided, commonly 120
- Concurrency: 3
- Per-client watch cap: 2 hours
- Idle timeout: 10 minutes
- Dolphin preflight maximum: 3 open profiles
- Kira exclusion: only when the user explicitly asks; do not keep old exclusions by habit
- New members: use the user-provided special limit if they give one, otherwise normal limit

## Code Change Policy

Before changing code:

1. Analyze existing code first.
2. Keep changes scoped to HH/orchestrator files.
3. Do not refactor unrelated modules.
4. Do not commit dirty unrelated docs, backups, web-console work, or proxy TODOs.

Relevant verification commands:

```powershell
npm run db:noco:test
npm run noco:hh-response-readiness:test
node src/features/hh-responses/orchestrator/clients.test.ts
node src/features/hh-responses/cli/orchestrator.test.ts
npm run orchestrator:test
```

Commit only after tests pass, unless the user explicitly instructs otherwise.

## Skill-Friendly Procedure

A future Skill should implement this workflow:

1. Parse the user's request into scope, markets, limits, exclusions, schedule, and supervision expectations.
2. Treat "all" as both RU and EN.
3. Use Noco readiness to build fresh targets.
4. Avoid hardcoded `ORCHESTRATOR_CLIENT_IDS` for all-client runs.
5. Verify Dolphin local API and preflight capacity.
6. Launch with supervised concurrency 3 unless overridden.
7. Watch JSONL logs and Dolphin state until every client is terminal or skipped with a reason.
8. Continue other clients when one client fails.
9. Classify normal HH outcomes separately from real failures.
10. Ask the user to solve captcha only for the affected profile.
11. Call/mention support only for actionable failures, not normal HH limits.
12. Confirm reports were sent and profiles were cleaned.
13. For scheduled runs, verify the exact absolute time and AM/PM.
14. For code changes, run the targeted test set and commit only related files.

Suggested Skill trigger phrases:

- "launch HH run"
- "run all HH autoresponses"
- "orchestrate HH responses until limit or clear reason"
- "schedule HH run"
- "check HH run status"
- "why no HH report"
- "verify Dolphin availability"
- "run Kira stop-list proof"
- "commit orch-related changes"

Suggested Skill inputs:

- `markets`: `ru`, `en`, or `both`
- `limit`: response limit per client
- `clientNames`: optional selected clients
- `excludeClientNames`: optional exclusions
- `scheduledAt`: optional absolute or relative time
- `watchMs`: per-client cap, default `7200000` for production daily runs
- `idleTimeoutMs`: default `600000`
- `concurrency`: default `3` when supervised
- `supportPolicy`: when to call or mention `@veu_support`
- `stopListSmokeCompanies`: optional run-only stop-list seed

Suggested Skill outputs:

- launch plan
- readiness problems
- exact command or scheduled task identity
- latest log path
- live status summary
- final per-client table
- support-needed list
- cleanup verification
- commit/test summary when code changed
