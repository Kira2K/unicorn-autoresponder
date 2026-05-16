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
- Profile start failures: check Dolphin app health, running profile count, and whether the profile is already locked/tagged.
- Missing scenario failures: run `check-table-state.ts --strict` to catch enabled targets with no stack scenario URL.
