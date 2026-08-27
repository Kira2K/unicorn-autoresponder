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
- `/resume_reject <comment>`: rejects an approval step back to the producer
  phase. The comment must be at least 30 trimmed characters, except the exact
  default phrase `оставил комменты в резюме`.
- `/resume_reset_test`: resets the linked workflow row only when
  `RESUME_WORKFLOW_TEST_MODE=true`.
- `/open_my_tasks` or `/tasks`: Kira/Provider private command that lists
  owned CV workflow tasks and shows inline buttons to open/advance a selected
  client. Provider task visibility is lane-aware: the main provider sees draft
  and English-version tasks, while the Russian translator sees Russian-version
  tasks.

## Live Facts

- Test chat: `-5216637594`.
- Bot: `@veu_support_bot`.
- Test client: `102` / `Test`.
- Student command account: TDLib `102:473`; discover the actual Telegram user
  with `/whoami` before a visible run.
- Kira: `343610488` / `@Kira_arbeitet`.
- Main provider/creator: `8222949251` / `@veu_support`.
- Production Russian translator: `@polinats` (`490903294` unless env changes).
- Test/dev Russian translator lane: `8222949251` / `@veu_support`.
- `CV processing` table ID: `mhiysd8l0f33bny`.
- Test `CV processing` row: `98` for client `102`.

## NocoDB Fields

`clients` fields used by the workflow:

- `telegram_general_chat_id`: linked Telegram common group.
- `telegram_personal_chat_id`: client Telegram username used to authorize the
  student actor inside the linked common group.
- `education`: legacy education field. If `education_entries` is empty, code
  shows this value as one education row with only `uni`.
- `education_entries`: JSON array of `{ uni, faculty, grade, yearOfEnd }`.
  Required before leaving `collection student's data`; at least one row must
  have `uni`.
- `real_age`: required before leaving `collection student's data`.
- `real_location`: required before leaving `collection student's data`.
- `desired_location`: required before leaving `collection student's data`.
- `English level` / `english_levels_id`: required before leaving
  `collection student's data`.
- `google_folder`: root Google folder managed in Console/Noco; this is
  separate from the resume workflow source-data field.
- Platform accounts required before leaving `collection student's data`:
  GitHub platform `github`, a LinkedIn platform account, `telegram_ru`, and
  `telegram_en`. GitHub/LinkedIn validation checks account existence; URL
  fields are used for display when present.

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
- `last_rejection_comment`: last comment used when returning a CV for rework.
- `rejection_history`: append-only history of rejection transitions/comments.
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
- The Russian-version provider step is a separate provider lane for non-RU
  clients. Telegram user IDs in
  `RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS` can open and advance
  `Russian version in process`; main provider users cannot advance that status
  unless they are also configured as a translator in test/dev.
- RU-only clients (`clients.market = Ru` / `ru`) skip the English version after
  draft approval and go directly to `Russian version in process`. That RU step
  is assigned to the main provider/creator, not the translator.
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

Kira and student approval cards include `Согласовать` and
`Вернуть с комментарием`. Reject returns the workflow to the producer phase,
clears that phase link (`cv_draft_url`, `en_version_url`, or `ru_version_url`),
stores `last_rejection_comment`, appends `rejection_history`, and notifies the
producer. Producer phases cannot reject themselves.

API-driven tests that call protected backend endpoints do not create visible
student command history in Telegram. When the common-chat transcript matters,
use the visible e2e runner; it sends the student-owned commands through the
student Telegram account and lets the support bot reply in the common chat.

Before leaving `collection student's data`, the workflow validates education,
real age, English level, real/desired location, GitHub, LinkedIn, Telegram RU,
Telegram EN, root Google folder, and student source folder. If a profile field
is missing, the bot asks the user to add it in the Console. The Telegram bot
only accepts the student source-folder link via `/resume <url>`.

After every successful status change, the backend emits a next-responsible
notification:

- Student next: common chat message with the client mention.
- Kira next: private Kira chat.
- Main provider next: private Provider chat, usually addressed to Yulia.
- Russian translator next: private translator chat, usually addressed to Polina.

When test mode moves a workflow to `moved to filling`, the backend also emits
the HH-summary-channel message:

```text
Test mode, do nothing. Account of [client name + market] is ready to filling, links to RU: [ru], EN: [en]. @kirasamsonova fyi
```

When an EN-market or both-market workflow moves to `moved to filling`, the
backend also emits the LinkedIn-ready notification to the configured LinkedIn
filling chat/thread. RU-market workflows still move to `moved to filling`, but
do not emit the LinkedIn-ready notification because they are filled in a
different async lane.

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
- `POST /api/bot/telegram/chats/:chatId/resume/reject`
- `POST /api/bot/telegram/chats/:chatId/resume/reset-test`
- `GET /api/bot/telegram/resume/provider/tasks`
- `GET /api/bot/telegram/resume/workflows/:workflowId`
- `POST /api/bot/telegram/resume/workflows/:workflowId/advance`
- `POST /api/bot/telegram/resume/workflows/:workflowId/reject`
- `POST /api/bot/telegram/resume/task-input`
- `POST /api/bot/telegram/resume/kira-comments`

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
RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS=8222949251
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
For production, set `RESUME_WORKFLOW_RUS_TRANSLATOR_TELEGRAM_USER_IDS` to the
real translator account (`@polinats`). The example above is the test/dev
default where `@veu_support` owns both provider lanes.

## Local Test Checklist

1. Start the web backend with `WEB_CONSOLE_BOT_API_TOKEN` configured.
2. Start the bot worker with `VEU_SUPPORT_BOT`, `WEB_CONSOLE_BASE_URL`, and the
   same `WEB_CONSOLE_BOT_API_TOKEN`.
3. Set `RESUME_WORKFLOW_TEST_MODE=true` only for a test run.
4. Keep `RESUME_WORKFLOW_FAKE_DATA_MODE=false` for manual testing.
5. Send `/resume` in chat `-5216637594`.
6. If the bot asks for required profile data, fill education rows, real age,
   English level, real/desired location, GitHub, LinkedIn, Telegram RU, and
   Telegram EN in the Console and retry.
7. Use the Kira account for Kira-owned statuses. Add `kiras_comments` before
   advancing the comments step. On approval steps, use `Согласовать` or
   `Вернуть с комментарием`.
8. Use `/open_my_tasks` in the provider private chat for provider-owned
   statuses. Add the draft/EN/RU URL in Noco/Admin Console before pressing
   `Process next step`. Use the Russian translator account for
   `Russian version in process` for non-RU clients. For RU-only clients the
   main provider handles the Russian version.
9. Repeat until the row reaches `filled`.
10. Verify `CV processing` row `98` has status `filled`, manual source folder,
    draft link, English link, Russian link, and Kira comments.

## Automated Tests

Run:

```bash
npm run tg:support-bot:test
npm run tg:resume:e2e:test
npm run web:test
npm run web:e2e
npm run typecheck
npm run web:build
```

Schema helper:

```bash
npm run noco:resume-workflow-schema:test
npm run noco:resume-workflow-schema:dry-run
npm run noco:resume-workflow-schema:apply
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
- `resume_required_data_missing`: add the missing Console/profile data, then
  retry `/resume`.
- `resume_reject_comment_too_short`: use
  `/resume_reject оставил комменты в резюме` or a custom 30+ character comment.
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
