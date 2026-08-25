# Telegram Bot, NocoDB, and Admin Console

This feature connects a Telegram support bot, the web-console API, and NocoDB
client rows.

TDLib-backed client writing, the admin account sender, and admin dialog
collection use the web console's existing TDLib adapter. See
[TELEGRAM_ADMIN_DIALOG_BACKEND.md](./TELEGRAM_ADMIN_DIALOG_BACKEND.md) before
changing their proxy, session, or read/write behavior.

## Overview

Data flow:

```text
Telegram group -> support bot -> web-console API -> NocoDB
Admin Console -> web-console API -> Telegram Bot API -> Telegram group
```

The bot matches a Telegram group to a student by comparing the current Telegram
chat ID with `clients.telegram_general_chat_id` in NocoDB. Resume workflow
commands are documented in [resume-workflow.md](./resume-workflow.md).

## Environment

```env
VEU_SUPPORT_BOT=
WEB_CONSOLE_BOT_API_TOKEN=
WEB_CONSOLE_BASE_URL=http://127.0.0.1:4300
RESUME_WORKFLOW_TEST_MODE=false
RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS=8222949251
RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS=102:473
RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID=8222949251
RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS=8222949251
RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS=7586552066
RESUME_WORKFLOW_KIRA_PLATFORM_ACCOUNT_REFS=1:452
RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID=7586552066
RESUME_WORKFLOW_STUDENT_USER_IDS_BY_CLIENT=
TELEGRAM_TDLIB_SEND_TIMEOUT_MS=120000
```

- `VEU_SUPPORT_BOT`: Telegram Bot API token for `@veu_support_bot`.
- `WEB_CONSOLE_BOT_API_TOKEN`: shared internal token used by the bot when it
  calls the web-console API.
- `WEB_CONSOLE_BASE_URL`: public or local URL of the web-console backend.
- `RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS`: comma-separated Telegram user
  IDs allowed to open and advance main provider CV tasks for draft and English
  version work.
- `RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS`: comma-separated
  `clientId:platformAccountId` pairs. Provider private task lists and provider
  advancements are limited to these client IDs.
- `RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS`: comma-separated Telegram
  user IDs allowed to open and advance the Russian translator provider lane for
  `Russian version in process` on non-RU clients. RU-only clients assign the
  Russian version to the main provider/creator. Test/dev can configure
  `@veu_support` in both provider and translator env lists; production should
  use the real translator account, currently `@polinats`.
- `RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS`: comma-separated Telegram user IDs
  allowed to advance Kira CV approval/comment tasks.
- `RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID` and
  `RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID`: private chats for next-responsible
  notifications. Defaults to the first configured user ID for that role.
- `RESUME_WORKFLOW_STUDENT_USER_IDS_BY_CLIENT`: optional
  `clientId:telegramUserId` pairs for clients whose Telegram username is not
  enough. In the linked common chat, the matching client username or mapped user
  ID is treated as the student even if that account is also configured as an
  internal test role.
- `TELEGRAM_TDLIB_SEND_TIMEOUT_MS`: how long TDLib sender waits for Telegram
  delivery confirmation before returning a pending-send error.

Do not commit real token values.

## Commands

- `/start`: same lookup behavior as `/student`.
- `/student`: finds the student linked to the current Telegram chat.
- `/whoami`: prints chat ID, chat type, and user ID.
- `/change_google_folder <value>`: updates `clients.google_folder` for the
  client linked to the current chat.
- `/resume`: advances the CV workflow by one checkpoint when the current
  Telegram user is responsible for that checkpoint.
- `/resume_status`: shows the linked CV workflow row and current responsible
  side.
- `/resume_reset_test`: resets the linked CV workflow row only when
  `RESUME_WORKFLOW_TEST_MODE=true`.
- `/open_my_tasks` or `/tasks`: Kira/provider private command. Shows CV tasks
  waiting on that actor and returns inline buttons to open/advance a selected
  client. Provider task rows are filtered by assigned client scope and by lane:
  main provider for draft/English work, Russian translator for Russian-version
  work.

`/commands` is context-aware: linked student/group chats see student commands,
while private Kira/provider chats see the private task queue command after the
backend confirms the actor is configured for that role.

The Google folder value must be non-empty, start with `http://` or `https://`,
and be at most 2048 characters.

Telegram Bot API cannot initiate a private conversation with a user. Each Kira
or provider Telegram account must open `@veu_support_bot` and send `/start`
once before private next-responsible notifications can be delivered.

API-driven resume tests do not create visible student command history in
Telegram. Use `npm run tg:resume:e2e:test-user` when the acceptance criterion is
"open the Test student chat and see the student commands/replies."

## API Endpoints

Bot endpoints use `X-Bot-Api-Token: <WEB_CONSOLE_BOT_API_TOKEN>`.

```http
GET /api/bot/telegram/chats/:chatId/client
PATCH /api/bot/telegram/chats/:chatId/google-folder
POST /api/bot/telegram/chats/:chatId/resume
GET /api/bot/telegram/chats/:chatId/resume/status
POST /api/bot/telegram/chats/:chatId/resume/reset-test
GET /api/bot/telegram/resume/provider/tasks
GET /api/bot/telegram/resume/workflows/:workflowId
POST /api/bot/telegram/resume/task-input
POST /api/bot/telegram/resume/kira-comments
POST /api/bot/telegram/resume/workflows/:workflowId/advance
```

The admin console endpoint uses the normal admin cookie session:

```http
POST /api/admin/clients/:clientId/telegram/send
```

Body:

```json
{
  "text": "Hello from Admin Console"
}
```

## Web Console Feature Surface

The web console is a role-based operational UI backed by the Express API in
`src/features/web-console/backend/app.ts` and the Vue frontend in
`src/features/web-console/frontend`.

- Client role: edit profile fields, manage platform accounts, inspect/connect
  Telegram sessions, browse dialogs/messages, send Telegram messages when
  writing is enabled, and request Dolphin profile access when allowed.
- Provider role: view assigned clients, inspect HH credential readiness, review
  provider response data, and acquire Dolphin leases for assigned targets.
- Admin role: inspect latest client data, list Telegram senders, scan admin
  dialogs, send Telegram messages from selected accounts, message a client's
  linked chat, tailor CVs from PDF/job requirements, and request the HH
  responses dry-run plan.

Important admin/client API surfaces:

```http
GET /api/client/me
PATCH /api/client/me
POST /api/client/platform-accounts
PATCH /api/client/platform-accounts/:id
DELETE /api/client/platform-accounts/:id
GET /api/provider/clients
GET /api/dolphin/profiles/status
POST /api/dolphin/lease/acquire
GET /api/dolphin/verification-code/latest
POST /api/telegram/connect
GET /api/telegram/status
GET /api/telegram/dialogs
GET /api/telegram/folders
GET /api/telegram/messages
POST /api/telegram/send
POST /api/telegram/rename-contact
POST /api/telegram/reauth
DELETE /api/telegram/disconnect
GET /api/admin/telegram/senders
GET /api/admin/telegram/dialogs/scan
POST /api/admin/telegram/send
POST /api/admin/cv-tailor/from-pdf
POST /api/admin/clients/:clientId/telegram/send
POST /api/admin/hh-responses/start
```

`/api/admin/hh-responses/start` is intentionally dry-run only: it returns the
planned `npm run orchestrator` command and environment for the latest client,
but does not start Dolphin or HH automation.

## NocoDB Fields

On `clients`:

- `telegram_general_chat_id`: linked Telegram group chat ID.
- `telegram_personal_chat_id`: client Telegram username used to authorize the
  student actor inside the linked common chat.
- `google_folder`: Google Drive folder URL updated by the bot.
- `client_name`: display name used in bot replies.
- `education`: required before leaving `collection student's data`.
- `English level` / `english_levels_id`: required before leaving
  `collection student's data`.

On `CV processing`:

- `clients_id`: relation/id link to the existing client.
- `status`: the current CV workflow checkpoint.
- `student_data_folder_url`: source-data folder used by the resume workflow.
- `cv_draft_url`, `en_version_url`, `ru_version_url`, `kiras_comments`: links
  and comments filled manually in normal mode or with fake values in test mode.

## Local Testing

Start the web console:

```powershell
npm run web:backend
```

In another terminal, start the bot:

```powershell
npm run tg:support-bot
```

Run automated tests:

```powershell
npm run tg:resume:e2e:test
npm run web:test
npm run web:build
npm run typecheck
```

Manual chat ID for acceptance testing:

```text
-5216637594
```

Manual scenario:

1. Send `/whoami` in the test group and confirm the chat ID.
2. Send `/student`; the bot should reply with the linked student name.
3. Ensure `clients.google_folder` is filled in Console/NocoDB.
4. Send `/resume`; if required profile data is missing, fill education,
   English level, real age, locations, GitHub, LinkedIn, Telegram RU, and
   Telegram EN in the Console and retry.
6. Use `/open_my_tasks` in the provider's private chat when the workflow reaches
   a provider-owned status. Use the Russian translator account for
   `Russian version in process` on non-RU clients; RU-only clients use the main
   provider.
7. Open the admin console, log in as admin, and use "Message to Telegram chat".
8. Confirm the bot posts the admin message to the linked group.

Visible Test-user e2e:

```powershell
npm run tg:resume:e2e:test-user
```

This command sends the student-owned workflow commands through TDLib account
`102:473` into chat `-5216637594`, while Kira/provider steps stay private. It
starts with `/whoami` so the local e2e backend can map the actual Telegram user
ID to Test client `102`. Do not repoint this flow to real accounts unless the
acceptance criterion explicitly requires a visible live-account run.

## TDLib Delivery Notes

TDLib can return a local outgoing message before Telegram has actually delivered
it. The web-console TDLib sender waits for `updateMessageSendSucceeded` before
reporting success. If Telegram keeps the message in
`messageSendingStatePending`, the sender returns `telegram_message_send_pending`
instead of pretending the message was posted.

When testing bot commands through an automated TDLib account, keep the account
connected long enough for pending messages to flush. A message that appears only
in TDLib history with `messageSendingStatePending` is not visible to other group
members and will not reach the Bot API.

Manual Telegram client commands remain the acceptance path for the support bot:
they create normal Telegram messages immediately visible in the group, and the
bot receives them through Bot API long polling.

## Render Deployment

Use two Render processes/services if long polling is used:

- Web service: `npm run web:start`
- Worker service: `npm run tg:support-bot`

Set the same `WEB_CONSOLE_BOT_API_TOKEN` on both services. Set
`WEB_CONSOLE_BASE_URL` on the worker to the deployed web-console URL.

## Troubleshooting

- Bot does not respond: check `VEU_SUPPORT_BOT`, worker logs, and whether the bot
  is in the group.
- TDLib says a message was sent but nobody sees it: inspect the message state.
  If it is `messageSendingStatePending`, it is still local to TDLib. Wait for
  `updateMessageSendSucceeded` or treat it as not delivered.
- Chat ID not found: run `/whoami` and copy the exact chat ID into
  `clients.telegram_general_chat_id`.
- Resume step says "This step must be advanced by ...": the current Telegram
  account is not the role responsible for the status. Use the linked student in
  the common chat, a configured Kira account, or a configured provider account.
- Resume step asks for Education or English level: add those fields in the
  Console. The Telegram bot intentionally does not edit them.
- Private Kira/provider notification says the bot cannot initiate a
  conversation: open `@veu_support_bot` from that Telegram account and send
  `/start`, then retry the workflow step.
- NocoDB update failed: confirm the client row exists and `google_folder` is a
  valid URL.
- Admin Console message not sent: confirm the client has
  `telegram_general_chat_id`, and check the Bot API token.
- Unauthorized bot API response: make sure the worker sends
  `X-Bot-Api-Token` and the web service has `WEB_CONSOLE_BOT_API_TOKEN`.
