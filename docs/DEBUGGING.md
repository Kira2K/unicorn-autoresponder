# Debugging

Use these commands to answer common questions without starting a live Dolphin run.

## Client Not Found

`ORCHESTRATOR_CLIENT_NAMES` is an exact match against the final mapped `clientName`.

```powershell
node check-table-state.ts --contains "Иван"
node doctor.ts --client "Иван"
```

If the sheet has raw Dolphin name `Иван` but the mapper resolves the final name as `Иван Меркулов`, run with:

```powershell
$env:ORCHESTRATOR_CLIENT_NAMES='Иван Меркулов'; node orchestrator.ts
```

## Environment

```powershell
node doctor.ts --env
```

This prints the selectors and timing env vars that usually explain why a run picked different clients or markets than expected.

## New PC Setup

Run these checks before starting real HH automation on a fresh machine:

1. Fill `.env`, especially `dolphin_api_token` and the selected DB credentials.
2. Open Dolphin Anty and wait until the app is fully loaded.
3. Run the non-HH auth preflight:

```powershell
node doctor.ts --auth-preflight --client "Кира" --stop-before-hh
```

This seeds the Dolphin Local API JWT through `/v1.0/auth/login-with-token`,
checks the selected client metadata, and intentionally skips Dolphin profile
start, HH navigation, HH login, captcha checks, and auto-responder injection.

4. Verify the selected client:

```powershell
node doctor.ts --client "Кира"
```

5. Only after the non-HH checks pass, run an explicit HH/profile smoke if that
is wanted for the day.

## Dolphin Auth Contract

- Dolphin Cloud API calls use `Authorization: Bearer <dolphin_api_token>`.
- Dolphin Local API calls do not receive a bearer header on every request.
  Instead, the Local API stores the remote JWT with:

```text
POST http://localhost:3001/v1.0/auth/login-with-token
body: { "token": "<dolphin_api_token>" }
```

The orchestrator preflight performs this local token seeding before checking
profile counts or starting any client runs.

## Table State

```powershell
node check-table-state.ts
node check-table-state.ts --name "Иван Меркулов"
node check-table-state.ts --contains "Иван"
node check-table-state.ts --contains "Иван" --json
```

Use `--name` to mirror exact orchestrator selection. Use `--contains` for discovery.

## Refactor Safety

```powershell
npm run typecheck
npm run test:refactor
```

In this Codex environment, `node`/`npm` may not be on `PATH`. The bundled Node path that has worked is:

```powershell
& 'C:\Users\kiras\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\OpenAI\Codex\bin\node.exe' .\node_modules\typescript\bin\tsc --noEmit
& 'C:\Users\kiras\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\OpenAI\Codex\bin\node.exe' refactor-checks.ts
```

## Runtime Failures

- Auth failures: start from the local run log in `logs/`, then inspect the `authBeforeStart`, `authAfterParserStop`, and parser error code fields.
- Profile start failures: check Dolphin Local API token seeding, running profile count, and whether the profile is already locked/tagged.
- Missing scenario failures: run `check-table-state.ts --strict` to catch enabled targets with no stack scenario URL.
