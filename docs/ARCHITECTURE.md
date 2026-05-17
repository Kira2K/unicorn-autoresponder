# Architecture

This project is still intentionally script-shaped, but the orchestration code is split by responsibility so future debugging can start in the right file instead of loading the whole runner.

## Entry Points

- `orchestrator.ts` is the public facade and CLI entry point.
- `doctor.ts` is for quick local diagnostics without starting Dolphin profiles.
- `check-table-state.ts` inspects Google Sheet mapping and explains client-name lookup issues.
- `refactor-checks.ts` is the lightweight regression suite for refactor-sensitive behavior.

## Main Modules

- `orchestrator/client-runner.ts` owns the one-client lifecycle: profile start, browser connection, auth checks, auto-responder run, reporting, cleanup.
- `orchestrator/clients.ts` owns configured client selection helpers. Name selection is exact by design.
- `orchestrator/scenario-runner.ts` opens HH scenarios and injects the auto-responder script.
- `orchestrator/reporting.ts` is the reporting facade over `orchestrator/telegram-reporting.ts`.
- `orchestrator/config.ts` contains shared environment/config constants.
- `dolphin/index.ts` is the single Dolphin import surface used by the orchestrator.
- `auto-responder/browser.ts` is the single auto-responder browser import surface.
- `browser/` contains generic Playwright/page helpers that are not HH-specific.
- `db/` is the new public data boundary. New data access should start from
  `createAppDb()` instead of importing Google Sheets helpers directly.
- `sheets/automation-mapper.ts` maps raw Google Sheet rows into enabled automation targets.
- `google-sheets-check.ts` is the older sheet CLI/API surface kept for compatibility.

Current DB boundary consumers:

- `tgChatIdChecker/` reads student Telegram records through `createAppDb()`.
- `dolphin/proxyProvider/checkRequiredProxy/` reads proxy-required clients through `createAppDb()`.
- `hh-auth/` fallback credential reads use `createAppDb()`.
- `orchestrator.ts` reads automation targets and attached HH credentials through
  `createAppDb()`.

Remaining direct `google-sheets-check.ts` imports are legacy wrappers or
diagnostic scripts: `sheets/*`, `doctor.ts`, and `check-table-state.ts`.

## Current Boundaries

The biggest remaining file is `orchestrator/client-runner.ts` because it still contains the business workflow. That is deliberate for now: the recent refactors moved infrastructure away from the runner without changing auth, retry, status, logging, or profile lifecycle behavior.

Good next extractions, when business-logic refactoring is allowed:

- Migrate existing Google Sheets consumers to `db/` one by one before adding
  the NocoDB implementation behind the same interface.
- Run phases into `orchestrator/phases/`.
- Auth decision handling into an HH-specific auth workflow module.
- Telegram report composition into smaller report builders.
- Client lifecycle events into a small recorder object.

Until then, prefer adding diagnostics and tests around the runner rather than moving its core branches.
