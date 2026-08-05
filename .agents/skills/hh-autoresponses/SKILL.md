---
name: hh-autoresponses
description: Operate HH autoresponse orchestrator workflows in the hh-autoparcer repo. Use when Codex is asked to launch, schedule, supervise, check status, debug reports, verify Dolphin/Noco readiness, prove stop-list behavior, or change/commit HH autoresponse orchestration code. Default to all enabled ready profiles across Ru and En when no profile scope is supplied; for schedule requests without a time, use the next 04:40 GMT+3.
---

# HH Autoresponses

## Operating Model

- Treat "all profiles" or "all HH autoresponses" as both `Ru` and `En` markets unless the user narrows the scope.
- If the user asks to launch, run, or schedule HH autoresponses without naming profiles, clients, or exclusions, default to all enabled Noco targets that pass readiness.
- If the user does not name a market, default to both markets: `Ru` first, then `En`.
- Use Noco as production source of truth: `APP_DB=noco`.
- For all-profile runs, do not hardcode client IDs or names unless the user explicitly asks for a narrowed run.
- Run markets sequentially: start `Ru` first, then start `En` only after `Ru` exits.
- Use the production readiness flow before each market starts profiles. It must send a Telegram readiness report, skip blocked accounts before Dolphin starts, and launch only ready accounts.
- A broken client must not stop the market run. Treat captcha, auth, HH daily limit, manual vacancies, and no-terminal-stop-reason as per-client outcomes unless the whole process fails before profiles start.

## Default Invocation Behavior

When the user provides a minimal prompt such as `$hh-autoresponses launch`, `$hh-autoresponses run now`, or `$hh-autoresponses schedule for 04:40 GMT+3`, assume:

- scope: all enabled readiness-valid Noco targets
- markets: `Ru`, then `En`
- response limit: `120`
- concurrency: `3`
- watch window: 2 hours
- idle timeout: 10 minutes
- no client selection, client exclusion, or extra stop-list override

For scheduling:

- If the user asks to schedule without a time, schedule the next occurrence of `04:40 GMT+3`.
- If the user says `launch now`, `run now`, or otherwise asks for an immediate run, do not schedule; start immediately.
- If the requested schedule could mean more than one date, use the next future occurrence and state the exact date/time before registering it.

Ask for clarification only when the user gives conflicting scope, a schedule time that cannot be converted safely, or a risky instruction that would bypass readiness/cleanup.

## Default Runtime

Use these defaults unless the user specifies otherwise:

```powershell
$env:APP_DB = 'noco'
$env:ORCHESTRATOR_SUPERVISED = 'true'
$env:ORCHESTRATOR_CONCURRENCY = '3'
$env:ORCHESTRATOR_RESPONSE_LIMIT = '120'
$env:ORCHESTRATOR_WATCH_MS = '7200000'
$env:ORCHESTRATOR_IDLE_TIMEOUT_MS = '600000'
```

For all-client runs, explicitly clear narrowing and extra blocker variables:

```powershell
Remove-Item Env:\ORCHESTRATOR_CLIENT_IDS -ErrorAction SilentlyContinue
Remove-Item Env:\ORCHESTRATOR_CLIENT_NAMES -ErrorAction SilentlyContinue
Remove-Item Env:\ORCHESTRATOR_EXCLUDE_CLIENT_IDS -ErrorAction SilentlyContinue
Remove-Item Env:\ORCHESTRATOR_EXCLUDE_CLIENT_NAMES -ErrorAction SilentlyContinue
Remove-Item Env:\ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES -ErrorAction SilentlyContinue
```

## Launch Procedure

1. Inspect the repo docs and relevant source before changing behavior.
2. Verify no active HH orchestrator or node run is already alive.
3. Confirm Dolphin API/preflight readiness and Noco availability.
4. Start `Ru` with `ORCHESTRATOR_WORK_WITH_MARKET='Ru'` and `npm run orchestrator`.
5. Watch until a fresh `logs/orchestrator-run-*.jsonl` appears, the readiness report is sent, and the first batch is running or an auto responder has started.
6. After `Ru` exits, start `En` with `ORCHESTRATOR_WORK_WITH_MARKET='En'` and the same runtime defaults.
7. Confirm `En` sends its own readiness report before Dolphin preflight/profile starts.
8. Keep stdout/stderr wrapper logs under `logs/` for scheduled or detached runs.

For concrete command patterns, scheduling wrappers, log parsing, and cleanup checks, read `references/operations.md`.

## Monitoring Procedure

- Use the newest `logs/orchestrator-run-*.jsonl` as the run ledger.
- Follow `client-lifecycle`, `client-final-status`, `run-checkpoint`, `run-results`, `run-summary-*`, and `run-exit` records.
- Confirm concurrency is `3` by seeing up to three client lifecycle streams overlap in the market run.
- Watch for idle periods of about 10 minutes; distinguish idle from legitimate HH waiting or per-client terminal outcomes.
- Verify every started profile is stopped, its automation tag is removed, and previous Dolphin status is restored.
- Verify Telegram client reports and the final summary report are sent.

For failure classification and support/escalation rules, read `references/failure-taxonomy.md`.

## Stop-List Rules

- Always include global `Comtek`.
- Merge client-level `clients.stop_list_company`.
- Merge expanded company restrictions from stop-company records.
- Add `ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES` only as a run-only override when the user explicitly asks.
- Normalize, dedupe, and continue after stop-list skips. `COMPANY_STOP_LIST_SKIPPED` is a recoverable per-vacancy event.
- Do not reintroduce old mock defaults such as `Trynexis`.

## Code-Change Rules

- Keep edits scoped to HH/orchestrator/browser responder/readiness/reporting behavior.
- Preserve per-client failure isolation.
- Add or run targeted tests when changing stop-list logic, readiness filtering, recovery handling, scheduling, or report delivery.
- Never revert unrelated user changes or log artifacts.
