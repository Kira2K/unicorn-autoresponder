# Onboarding

This is the human-readable starting point for a technical colleague joining the
project. It summarizes what the system does, why each part matters, and where to
continue reading. For the full AI/agent map, use
[AI_CONTEXT_FULL.md](./AI_CONTEXT_FULL.md). For the shortest repo map, use
[AGENT_CONTEXT.md](./AGENT_CONTEXT.md).

## Stack And External Systems

- Node.js and TypeScript: main codebase, scripts, tests, and integration logic.
- Playwright/CDP: browser automation through Dolphin profiles.
- NocoDB: live operational database for clients, accounts, statuses, relations,
  and workflow rows.
- Dolphin Anty: antidetect browser for isolated per-client profiles.
- Telegram Bot API: support bot commands, replies, and private task queues.
- TDLib: real Telegram account sessions, dialogs, and delivery checks.
- Google Sheets: legacy/advisory comparison path, not the default live source.
- Google Drive / Google Docs links: client folders and CV workflow artifacts.

## What This System Does

1. HH automation
  - HH auto-responses: sends targeted HeadHunter responses for selected clients,
    reducing manual vacancy application work.
  - [In progress] HH auth recovery: checks whether Dolphin HH profiles are
    logged in and can guide the run through a reusable authorization flow before
    automation starts.
  - Dolphin profile lifecycle: starts, locks, tags, audits, grants temporary
    access, and cleans up browser profiles so multiple automation jobs do not
    collide.

2. Web console
  - Client dashboard: lets clients maintain profile data and platform
    accounts. Clients can connect their Telegram
    accounts through TDLib, open their own Dolphin profiles safely, and create
    preconfigured Dolphin profiles when required profile / proxy data is ready.
  - Provider dashboard: gives providers a focused view of assigned clients, HH
    credential readiness, response data, and controlled Dolphin access for HH
    and LinkedIn-related work.
  - Admin dashboard: gives admins current client context, Telegram sender
    catalog (TDLib), dialog scanning/data collection, Telegram send tools,
    linked-chat messaging, AI CV tailoring, and an HH responses dry-run planner.

3. Telegram bot and CV workflow
  - Telegram support bot: lets students and internal roles interact with client
    records and resume workflows without opening NocoDB directly.
  - In-bot CV resume workflow: coordinates student, Kira, provider, and Russian
    translator handoffs until CV assets are ready for filling.
  - [Contributed by Pasha, in progress] Admin Telegram tooling: lets admins
    inspect active Telegram senders, scan dialogs, send messages, and message
    linked client chats from one surface.

4. Data operations and reliability
  - Noco operational jobs: backs up, audits, and repairs Noco data and relation
    health before live automation depends on it.
  - Diagnostics and tests: provide fast checks for data readiness, architecture
    boundaries, provider contracts, and common runtime failures.

## Main Workflows

1. HH automation

HH auto-response runs start from `npm run orchestrator`. The orchestrator loads
enabled automation targets through `createAppDb()`, enriches them with blocked
companies and HH credentials, prepares Dolphin profile locks, verifies HH auth,
runs saved/manual vacancy cleanup, opens the HH scenario, injects the root
`index.js` browser worker, classifies the outcome, reports through Telegram and
local logs, and restores Dolphin profile state.

Dolphin integration owns profile start/stop, preflight, profile locks, profile
creation/provisioning, profile assignment ideas, and proxy-provider tooling. HH
features should call Dolphin facades rather than raw provider helpers. Read
[the orchestrator README](../src/features/hh-responses/orchestrator/README.md),
[Dolphin Proxy Provider](../src/integrations/dolphin/proxyProvider/README.md),
and [Dolphin Profile Assigner](../src/integrations/dolphin/profileAssigner/README.md)
before changing run order, profile creation, proxy rules, or success semantics.

2. Web console

The web console is the human UI layer. Clients maintain their own profile and
platform-account data, connect Telegram accounts through TDLib, open their own
Dolphin profiles with controlled access, and create preconfigured Dolphin
profiles when required profile/proxy data is ready.

Providers use the console to inspect assigned clients, HH credential readiness,
provider response data, and controlled Dolphin access for HH and LinkedIn work.

Admins use the console to inspect current client context, scan TDLib dialog
history, collect Telegram dialog data, send Telegram messages, message linked
client chats, tailor CVs from PDF/job requirements, and request an HH responses
dry-run plan. Clients and admins use Telegram sessions for Telegram
communication and data collection; Dolphin profiles are the browser surface for
HH and LinkedIn. The backend API lives in
`src/features/web-console/backend/app.ts`; frontend calls are centralized in
`src/features/web-console/frontend/src/api.js`.

3. Telegram bot and CV workflow

Telegram work has two surfaces. The Bot API worker handles student/support
commands such as `/student`, `/change_google_folder`, `/resume`,
`/resume_status`, `/resume_reject`, and `/open_my_tasks`. TDLib-backed web-console tools handle
real account sessions, dialogs, messages, contact rename, reauth, disconnect,
and admin dialog scans.

The resume workflow moves a `CV processing` row through student data collection,
Kira comments, draft creation and approvals, English version creation and
approvals, Russian version creation and approvals, then filling readiness. The
main provider lane owns draft and English work. The Russian translator lane,
configured by `RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS`, owns
`Russian version in process` for non-RU clients. RU-only clients skip English
and assign the Russian version to the main creator/provider.

Read [Telegram Bot, NocoDB, and Admin Console](./telegram-bot-nocodb-admin-console.md),
[Resume Workflow](./resume-workflow.md), and
[Telegram Admin Dialog Backend](./TELEGRAM_ADMIN_DIALOG_BACKEND.md) before
changing bot commands, TDLib sessions, admin dialog collection, or resume
handoffs.

4. Data operations and reliability

NocoDB is the live operational database. It owns current client status, native
relations, platform accounts, Dolphin bindings, resume workflow rows, Telegram
metadata, and readiness checks. Google Sheets code still exists, but it is a
legacy comparison or diagnostic path unless a task explicitly says otherwise.
Start with [Noco Operational Jobs](../src/integrations/noco/README.md),
[Noco Operations](../src/integrations/noco/OPERATIONS.md), and
[Noco Handoff](./NOCO_HANDOFF.md).

Diagnostics and tests are intentionally command-shaped. Use `npm run doctor`,
`npm run check-table`, `npm run orchestrator:test`, `npm run web:test`,
`npm run noco:test`, and `npm run typecheck` to inspect behavior without a live
HH run. Read [Debugging](./DEBUGGING.md) before running live automation.

## How It Is Built[AI-generated]

The repo is organized around product features, provider integrations, and shared
platform boundaries:

| Area | Owns |
| --- | --- |
| `src/features/hh-responses` | HH automation, auth, scenario runs, parser outcome classification, reporting. |
| `src/features/web-console` | Express backend, Vue frontend, admin/client/provider workflows. |
| `src/features/diagnostics` | Read-only checks and run analysis. |
| `src/platform/db` | `createAppDb()` and the Noco/legacy Sheets data adapters. |
| `src/platform/browser` | Provider-neutral browser helpers. |
| `src/integrations/dolphin` | Dolphin Cloud/Local APIs, runtime, locks, profile/proxy tools. |
| `src/integrations/noco` | Noco API core, backups, audits, sync jobs, relation health. |
| `src/integrations/telegram` | Bot API worker, TDLib client, resume workflow, Telegram tools. |
| `src/integrations/google-sheets` | Legacy data access and comparison helpers. |

The most important boundary is data access: product features should read live
automation data through `createAppDb()` or a feature repository. They should not
reach directly into raw Noco, Google Sheets, Dolphin, or Telegram request code
unless they are inside the relevant integration layer.

## Where Existing Docs Live[AI-generated]

- [Agent Context](./AGENT_CONTEXT.md): shortest map for future agents.
- [AI Context Full](./AI_CONTEXT_FULL.md): detailed machine-friendly context.
- [Architecture](./ARCHITECTURE.md): current layout and source boundaries.
- [Architecture Decisions](./DECISIONS.md): why the current boundaries exist.
- [Debugging](./DEBUGGING.md): safe inspection commands and failure lookup.
- [HH Orchestrated Run Instruction](./hh-orchestrated-run-instruction.md):
  operator-facing run prompt.
- [HH Orchestrator README](../src/features/hh-responses/orchestrator/README.md):
  runtime flow and success semantics.
- [Noco Handoff](./NOCO_HANDOFF.md): short Noco operational overview.
- [Noco Operations](../src/integrations/noco/OPERATIONS.md): Noco job runbook.
- [Noco Backup Runbook](./nocodb-backup-human-runbook.md): backup process.
- [Noco Web Console Notes](./NOCO_WEB_CONSOLE_WORKING_NOTES.md): platform
  account and TDLib safety rules.
- [Telegram Bot, NocoDB, and Admin Console](./telegram-bot-nocodb-admin-console.md):
  support bot and web-console API overview.
- [Resume Workflow](./resume-workflow.md): CV workflow statuses and behavior.
- [Telegram Admin Dialog Backend](./TELEGRAM_ADMIN_DIALOG_BACKEND.md): TDLib
  gateway and admin dialog collection rules.

## First Time Checklist[AI-generated]

1. Read this file, then skim [AGENT_CONTEXT.md](./AGENT_CONTEXT.md) and
   [ARCHITECTURE.md](./ARCHITECTURE.md).
2. Run safe static/local checks: `npm run typecheck`, `npm run orchestrator:test`,
   `npm run web:test`, and `npm run noco:test`.
3. Inspect recent generated evidence under `logs/`, starting from each
   `latest.txt` and `summary.json` where available.
4. Before Noco schema changes, read
   [Noco Web Console Notes](./NOCO_WEB_CONSOLE_WORKING_NOTES.md) and run the
   backup/contract-check protocol.
5. Before live HH runs, read [Debugging](./DEBUGGING.md) and the
   [orchestrator README](../src/features/hh-responses/orchestrator/README.md).
6. Before Telegram session or admin dialog work, read
   [Telegram Admin Dialog Backend](./TELEGRAM_ADMIN_DIALOG_BACKEND.md).
7. Do not run live HH, Noco apply jobs, Dolphin mutation, Telegram live-send, or
   backup apply commands until the relevant safety doc has been read and the
   intended target data is explicit.

## TODO

- [Telegram Resume Bot Performance TODO](../TG-RESUME-BOT-PERFORMANCE-TODO.md):
  reduce broad client fetching and avoid full task-list scans in save/input
  fallback paths.
- [Normalize Dolphin Profiles TODO](../src/integrations/dolphin/profileAssigner/normalizeProfiles/TODO.md):
  audit and repair existing Dolphin profiles against current Noco-backed
  web-console provisioning standards.
- [Provide Proxy TODO](../src/integrations/dolphin/proxyProvider/provideProxy/TODO.md):
  repair or adopt proxies for existing Dolphin profiles; new-profile En proxy
  assignment already lives in web-console provisioning.
- [Real E2E Proxy Deleting TODO](../src/integrations/dolphin/proxyProvider/real-e2e-proxy-deleting/TODO.md):
  live opt-in safety test required before any production proxy delete path.
- [HH-responses basic scenario calendar mode](../HH-RESPONSES-CALENDAR-MODE-TODO.md):
  HH-responses calendar scheduling, prevalidation, reporting, and non-technical
  operation TODO.
- [Tech interview to table of unique questions](no link): video of tech interview => user Console web interface (user data) => video to text => text to questions => questions to table with company to questions relation and a special table with unique questions only. Can be tested on Nazarov's collection
- [Quiz-like bot-based test before every new stage](no link): make student go through a quiz to make sure they clearly understood the recomendations of a stage. Have they filled all required data in Console, how to fill HH-forms, respond to recruiters, etc. Add AI-driven answers validation for soft-skills training part (we really have same silly problems with every student)
- [TDLib all client pulling performance optimisation](no link): current admin TDlib interfaces takes 60+ seconds to fetch all data from testing accounts.Requires optimisation
