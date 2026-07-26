# Debugging

Use these commands to answer common questions without starting a live HH run.
Noco is the default source for live automation data. Google Sheets is legacy or
advisory unless a task explicitly asks for it.

## Client Not Found

`ORCHESTRATOR_CLIENT_NAMES` is an exact match against the final Noco
`clientName`. Use discovery first when you only know a short/raw name:

```powershell
$env:APP_DB='noco'; npm run check-table -- --contains "Иван"
$env:APP_DB='noco'; npm run doctor -- --client "Иван"
```

If discovery shows the exact enabled name is `Иван Меркулов`, run with that
exact value:

```powershell
$env:APP_DB='noco'
$env:ORCHESTRATOR_CLIENT_NAMES='Иван Меркулов'
$env:ORCHESTRATOR_WORK_WITH_MARKET='ru'
$env:ORCHESTRATOR_RESPONSE_LIMIT='3'
npm run orchestrator
```

Selected-client-ID runs now report missing/disabled IDs as skipped statuses in
the run summary instead of aborting every selected client.

## Environment

```powershell
npm run doctor -- --env
```

This prints selectors and timing env vars that usually explain why a run picked
different clients or markets than expected.

## New PC Setup

Run these checks before starting real HH automation on a fresh machine:

1. Fill `.env`, especially `dolphin_api_token` and selected DB credentials.
2. Open Dolphin Anty and wait until the app is fully loaded.
3. Seed/check Dolphin auth without starting profiles:

```powershell
$env:APP_DB='noco'; npm run doctor -- --auth-preflight --client "Кира" --stop-before-hh
```

This seeds the Dolphin Local API JWT through `/v1.0/auth/login-with-token`,
checks selected client metadata, and intentionally skips Dolphin profile start,
HH navigation, HH login, captcha checks, and auto-responder injection.

4. Verify selected client data:

```powershell
$env:APP_DB='noco'; npm run doctor -- --client "Кира"
```

5. Only after non-HH checks pass, run an explicit HH/profile smoke if needed.

## Dolphin Auth Contract

- Dolphin Cloud API calls use `Authorization: Bearer <dolphin_api_token>`.
- Dolphin Local API calls seed the remote JWT once through:

```text
POST http://localhost:3001/v1.0/auth/login-with-token
body: { "token": "<dolphin_api_token>" }
```

The orchestrator preflight performs this local token seeding before checking
profile counts or starting any client runs.

## Table State

```powershell
$env:APP_DB='noco'; npm run check-table
$env:APP_DB='noco'; npm run check-table -- --name "Иван Меркулов"
$env:APP_DB='noco'; npm run check-table -- --contains "Иван"
$env:APP_DB='noco'; npm run check-table -- --contains "Иван" --json
```

Use `--name` to mirror exact orchestrator selection. Use `--contains` for
discovery.

## Live Smoke

```powershell
$env:APP_DB='noco'
$env:ORCHESTRATOR_CLIENT_NAMES='Кира'
$env:ORCHESTRATOR_WORK_WITH_MARKET='ru'
$env:ORCHESTRATOR_RESPONSE_LIMIT='5'
npm run orchestrator
```

This may create HH responses if the profile is logged in and no captcha blocks
the run.

## Refactor Safety

```powershell
npm run orchestrator:test
npm run noco:test
npm run doctor:test
npm run dolphin:user-credentials:test
node src/integrations/dolphin/preflight.test.ts
npm run typecheck
```

## Runtime Failures

- Auth failures: start from `logs/`, then inspect `authBeforeStart`,
  `authAfterParserStop`, and parser error code fields.
- Profile start failures: check Dolphin Local API token seeding, running profile
  count, and whether the profile is already locked/tagged.
- Missing scenario failures: run `npm run check-table -- --strict` to catch
  enabled targets with no stack scenario URL.
