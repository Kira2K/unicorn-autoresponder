# HH Orchestrated Run Instruction

Use this instruction when you want Codex to launch and actively supervise an HH responses run until every selected client has a terminal outcome.

## Short Command

```text
Launch HH responses run and orchestrate until terminal outcome per client, do not just launch and leave it.
```

## Full Instruction

```text
Launch HH responses run.

Goal: keep orchestrating until every selected client either:
1. successfully reaches ORCHESTRATOR_RESPONSE_LIMIT, or
2. exits with a clear terminal reason such as captcha, auth failed, no vacancies/manual-only, profile lock busy, Dolphin/profile error, HH unavailable, repeated idle timeout, or another explicit reason visible in logs.

Use:
- APP_DB=noco
- ORCHESTRATOR_WORK_WITH_MARKET=ru
- ORCHESTRATOR_RESPONSE_LIMIT=170
- ORCHESTRATOR_WATCH_MS=disabled
- exclude disabled clients such as Kira
- continue from unfinished clients when a previous run already completed some clients

Operating rules:
- Do not stop the whole orchestrator because one client hits captcha/auth/profile trouble.
- If one client blocks, capture the reason, clean up the Dolphin profile/status/tag, and continue to the next client.
- Monitor the run continuously instead of only launching it.
- Pay special attention to runs where nothing happens.
- If stdout, JSONL logs, response count, or client lifecycle events do not change for 10 minutes, inspect the run as stuck.
- For a stuck client, check process state, latest JSONL event, stdout/stderr, active Dolphin profile, HH auth/captcha indicators, and whether response count is moving.
- If the client is truly idle and not waiting on an explicit captcha/auth action, stop/clean that client and continue.
- Send or verify checkpoint reporting after every client.
- At the end, verify there is a final summary, or explain exactly why final summary could not be produced.
- Keep the user updated when a client finishes, when a client gets stuck, when a clear failure reason appears, and when the run has to be continued/restarted.

Before launching:
- Confirm no old orchestrator Node process is still running.
- Confirm no stale automation Dolphin profiles are left running from previous attempts.
- Confirm the selected client list excludes disabled clients.
- Confirm the run limit and market in the run-start log after launch.

Terminal outcome definition:
- Success: client reaches ORCHESTRATOR_RESPONSE_LIMIT.
- Clear failure: captcha, auth failed, manual-only/no auto targets, profile lock busy, Dolphin start/stop/profile error, HH/network unavailable, parser fatal error, or repeated idle timeout with evidence from logs.
- Not acceptable: ordinary 15-minute watch timeout while the browser is still making progress. Disable the watch timer for this mode and use the idle policy instead.
- Not acceptable: process disappears with no run-exit, no run-results, no checkpoint, and no explanation. In that case, inspect, clean stale state, and relaunch/continue from unfinished clients.
```

## Minimal Setup To Mention

```text
Kira is disabled.
Dolphin is running.
Use Noco clients.
Market ru.
Limit 170.
Same exclusions as last time.
Continue from unfinished clients.
```

## Status Checks Codex Should Use

```powershell
Get-Process node,powershell -ErrorAction SilentlyContinue
Get-ChildItem logs -File -Filter 'orchestrator-run-*.jsonl' | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name,LastWriteTime,Length
Select-String -Path logs\orchestrator-run-*.jsonl -Pattern 'kind":"client-final-status|kind":"run-checkpoint|kind":"run-results|kind":"run-exit|run-fatal-error|captcha|event":"client run started|event":"auto responder data collected|event":"client run finished'
```

Use the newest run log unless the user names a specific run.
