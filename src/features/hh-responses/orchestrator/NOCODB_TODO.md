# NocoDB Migration TODO

The orchestrator is expected to consume data through `src/platform/db` only.
NocoDB is now the live backend, and Google Sheets remains available behind the
same `createAppDb()` port for legacy diagnostics/comparison when explicitly
needed.

## Contract To Preserve

`getAutomationTargets()` / `getAutomationTargetByName()` must return:

- `clientName`
- `stack`
- `market`: `Ru` or `En`
- `stackSheetName`
- `stackScenario`
- `dolphinProfileId`
- `commonChatId`
- optional `coverText`
- optional `blockedCompanies: Array<{ id: string; name: string }>`

HH auth methods must return:

- `clientName`
- optional `commonChatId`
- optional `market`
- `phone`
- `rawPhone`
- `password`
- optional `email`
- optional `emailPassword`

## Migration Rules

- Do not import NocoDB helpers from HH orchestrator modules.
- Do not import Google Sheets helpers from HH orchestrator modules.
- Normalize NocoDB records inside the DB layer, not inside client runner logic.
- Keep `blockedCompanies` loaded once with the client profile, not per vacancy.
- Keep market/profile selection deterministic before the run starts.
- Missing required runtime data should fail before starting Dolphin when possible.

## Acceptance Check

These commands should keep working without orchestrator boundary changes:

```powershell
npm run orchestrator
npm run orchestrator:test
npm run typecheck
```
