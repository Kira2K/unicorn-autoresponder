# My group info: SQL secured invitation

Private `/start` matches `message.from.username` against
`noco.clients.telegram_personal_chat_id`. Normalization trims surrounding
whitespace, removes one leading `@`, and ignores ASCII case. Command arguments,
forwarded sender names, and display names never choose the student.

The only invitation source is the matched client's `secured_general_chat_id`
and `secured_general_chat_invitation_link`. The bot replies once with a greeting
and an inline button, using the existing shared Telegram integration. It never
initiates a conversation, creates an invitation, or adds a member. Group
`/start`, `/student`, and CV commands retain their previous behavior. Stack
and other useful groups are deferred.

## Source and API

`POST /api/bot/telegram/my-group-info` requires the existing
`X-Bot-Api-Token` (`WEB_CONSOLE_BOT_API_TOKEN`). Input:

```json
{ "username": "very_evil_unicorn" }
```

The trusted bot supplies the username from Telegram's original message.
This is an internal backend endpoint, not a public self-service lookup.

Results have `kind`: `found`, `missing-username`, `unknown-student`,
`ambiguous-student`, or `link-unavailable`. Only `found` includes `clientName`,
`chatId`, and `invitationLink`. Responses use `Cache-Control: no-store`.
Malformed input returns 400, unauthorized requests 401, and an unavailable SQL
source 503 without provider details or invitations in errors.

SQL composition injects a read-only reader using the existing pool. The query
is parameterized and returns at most two matching rows to detect duplicates.
Deleted clients are excluded. It does not hydrate all students or related data.
No schema migration, database updates, or new Telegram facade methods are needed.

Both secured fields must be populated. The ID must be a negative decimal chat
ID, and the link must be `https://t.me/+...` or `https://t.me/joinchat/...`.
Missing/invalid values never fall back to the ordinary general chat.
The bot validates syntax only; it does not check whether Telegram revoked the
invitation. Replace revoked invitations in SQL outside the command handler.

Username ownership can change. The current owner of the stored username receives
the invitation; update SQL promptly when a student changes their username.
There is no new role grant, user registration, or numeric-ID persistence.

## Local manual test

Use Node 24 and the project's existing `.env`. Both processes need matching
`WEB_CONSOLE_BOT_API_TOKEN`; the bot also needs `VEU_SUPPORT_BOT`. Backend needs
`APP_DB=postgres` and working `APP_DB_POSTGRES_*` settings.

First stop any other poller for the same bot token (including Render). Keep
SQL and any separate backend services available. In a PowerShell terminal:

```powershell
cd C:\Users\kiras\hh-autoparcer
$env:APP_DB = 'postgres'
$env:WEB_CONSOLE_USE_MOCK_DATA = 'false'
$env:PORT = '4300'
$env:WEB_CONSOLE_PORT = '4300'
npm run web:backend
```

Wait for `Web console backend listening at http://127.0.0.1:4300`.
In a second PowerShell terminal:

```powershell
cd C:\Users\kiras\hh-autoparcer
$env:WEB_CONSOLE_BASE_URL = 'http://127.0.0.1:4300'
npm run tg:support-bot
```

1. From the account whose current username matches the SQL row, send private
   `/backend_status`, then `/start`. Expect one reply with `Открыть мою группу`.
2. Open the button and confirm the intended group; leaving the group is
   unnecessary. No bot administrator rights in that group are required to
   send an already stored invitation.
3. From an unmapped account, expect no button. Without username, expect a prompt
   to set one. `/start @another_user` must still identify the actual sender.
4. In the group, `/start@veu_support_bot` retains its previous greeting.
5. Stop the local bot with Ctrl+C before restoring the Render poller.

Changing SQL values requires no bot restart. Local code does not update the
Render deployment; both bot and backend need the updated code when deploying.

## Checks

The existing CV regression suites expect fixture role and notification settings
normally provided by local `.env`. For a clean checkout, set these values only
for the mock test commands below; no production credentials are needed.

```powershell
$env:RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS = '343610488'
$env:RESUME_WORKFLOW_LINKEDIN_READY_CHAT_ID = '-1000000000099'
npm run tg:my-group-info:test
npm run tg:support-bot:test
npm run tg:integration:test
npm run tg:resume:e2e:test
npm run typecheck
```

Feature tests inject rows, SQL sessions, HTTP, and reply transports. They do not
write databases or send live Telegram messages.

## Release and rollback

Deploy the backend before the bot, using the same commit on both services.
The backend must use PostgreSQL and the existing nullable text columns
`noco.clients.secured_general_chat_id` and
`noco.clients.secured_general_chat_invitation_link`. This release reads them;
it does not create columns, fill invitations, or restore groups and files.

Keep `WEB_CONSOLE_BOT_API_TOKEN` consistent between bot and backend. Keep one
poller for `VEU_SUPPORT_BOT`. No new environment variables are required.
After deployment, check private `/start` for a mapped account, missing username,
and unavailable invitation; confirm group `/start` and `/student` still work.

To roll back, restore the previous bot version first, then the backend. Leave
the secured SQL fields intact; this feature has no database write path.
