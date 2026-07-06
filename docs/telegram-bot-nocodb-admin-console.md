# Telegram Bot, NocoDB, and Admin Console

This feature connects a Telegram support bot, the web-console API, and NocoDB
client rows.

## Overview

Data flow:

```text
Telegram group -> support bot -> web-console API -> NocoDB
Admin Console -> web-console API -> Telegram Bot API -> Telegram group
```

The bot matches a Telegram group to a student by comparing the current Telegram
chat ID with `clients.telegram_general_chat_id` in NocoDB.

## Environment

```env
VEU_SUPPORT_BOT=
WEB_CONSOLE_BOT_API_TOKEN=
WEB_CONSOLE_BASE_URL=http://127.0.0.1:4300
TELEGRAM_TDLIB_SEND_TIMEOUT_MS=120000
```

- `VEU_SUPPORT_BOT`: Telegram Bot API token for `@veu_support_bot`.
- `WEB_CONSOLE_BOT_API_TOKEN`: shared internal token used by the bot when it
  calls the web-console API.
- `WEB_CONSOLE_BASE_URL`: public or local URL of the web-console backend.
- `TELEGRAM_TDLIB_SEND_TIMEOUT_MS`: how long TDLib sender waits for Telegram
  delivery confirmation before returning a pending-send error.

Do not commit real token values.

## Commands

- `/start`: same lookup behavior as `/student`.
- `/student`: finds the student linked to the current Telegram chat.
- `/whoami`: prints chat ID, chat type, and user ID.
- `/change_google_folder <value>`: updates `clients.google_folder` for the
  client linked to the current chat.

The Google folder value must be non-empty, start with `http://` or `https://`,
and be at most 2048 characters.

## API Endpoints

Bot endpoints use `X-Bot-Api-Token: <WEB_CONSOLE_BOT_API_TOKEN>`.

```http
GET /api/bot/telegram/chats/:chatId/client
PATCH /api/bot/telegram/chats/:chatId/google-folder
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

## NocoDB Fields

On `clients`:

- `telegram_general_chat_id`: linked Telegram group chat ID.
- `google_folder`: Google Drive folder URL updated by the bot.
- `client_name`: display name used in bot replies.

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
3. Send `/change_google_folder https://drive.google.com/drive/folders/example`.
4. Verify `clients.google_folder` changed in NocoDB.
5. Open the admin console, log in as admin, and use “Message to Telegram chat”.
6. Confirm the bot posts the admin message to the linked group.

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
- NocoDB update failed: confirm the client row exists and `google_folder` is a
  valid URL.
- Admin Console message not sent: confirm the client has
  `telegram_general_chat_id`, and check the Bot API token.
- Unauthorized bot API response: make sure the worker sends
  `X-Bot-Api-Token` and the web service has `WEB_CONSOLE_BOT_API_TOKEN`.
