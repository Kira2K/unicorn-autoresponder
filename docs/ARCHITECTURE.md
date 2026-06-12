# Architecture

This project is script-shaped, but the source now has clear feature,
integration, and platform boundaries. Start from `docs/AGENT_CONTEXT.md` when a
future session needs the shortest map.

## Current Layout

| Area | Owns |
| --- | --- |
| `src/features/hh-responses` | HH automation: client lifecycle, HH auth, scenario opening, browser responder injection, reporting, recovery, and HH-specific helpers. |
| `src/features/diagnostics` | Read-only diagnostics such as doctor, table-state checks, and refactor safety checks. |
| `src/platform/db` | The `createAppDb()` application data port plus Noco and Google Sheets adapters. |
| `src/platform/browser` | Generic Playwright/page helpers that are not HH-specific. |
| `src/integrations/dolphin` | Dolphin Cloud/Local APIs, profile locks, preflight, runtime start/stop, and Dolphin tools. |
| `src/integrations/noco` | NocoDB core helpers, operational jobs, backups, relation checks, and migration health gates. |
| `src/integrations/google-sheets` | Raw Google Sheets access and legacy comparison/mapping helpers. |
| `src/integrations/telegram` | Telegram messaging and Telegram operational tools. |

Root legacy entrypoints were removed. `index.js` remains at the root because it
is the browser responder artifact injected into HH pages.

## Entry Points

- `npm run orchestrator` runs HH responses from `src/features/hh-responses`.
- `npm run doctor` and `npm run check-table` run diagnostics from
  `src/features/diagnostics`.
- `npm run noco:*` jobs run from `src/integrations/noco`.
- `npm run dolphin:user-credentials:*` and `npm run proxy:check-required` run
  Dolphin integration tools.
- `npm run tg:*` runs Telegram tools from `src/integrations/telegram`.

## Boundaries

- Features consume platform or integration facades, not raw provider request
  helpers.
- HH automation reads live automation data through `createAppDb()`.
- Noco is the default live automation source. Google Sheets code remains for
  legacy diagnostics and comparison unless a task explicitly says otherwise.
- Dolphin profile lifecycle goes through `src/integrations/dolphin/index.ts`.
- Telegram reporting goes through the Telegram integration, while HH-specific
  report text stays in the HH feature.

## Refactor Rules

- Put new product workflows under `src/features/<feature-name>`.
- Put reusable external API code under `src/integrations/<provider>`.
- Put provider-neutral runtime abstractions under `src/platform`.
- Keep browser-responder storage keys backward-compatible with HH orchestrator
  readers.
- Prefer adding architecture tests when moving boundaries so stale imports and
  stale docs fail quickly.
