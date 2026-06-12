# Architecture Decisions

## HH Responses Are A Feature

HH response automation lives under `src/features/hh-responses` instead of the
repo root. Future product workflows should use their own `src/features/*`
folder and share APIs through platform/integration boundaries.

## Noco Is Live Automation Source

Noco is the default source of truth for live HH automation data. Google Sheets
code remains available for legacy diagnostics, comparison, and migration checks
only when a task explicitly needs it.

## External APIs Live In Integrations

Dolphin, Noco, Google Sheets, and Telegram request code belongs under
`src/integrations/<provider>`. Feature code should consume provider facades or
platform ports instead of importing raw request helpers.

## App Data Goes Through The DB Port

Feature code should read automation data through `createAppDb()` from
`src/platform/db`. The adapter decides whether data comes from Noco or legacy
Google Sheets.

## Root Is Not A Source Folder

Root compatibility wrappers were removed after the `src` migration. The root
`index.js` remains only because HH browser injection still uses that artifact.
