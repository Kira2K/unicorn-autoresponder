---
name: hh-autoresponses
description: Launch, schedule, supervise, stop or diagnose HH autoresponses and prepare their Windows VDS deployment in hh-autoparcer. Includes market database flags, CAPTCHA recognition, PostgreSQL/Dolphin readiness and reports. Default to all enabled ready profiles, Ru then En; schedule without a time for the next Monday-Thursday 04:40 GMT+3.
---

# HH Autoresponses

## First action on activation

Run the maintained [first service check](scripts/first-check.ps1) before this
workflow's external actions:

```powershell
powershell -NoProfile -File .agents/skills/hh-autoresponses/scripts/first-check.ps1
```

Default `inspect` tests Node/dependencies, PostgreSQL, Dolphin local/cloud,
other HH processes, bot destinations and the pinned Codex CLI version/login.
It opens no student profile, sends no successful probe message and performs no
model inference. Failure blocks launching; read-only diagnosis, dependency
installation and repair may continue. Use `-EnvFile C:\private\hh.env` on a VDS.

Before deployment or scheduling use `-Mode full`: it also requires idle Dolphin
and performs one short image-only `gpt-6.1-sol` test on synthetic CAPTCHA text.
No application is created; temporary images are deleted in `finally`. Check
structured results, not just login. The launch command independently repeats a
full preflight under its own Windows principal; a remembered pass cannot bypass
it. Extra checks stay silent in Telegram when OK and alert the manager only on
failure. See [deployment](../../../docs/hh-supervised-deployment.md).

Use `npm run hh:supervised` for live runs. It controls the existing orchestrator
and concurrency queue, performs readiness before each market and keeps normal
history, reports and cleanup. Browser actions and polling stay in code. Only
CAPTCHA pixels enter an ephemeral `gpt-6.1-sol` invocation (high reasoning by
default); use the user's explicit model choice. Project dependencies supply the
pinned CLI and image library; no VS Code path or chat history is required.

Recognition defaults to 200 calls and a 1,500,000-token admission budget, reserving
20,000 per concurrent call. Cached input is part of input. Unknown usage is not
zero: retain the reservation and close the provider. The campaign includes its
model preflight call in the counters. This admission budget is not an exact
provider billing cap. Preserve English selection, image identity checks, bounded
attempts and cancellation. Never replay an uncertain application/submission.
Images belong only under `tmp/captcha/` and are removed on success/error.

A shared executable/auth/provider failure, unconfirmed cleanup or required
delivery stops the sequence. Individual login, CAPTCHA rejection, daily-limit,
manual-only or no-new-targets outcomes remain isolated. Verify provider health,
counts, delivery and cleanup alongside `phase`; a complete queue is not proof
that every student reached quota. Check live PIDs, not stale status alone.

## Standard stop and restart recovery

“Stop/disable HH responses for a named student/market” means turn off that
market's database flag, not merely inspect or close the browser:

```powershell
npm run hh:flag -- --client-name="Student Name" --market=ru --disable
```

This validates the canonical client, changes only `Делаем_отклики_Ru` (or En),
keeps the other market unchanged and rereads the result. Never disable clients
automatically for CAPTCHA/auth failures. Queued profiles reread their flag before
starting. An already active browser is a separate scoped graceful-stop operation
with normal reporting and cleanup.

After a Windows restart preserve the stale owner lock. Inspect with `npm run
hh:recover -- --run-dir=<absolute campaign directory>`. After confirming neither
host has an active runner, use `--apply` for scoped cleanup. It never sends
applications or replays uncertain reports. Use remaining quotas only with
proven counts and explicitly narrowed recovery; omit the map for a full market.

HH Profile Filler is operationally independent. Never invoke it from an autoresponse wrapper,
`finally` block, or autoresponse scheduled task.

## Operating Model

- Treat "all profiles" or "all HH autoresponses" as both `Ru` and `En` markets unless the user narrows the scope.
- If the user asks to launch, run, or schedule HH autoresponses without naming profiles, clients, or exclusions, default to all enabled database targets that pass readiness.
- If the user does not name a market, default to both markets: `Ru` first, then `En`.
- Use working PostgreSQL as the source of truth: `APP_DB=postgres`. Set `APP_DB_POSTGRES_*` for the working database on the runner machine. Use `npm run hh:readiness -- --market=ru` (or `--market=en`) for the same storage-aware preflight; never force Noco for SQL runs.
- For all-profile runs, do not hardcode client IDs or names unless the user explicitly asks for a narrowed run.
- Run markets sequentially: start `Ru` first, then start `En` only after `Ru` exits.
- Use the production readiness flow before each market starts profiles. It must send a Telegram readiness report, skip blocked accounts before Dolphin starts, and launch only ready accounts.
- A broken client must not stop the market run. Treat captcha, auth, HH daily limit, manual vacancies, and no-terminal-stop-reason as per-client outcomes unless the whole process fails before profiles start.

## Default Invocation Behavior

When the user provides a minimal prompt such as `$hh-autoresponses launch`, `$hh-autoresponses run now`, or `$hh-autoresponses schedule for 04:40 GMT+3`, assume:

- scope: all enabled readiness-valid database targets
- markets: `Ru`, then `En`
- response limit: `100`
- concurrency: `4`
- watch window: 2 hours
- idle timeout: 10 minutes
- no client selection, client exclusion, or extra stop-list override

For scheduling:

- If the user asks to schedule without a time, schedule the next Monday-Thursday occurrence of `04:40 GMT+3`.
- Only launch or schedule routine autoresponses Monday through Thursday. If the user asks to launch immediately on Friday, Saturday, or Sunday, stop/avoid launch and ask for an explicit weekend override.
- If the user says `launch now`, `run now`, or otherwise asks for an immediate run on Monday through Thursday, do not schedule; start immediately.
- If the requested schedule could mean more than one date, use the next future occurrence and state the exact date/time before registering it.
- For schedule requests, verify Dolphin/client state immediately and schedule the same check for one hour before launch. These extra checks are silent in Telegram when OK and report only error results.

Ask for clarification only when the user gives conflicting scope, a schedule time that cannot be converted safely, or a risky instruction that would bypass readiness/cleanup.

## Default Runtime

Use these defaults unless the user specifies otherwise:

```powershell
$env:APP_DB = 'postgres'
$env:ORCHESTRATOR_SUPERVISED = 'true'
$env:ORCHESTRATOR_CONCURRENCY = '4'
$env:ORCHESTRATOR_RESPONSE_LIMIT = '100'
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
3. Confirm Dolphin API/preflight readiness and PostgreSQL availability. For this extra Dolphin/client-state check, send new Telegram messages only if the check errors.
4. Start `npm run hh:supervised` (Ru then En). Explicit scope uses `--markets=en`; explicit parameters use `--limit=100 --concurrency=4`. Named scope uses `--client-names="Name One,Name Two"`. The full preflight runs before profiles.
5. Watch until a fresh `logs/orchestrator-run-*.jsonl` appears, the readiness report is sent, and the first batch is running or an auto responder has started.
6. The supervisor starts En only after Ru exits with verified cleanup, provider health and required reports. Never start a second launcher manually while it runs.
7. Confirm `En` sends its own readiness report before Dolphin preflight/profile starts.
8. Keep stdout/stderr wrapper logs under `logs/` for scheduled or detached runs.

For concrete command patterns, scheduling wrappers, log parsing, and cleanup checks, read `references/operations.md`.

## Monitoring Procedure

- Use the newest `logs/orchestrator-run-*.jsonl` as the run ledger.
- Follow `client-lifecycle`, `client-final-status`, `run-checkpoint`, `run-results`, `run-summary-*`, and `run-exit` records.
- Confirm the requested concurrency (default `4`) through overlapping client lifecycle streams and the run-start record.
- Watch for idle periods of about 10 minutes; distinguish idle from legitimate HH waiting or per-client terminal outcomes.
- Verify every started profile is stopped, its automation tag is removed, and previous Dolphin status is restored.
- Verify Telegram client reports and the final summary report are sent.
- For manual status or debug checks, include Dolphin/client-state verification. Keep OK results local; send new Telegram messages only for error results.

For failure classification and support/escalation rules, read `references/failure-taxonomy.md`.

## Extra Dolphin And Client-State Checks

- Run the extra state check at schedule time, one hour before a scheduled launch, launch preflight, and manual status/debug time.
- Reuse existing repo mechanisms: Dolphin integration/preflight checks, configured database readiness/target inspection, process checks, local logs, and `sendTelegramMessage` from the existing Telegram messenger when an error alert is needed.
- Check Dolphin app/API reachability, unexpected active HH orchestrator/node runs, scheduled task integrity when applicable, and whether selected database target state can be resolved.
- Write every check result to local logs or the user-visible status summary.
- Do not send new Telegram messages for OK check results.
- For error results, immediately send one compact state alert to `summary_logs_channel_id` only.
- Do not send extra Dolphin/client-state check alerts to client chats.
- Do not alter existing Telegram sending behavior for readiness reports, run summaries, client final reports, manual-vacancy reports, or parser logs.

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
- Before claiming release readiness run `npm run hh:supervised:test`, `npm run orchestrator:test` and typecheck. Follow deployment docs for a clean checkout, same-principal model preflight, VDS canary, schedule and rollback. Synthetic recognition and unit tests do not prove real HH accepted a CAPTCHA on the target VDS. Never invoke Profile Filler from this workflow.
