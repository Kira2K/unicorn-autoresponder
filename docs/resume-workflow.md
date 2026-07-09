# Resume Workflow

## Overview

The support bot owns the user-facing `/resume` flow. The web-console backend
owns the protected API and NocoDB writes. `CV processing` is the source of truth
for current state.

Commands:

- `/resume`: starts or advances the workflow for the current Telegram group by
  one checkpoint, only if the current Telegram actor owns that checkpoint.
- `/resume_status`: shows linked student, current status, responsible side, and
  final links when they exist.
- `/resume_reset_test`: resets the linked workflow row only when
  `RESUME_WORKFLOW_TEST_MODE=true`.
- `/open_my_tasks` or `/tasks`: Kira/Provider private command that lists
  owned CV workflow tasks and shows inline buttons to open/advance a selected
  client.

## Live Facts

- Test chat: `-5216637594`.
- Bot: `@veu_support_bot`.
- Test client: `102` / `Test`.
- Test client personal chat: `@Kira_arbeitet`.
- Active Telegram accounts used during testing: `102/473` and `1/452`.
- `CV processing` table ID: `mhiysd8l0f33bny`.
- Test `CV processing` row: `98` for client `102`.

## NocoDB Fields

`clients` fields used by the workflow:

- `telegram_general_chat_id`: linked Telegram common group.
- `telegram_personal_chat_id`: client Telegram username used to authorize the
  student actor inside the linked common group.
- `education`: required before leaving `collection student's data`.
- `English level` / `english_levels_id`: required before leaving
  `collection student's data`.
- `google_folder`: updated by `/change_google_folder`; this is separate from
  the resume workflow source-data field.

`CV processing` fields used by the workflow:

- `clients_id`: relation/id link to the existing `clients` row.
- `record_key`: display key for the workflow row.
- `status`: current workflow status.
- `student_data_folder_url`: source data folder link used by the resume
  workflow. Code also reads the older accidental
  `student_experience_folder_url` name if it exists, but writes
  `student_data_folder_url`.
- `cv_draft_url`: draft CV link.
- `en_version_url`: English CV link.
- `ru_version_url`: Russian CV link.
- `additional_versions`: spare long text field for extra versions/notes.
- `kiras_comments`: comments for the provider.
- `last_responsible`: helper field for the current responsible side.
- `last_workflow_error`: helper field for stop/failure diagnosis.
- `workflow_trace`: helper field for transition history.

## Statuses

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

## Role Rules

- Student steps must be advanced by the linked client Telegram account inside
  the linked common chat. The match uses `clients.telegram_personal_chat_id` or
  `RESUME_WORKFLOW_STUDENT_USER_IDS_BY_CLIENT`.
- Kira steps must be advanced by a Telegram user ID in
  `RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS`.
- Provider steps must be advanced by a Telegram user ID in
  `RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS`.
- Provider client visibility is additionally limited by
  `RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS`, using
  `clientId:platformAccountId` pairs. With the live test default `102:473`, the
  provider queue only exposes client `102`.
- Kira/Provider tasks are hidden from common groups. Kira and Providers use
  `/open_my_tasks` in a private chat with the bot.

Telegram Bot API cannot initiate a private conversation with a user. Each Kira
or provider Telegram account must open `@veu_support_bot` and send `/start`
once before private next-responsible notifications can be delivered.

## Behavior

In normal mode, `/resume` creates the missing `CV processing` row for the linked
student if needed, then advances the current checkpoint only when the required
data for that checkpoint already exists. It does not write fake links in normal
mode.

In test mode, `/resume` still advances only one checkpoint per call. Fake
source/final links and Kira comments are disabled unless
`RESUME_WORKFLOW_FAKE_DATA_MODE=true` is also set. Manual Telegram tests should
leave fake data mode disabled and fill the Noco/Admin Console fields before
pressing `Process next step`.

The task card hides `Process next step` until the required field exists:

- `student_data_folder_url` before leaving `collection student's data`.
- `kiras_comments` before leaving `collection Kira's comments`.
- `cv_draft_url` before leaving `Draft in process`.
- `en_version_url` before leaving `English version in progress`.
- `ru_version_url` before leaving `Russian version in process`.

API-driven tests that call protected backend endpoints do not create visible
student command history in Telegram. When the common-chat transcript matters,
use the visible e2e runner; it sends the student-owned commands through the
student Telegram account and lets the support bot reply in the common chat.

Before leaving `collection student's data`, the workflow validates that
`clients.education` and `clients.English level` / `clients.english_levels_id`
are set. If either is missing, the bot returns an error asking the user to add
the field in the Console. The Telegram bot intentionally does not edit those
profile fields.

After every successful status change, the backend emits a next-responsible
notification:

- Student next: common chat message with the client mention.
- Kira next: private Kira chat.
- Provider next: private Provider chat.

When test mode moves a workflow to `moved to filling`, the backend also emits
the HH-summary-channel message:

```text
Test mode, do nothing. Account of [client name + market] is ready to filling, links to RU: [ru], EN: [en]. @kirasamsonova fyi
```

If the workflow reaches `filled`, the bot replies with ready English and Russian
version links. If the workflow is `stopped`, the bot replies with the last
stored workflow error and waits for admin action or a test reset.

## Protected Bot API

All endpoints require:

```http
X-Bot-Api-Token: <WEB_CONSOLE_BOT_API_TOKEN>
```

Endpoints:

- `POST /api/bot/telegram/chats/:chatId/resume`
- `GET /api/bot/telegram/chats/:chatId/resume/status`
- `POST /api/bot/telegram/chats/:chatId/resume/reset-test`
- `GET /api/bot/telegram/resume/provider/tasks`
- `GET /api/bot/telegram/resume/workflows/:workflowId`
- `POST /api/bot/telegram/resume/workflows/:workflowId/advance`

Actor headers used by the support bot:

- `X-Telegram-User-Id`
- `X-Telegram-Username`
- `X-Telegram-Chat-Id`
- `X-Telegram-Chat-Type`

The endpoints do not require a browser cookie session.

## Environment

```env
RESUME_WORKFLOW_TEST_MODE=false
RESUME_WORKFLOW_FAKE_DATA_MODE=false
RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS=8222949251
RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS=102:473
RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID=8222949251
RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS=7586552066
RESUME_WORKFLOW_KIRA_PLATFORM_ACCOUNT_REFS=1:452
RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID=7586552066
RESUME_WORKFLOW_STUDENT_USER_IDS_BY_CLIENT=
RESUME_WORKFLOW_FAKE_STUDENT_DATA_FOLDER=https://drive.google.com/drive/folders/test-student-data
RESUME_WORKFLOW_FAKE_DRAFT_LINK=https://docs.google.com/document/d/test-draft
RESUME_WORKFLOW_FAKE_ENGLISH_LINK=https://docs.google.com/document/d/test-english-version
RESUME_WORKFLOW_FAKE_RUSSIAN_LINK=https://docs.google.com/document/d/test-russian-version
RESUME_WORKFLOW_FAKE_KIRAS_COMMENTS=Looks good for test. Please prepare the draft based on provided source data.
```

Never enable fake workflow behavior in production or manual acceptance runs.

## Local Test Checklist

1. Start the web backend with `WEB_CONSOLE_BOT_API_TOKEN` configured.
2. Start the bot worker with `VEU_SUPPORT_BOT`, `WEB_CONSOLE_BASE_URL`, and the
   same `WEB_CONSOLE_BOT_API_TOKEN`.
3. Set `RESUME_WORKFLOW_TEST_MODE=true` only for a test run.
4. Keep `RESUME_WORKFLOW_FAKE_DATA_MODE=false` for manual testing.
5. Send `/resume` in chat `-5216637594`.
6. If the bot asks for Education or English level, fill those fields in the
   Console and retry.
7. Use the Kira account for Kira-owned statuses. Add `kiras_comments` before
   advancing the comments step.
8. Use `/open_my_tasks` in the provider private chat for provider-owned
   statuses. Add the draft/EN/RU URL in Noco/Admin Console before pressing
   `Process next step`.
9. Repeat until the row reaches `filled`.
10. Verify `CV processing` row `98` has status `filled`, manual source folder,
    draft link, English link, Russian link, and Kira comments.

## Automated Tests

Run:

```bash
npm run tg:support-bot:test
npm run tg:resume:e2e:test
npm run web:test
npm run typecheck
npm run web:build
```

Live visible Test-user acceptance run:

```bash
npm run tg:resume:e2e:test-user
```

This live runner is for dedicated test accounts only. It uses Test client `102`,
common chat `-5216637594`, and student TDLib account `102:473`. It first sends
`/whoami` to discover the actual Telegram user ID for that account and maps it
to client `102` for the local e2e backend. It leaves the Test workflow at
`filled` and verifies that the student commands and bot replies are visible in
the common chat. Do not point this script at real student/provider/Kira accounts
unless the run is explicitly meant to exercise those accounts.

## Troubleshooting

- `No student found`: set `clients.telegram_general_chat_id` to the exact group
  chat ID.
- `resume_required_data_missing`: add Education and/or English level in the
  Console, then retry `/resume`.
- `This step must be advanced by ...`: use the Telegram account responsible for
  the current status.
- Private notification cannot be delivered: open `@veu_support_bot` from the
  responsible Telegram account and send `/start`, then retry the workflow step.
- `resume_reset_test_disabled`: set `RESUME_WORKFLOW_TEST_MODE=true` locally,
  or do not use reset in production.
- `stopped`: inspect `last_workflow_error` and `workflow_trace` in
  `CV processing`.
- Bot does not answer: confirm the bot has access to group messages and the bot
  worker is running.
