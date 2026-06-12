# HH Autoparcer

For future agents: read `docs/AGENT_CONTEXT.md` first.

## Canonical Commands

```powershell
npm run orchestrator:test
npm run noco:test
npm run doctor:test
npm run dolphin:user-credentials:test
node src/integrations/dolphin/preflight.test.ts
npm run typecheck
```

Run HH smoke with Noco data:

```powershell
$env:APP_DB='noco'
$env:ORCHESTRATOR_CLIENT_NAMES='Кира'
$env:ORCHESTRATOR_WORK_WITH_MARKET='ru'
$env:ORCHESTRATOR_RESPONSE_LIMIT='5'
npm run orchestrator
```
