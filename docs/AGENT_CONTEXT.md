# Agent Context

Read this first in future sessions to avoid rediscovering the repo. For human
onboarding, use [ONBOARDING.md](./ONBOARDING.md). For the long AI-friendly
feature map, use [AI_CONTEXT_FULL.md](./AI_CONTEXT_FULL.md).

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
| TDLib accounts and admin dialog collection | `docs/TELEGRAM_ADMIN_DIALOG_BACKEND.md` |
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

- `TODO.md` was an obsolete scratch file with sensitive-looking notes and should
  stay removed. Do not recreate scratch files with credentials or personal data.
- `docs/phone-inventory-for-later.json` is local inventory; leave it uncommitted
  unless a phone-inventory task needs it.
- Do not run Noco/Dolphin apply jobs during architecture/doc cleanup.
- Before any live Noco schema or relation change, run `npm run
  noco:full-backup:apply`, document the intended old/new state, then run `npm
  run noco:contract-check` before and after the change. Treat relation type,
  column type/name, FK, and delete operations as production migrations.

## Where To Look

- HH drops: latest run files under `logs/`, then HH result classification in
  `src/features/hh-responses/orchestrator`.
- Noco data/jobs: `src/integrations/noco/OPERATIONS.md` and job READMEs.
- Dolphin profile problems: `src/integrations/dolphin/preflight.ts`,
  `runtime.ts`, `profiles.ts`, and local Dolphin API output.
- Telegram reporting: HH report text in `src/features/hh-responses`, transport
  in `src/integrations/telegram`.
- TDLib-backed client/admin Telegram: read
  `docs/TELEGRAM_ADMIN_DIALOG_BACKEND.md` before changing proxy, session, or
  dialog collection behavior.
