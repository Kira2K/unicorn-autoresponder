# NocoDB Migration TODO

The orchestrator is already expected to consume data through `db/` only. When the
backend moves from Google Sheets to NocoDB, keep the orchestrator API stable and
replace the implementation behind `createAppDb()`.

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

- Do not import NocoDB helpers from `orchestrator/*`.
- Do not import Google Sheets helpers from `orchestrator/*`.
- Normalize NocoDB records inside the DB layer, not inside client runner logic.
- Keep `blockedCompanies` loaded once with the client profile, not per vacancy.
- Keep market/profile selection deterministic before the run starts.
- Missing required runtime data should fail before starting Dolphin when possible.

## Acceptance Check

After NocoDB becomes the backend, these commands should still work without
orchestrator changes:

```powershell
npm run orchestrator
npm run orchestrator:test
npm run typecheck
```

