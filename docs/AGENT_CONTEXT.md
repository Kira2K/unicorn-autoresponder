# Agent Context

Read this first in future sessions to avoid rediscovering the repo.

## Five-Line Purpose

- This repo automates HH responses through Dolphin browser profiles.
- HH responses are one feature under `src/features/hh-responses`.
- Live automation data comes from Noco through `src/platform/db`.
- Google Sheets remains a legacy/comparison integration; do not use it for live
  HH data unless explicitly asked.
- Noco, Dolphin, Google Sheets, and Telegram APIs live under `src/integrations`.

## Architecture Map

| Need | Start Here |
| --- | --- |
| HH run/drop/auth/captcha/reload behavior | `src/features/hh-responses` |
| App data boundary and Noco/Sheets adapters | `src/platform/db` |
| Dolphin profile start/stop/preflight/locks | `src/integrations/dolphin` |
| Noco jobs, backups, health gates | `src/integrations/noco` |
| Telegram reports/tools | `src/integrations/telegram` |
| Diagnostics | `src/features/diagnostics` |
| Generated/local run evidence | `logs/` |

## Canonical Commands

```powershell
npm run orchestrator:test
npm run noco:test
npm run doctor:test
npm run dolphin:user-credentials:test
node src/integrations/dolphin/preflight.test.ts
npm run typecheck
```

Live HH smoke template:

```powershell
$env:APP_DB='noco'
$env:ORCHESTRATOR_CLIENT_NAMES='Кира'
$env:ORCHESTRATOR_WORK_WITH_MARKET='ru'
$env:ORCHESTRATOR_RESPONSE_LIMIT='5'
npm run orchestrator
```

## Current Dirty-File Policy

- `TODO.md` may contain user notes; do not edit or revert it unless asked.
- `docs/phone-inventory-for-later.json` is local inventory; leave it uncommitted
  unless a phone-inventory task needs it.
- Do not run Noco/Dolphin apply jobs during architecture/doc cleanup.

## Where To Look

- HH drops: latest run files under `logs/`, then HH result classification in
  `src/features/hh-responses/orchestrator`.
- Noco data/jobs: `src/integrations/noco/OPERATIONS.md` and job READMEs.
- Dolphin profile problems: `src/integrations/dolphin/preflight.ts`,
  `runtime.ts`, `profiles.ts`, and local Dolphin API output.
- Telegram reporting: HH report text in `src/features/hh-responses`, transport
  in `src/integrations/telegram`.
