# AI Context Full

This is the long-form context file for AI agents and engineers who need to work
inside the repo without rediscovering the system. For a human onboarding path,
start with [ONBOARDING.md](./ONBOARDING.md). For the shortest agent reminder,
use [AGENT_CONTEXT.md](./AGENT_CONTEXT.md).

## System Purpose

The repo automates client career operations around HH responses, profile data,
Dolphin browser profiles, Telegram communication, CV workflow handoffs, and
NocoDB operational maintenance. The codebase is script-shaped, but it now has
clear feature, integration, and platform boundaries.

NocoDB is the live source of truth. Google Sheets remains in the repo for
legacy diagnostics, comparison, and migration history. Do not use Google Sheets
for live HH automation unless the task explicitly asks for that path.

## Source Map

| Path | Meaning |
| --- | --- |
| `src/features/hh-responses` | HH automation feature: client selection, HH auth, scenario run, browser responder integration, result classification, Telegram/local reporting. |
| `src/features/web-console` | Web app feature: Express backend, Vue frontend, auth/session roles, client/provider/admin dashboards, Telegram tools, Dolphin leases, AI CV tailoring. |
| `src/features/diagnostics` | Read-only diagnostics, environment checks, table-state checks, run analysis, refactor guards. |
| `src/platform/db` | Application data port and adapters. Live default is Noco. Sheets adapter is legacy. |
| `src/platform/browser` | Browser helpers that are not HH-specific. |
| `src/integrations/dolphin` | Dolphin Cloud/Local clients, preflight, runtime start/stop, locks, profile audit/assignment/proxy tooling. |
| `src/integrations/noco` | Noco core API helpers, reports, backups, relation health, readiness and cleanup jobs. |
| `src/integrations/telegram` | Telegram Bot API worker, TDLib client, resume workflow state machine, live e2e tools. |
| `src/integrations/google-sheets` | Legacy raw Sheets access and comparison helpers. |
| `index.js` | Browser-side HH responder artifact injected into HH pages. It intentionally remains at repo root. |
| `logs/` | Generated local evidence and reports. Usually read latest summaries first. |

## Feature Inventory

### HH Auto-Responses

Entrypoint: `npm run orchestrator`.

Main code:
- `src/features/hh-responses/cli/orchestrator.ts`
- `src/features/hh-responses/orchestrator/*`
- `src/features/hh-responses/hh-auth/*`
- root `index.js`

Runtime outline:
1. Load enabled clients through `createAppDb()`.
2. Apply configured client filters by names, IDs/common chat IDs, market, and
   response limits.
3. Attach blocked-company data and HH auth credentials.
4. Lock/tag Dolphin profiles and seed Dolphin Local API auth.
5. Ensure HH auth before cleanup/scenario work.
6. Run manual/saved vacancies cleanup.
7. Open the HH scenario URL.
8. Inject `index.js` and wait for browser-side completion or orchestrator watch.
9. Read browser storage for stop reason, parser logs, errors, recent URLs,
   manual vacancies, and response count.
10. Classify result, report to Telegram/logs, stop profile, restore tags/status.

Current worktree fact: selected-client-ID runs use best-effort selection for
common chat IDs. Missing or disabled IDs and HH credential attach failures are
turned into skipped statuses and included in local run logs and summary
reporting instead of aborting the whole selected run.

Canonical docs:
- [HH Orchestrator README](../src/features/hh-responses/orchestrator/README.md)
- [HH Orchestrated Run Instruction](./hh-orchestrated-run-instruction.md)
- [Debugging](./DEBUGGING.md)

### NocoDB Operations

Entrypoints are `npm run noco:*` scripts in `package.json`.

Noco owns live client data, platform accounts, native relations, Dolphin binding
records, stop-company relations, resume workflow rows, and migration health.
Old migration/drop/polish scripts were removed; historical reports under
`logs/` are the audit trail.

Important jobs:
- `noco:full-backup:*`: metadata and record backup.
- `noco:contract-check`: schema/API contract validation.
- `noco:post-migration-health:*`: aggregate health gate.
- `noco:relations:*`: relation health and repair.
- `noco:dolphin-profile-audit:*`: Dolphin profile/Noco binding audit.
- `noco:stop-companies:*`: stop-company parsing and relation linking.
- `noco:client-status:*`: advisory comparison against old status sheet.
- `noco:cleanup-audit:*`: cleanup gate.
- `noco:hh-response-readiness:*`: HH readiness report.

Canonical docs:
- [Noco Operational Jobs](../src/integrations/noco/README.md)
- [Noco Operations](../src/integrations/noco/OPERATIONS.md)
- [Noco Handoff](./NOCO_HANDOFF.md)
- [Noco Backup Runbook](./nocodb-backup-human-runbook.md)
- [Noco Web Console Working Notes](./NOCO_WEB_CONSOLE_WORKING_NOTES.md)

### Dolphin Profile Lifecycle

Main code:
- `src/integrations/dolphin/runtime.ts`
- `src/integrations/dolphin/preflight.ts`
- `src/integrations/dolphin/profiles.ts`
- `src/integrations/dolphin/profileAssigner/*`
- `src/integrations/dolphin/proxyProvider/*`

Dolphin Cloud API calls use `dolphin_api_token`. Dolphin Local API calls must
seed that token through the local login-with-token endpoint before local profile
actions. HH automation should go through the Dolphin integration facade and
preserve profile locks/tags/status cleanup even on failures.

Relevant docs:
- [Debugging: Dolphin Auth Contract](./DEBUGGING.md#dolphin-auth-contract)
- [Dolphin Proxy Provider](../src/integrations/dolphin/proxyProvider/README.md)
- [Dolphin Profile Assigner](../src/integrations/dolphin/profileAssigner/README.md)

### Web Console

Entrypoints:
- `npm run web:backend`
- `npm run web:frontend`
- `npm run web:dev`
- `npm run web:test`
- `npm run web:build`
- `npm run web:e2e`

Backend route source: `src/features/web-console/backend/app.ts`.
Frontend API source: `src/features/web-console/frontend/src/api.js`.

Roles:
- `client`: sees own profile, platform accounts, Telegram account/session tools,
  and Dolphin profile access when allowed.
- `provider`: sees assigned clients, required HH credentials, provider response
  data, and Dolphin access for target clients.
- `admin`: can inspect latest client data, active Telegram senders, dialog scan
  results, admin Telegram sending, AI CV tailoring, linked-chat messages, and
  HH dry-run command planning.

Important endpoint groups:
- Auth/session: `POST /api/auth/login`, `GET /api/auth/me`,
  `POST /api/auth/logout`.
- Client data: `GET/PATCH /api/client/me`,
  `GET /api/client/profile-options`, `GET /api/platforms`,
  `POST/PATCH/DELETE /api/client/platform-accounts`.
- Provider: `GET /api/provider/clients`.
- Dolphin: `GET /api/dolphin/profiles/status`,
  `POST /api/dolphin/lease/acquire`,
  `GET /api/dolphin/verification-code/latest`.
- Telegram user tools: `POST /api/telegram/connect`,
  `GET /api/telegram/status`, `GET /api/telegram/dialogs`,
  `GET /api/telegram/folders`, `GET /api/telegram/messages`,
  `POST /api/telegram/send`, `POST /api/telegram/rename-contact`,
  `POST /api/telegram/reauth`, `DELETE /api/telegram/disconnect`.
- Admin Telegram: `GET /api/admin/telegram/senders`,
  `GET /api/admin/telegram/dialogs/scan`,
  `POST /api/admin/telegram/send`,
  `POST /api/admin/clients/:clientId/telegram/send`.
- Admin tools: `GET /api/admin/latest-client`,
  `POST /api/admin/cv-tailor/from-pdf`,
  `POST /api/admin/hh-responses/start`.
- Internal TDLib gateway:
  `GET /api/internal/telegram-gateway/health`,
  `POST /api/internal/telegram-gateway/rpc`.

`POST /api/admin/hh-responses/start` is currently a dry-run planner. It returns
the `npm run orchestrator` command and env values for the latest client; it does
not start Dolphin or HH automation.

### Telegram Bot And Resume Workflow

Bot entrypoint: `npm run tg:support-bot`.

Main code:
- `src/integrations/telegram/support-bot.ts`
- `src/integrations/telegram/resume-workflow.ts`
- `src/integrations/telegram/tdlib-client.ts`
- `src/features/web-console/backend/telegram-service.ts`
- `src/features/web-console/backend/telegram-gateway.ts`

Bot API endpoints require `X-Bot-Api-Token: <WEB_CONSOLE_BOT_API_TOKEN>`.

Support bot commands:
- `/start` and `/student`: locate the Noco client linked to the current chat.
- `/whoami`: print chat/user metadata.
- `/change_google_folder <url>`: update `clients.google_folder`.
- `/resume`: advance the linked CV workflow by one checkpoint.
- `/resume_status`: show current workflow state.
- `/resume_reset_test`: reset workflow only in test mode.
- `/open_my_tasks` or `/tasks`: Kira/provider private task queue.

Resume API endpoints:
- `POST /api/bot/telegram/chats/:chatId/resume`
- `GET /api/bot/telegram/chats/:chatId/resume/status`
- `POST /api/bot/telegram/chats/:chatId/resume/reject`
- `POST /api/bot/telegram/chats/:chatId/resume/reset-test`
- `GET /api/bot/telegram/resume/provider/tasks`
- `GET /api/bot/telegram/resume/workflows/:workflowId`
- `POST /api/bot/telegram/resume/workflows/:workflowId/advance`
- `POST /api/bot/telegram/resume/workflows/:workflowId/reject`
- `POST /api/bot/telegram/resume/task-input`
- `POST /api/bot/telegram/resume/kira-comments`

Resume statuses:
- `stopped`
- `collection student's data`
- `collection Kira's comments`
- `Draft in process`
- `Draft in approve by Kira`
- `Draft in approve by student`
- `English version in progress`
- `English version in approve by Kira`
- `English version in approve by student`
- `Russian version in process`
- `Russian version in approve by Kira`
- `Russian version in approve by student`
- `moved to filling`
- `filled`

Current worktree fact: provider work is split into lanes. Main provider users
from `RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS` handle draft and English
version statuses. Russian translator users from
`RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS` handle
`Russian version in process` for non-RU clients. RU-only clients skip English
after draft approval and assign `Russian version in process` to the main
provider/creator. In test/dev, `@veu_support` may be configured in both
provider and translator env lists and can access both lanes. Provider task lists
are filtered by both client assignment and lane.

Canonical docs:
- [Telegram Bot, NocoDB, and Admin Console](./telegram-bot-nocodb-admin-console.md)
- [Resume Workflow](./resume-workflow.md)
- [Telegram Admin Dialog Backend](./TELEGRAM_ADMIN_DIALOG_BACKEND.md)

### AI CV Tailoring

The admin console exposes `POST /api/admin/cv-tailor/from-pdf`. The frontend
uploads a PDF and job requirements; the backend validates the request and calls
the CV tailoring service, returning a URL to the generated artifact.

Safe assumptions:
- This is an admin-only tool.
- Keep uploaded/generated artifacts out of commits unless explicitly requested.
- Verify with `npm run web:test`, `npm run web:build`, and the relevant e2e if
  changing UI behavior.

### Diagnostics And Testing

Common safe commands:

```powershell
npm run typecheck
npm run orchestrator:test
npm run web:test
npm run noco:test
npm run doctor:test
npm run dolphin:user-credentials:test
node src/integrations/dolphin/preflight.test.ts
```

Read-only inspection:

```powershell
$env:APP_DB='noco'
npm run doctor -- --env
npm run check-table
npm run check-table -- --contains "Иван"
npm run doctor -- --client "Кира"
```

Live HH smoke template, only after safety checks:

```powershell
$env:APP_DB='noco'
$env:ORCHESTRATOR_CLIENT_NAMES='Кира'
$env:ORCHESTRATOR_WORK_WITH_MARKET='ru'
$env:ORCHESTRATOR_RESPONSE_LIMIT='5'
npm run orchestrator
```

## Data Ownership Rules

- Noco native relations and record `Id`s are canonical.
- Current Noco client statuses are authoritative.
- Old Google status sheet differences are advisory only.
- Old workbook/sheet imports are archive history.
- Missing Dolphin profile rows may be intentional cost saving.
- HH account/profile readiness is separate from Dolphin profile binding.
- Feature code should consume `createAppDb()` or feature repositories rather
  than raw provider clients.
- Integration code owns provider-specific API details.

## Operational Safety

### Noco Schema And Data

Treat relation type changes, column type/title/name changes, FK changes,
relation creation/deletion, table/column deletion, and display-field changes as
production migrations.

Before any schema change:
1. Run `npm run noco:full-backup:apply`.
2. Record target table/column/relation, old state, desired state, reason, and
   rollback path.
3. Run `npm run noco:contract-check`.
4. Prefer a dry-run report. Do not apply if there is no rollback path.

After any schema change:
1. Run `npm run noco:contract-check`.
2. Re-check the feature endpoint that depends on the changed table.
3. Run another `npm run noco:full-backup:apply` if the change is kept.

### Dolphin

Do not start, stop, tag, retag, or mutate Dolphin profiles unless the task
explicitly requires it. For HH work, use the orchestrator/runtime facades so
profile locks and status cleanup remain consistent.

### Telegram

Do not assume TDLib local pending messages are delivered. The web-console TDLib
sender waits for `updateMessageSendSucceeded`; pending state is not equivalent
to a visible Telegram message. Bot API cannot initiate private conversations;
Kira/provider/translator users must open the bot and send `/start` first.

### HH

Live HH runs can create real vacancy responses. Use diagnostics, short limits,
and explicit client/market filters before running the orchestrator. Captcha,
auth loss, browser disconnect, selector breakage, and unknown parser failures
should be reported as typed failures, not silent success.

### Logs And Secrets

Do not commit `.env`, tokens, TDLib session DBs, uploaded Telegram files, or
generated one-off validation artifacts. Generated reports under `logs/` are
usually evidence, not source changes, unless the report itself is the deliverable.

## Current TODO Docs

- `HIGHEST-PRIORITY-TODO.md`: first queue for the highest-priority cross-project
  work, currently HH captcha solving and the AI-driven development harness.
- `TG-RESUME-BOT-PERFORMANCE-TODO.md`: remaining `/open_my_tasks` performance
  cleanup around broad client fetches and save/input fallback scans.
- `src/integrations/dolphin/profileAssigner/normalizeProfiles/TODO.md`:
  existing Dolphin profile normalization against current Noco-backed
  web-console provisioning standards.
- `src/integrations/dolphin/proxyProvider/provideProxy/TODO.md`: existing-profile
  proxy repair/adoption; new-profile English proxy assignment is handled by
  web-console provisioning.
- `src/integrations/dolphin/proxyProvider/real-e2e-proxy-deleting/TODO.md`:
  live opt-in safety test before any production proxy delete path.

Root `index.js` is intentionally still present because HH page injection depends
on it.

## Update Discipline

When changing docs:
- Validate against code, package scripts, current tests, and current diffs.
- Prefer linking canonical runbooks over duplicating long procedures.
- If documenting uncommitted code, say it is current worktree behavior.
- Keep commands exact and PowerShell examples readable.
- Fix mojibaked Cyrillic examples when touching affected docs.

When changing code:
- Respect existing boundaries in [Architecture](./ARCHITECTURE.md).
- Keep docs updated when public commands, env vars, endpoints, workflow statuses,
  or operational safety rules change.
- Run the smallest meaningful tests first, then broader suites when behavior
  crosses feature or integration boundaries.
