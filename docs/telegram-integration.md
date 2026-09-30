# Telegram Bot integration

`src/integrations/telegram/index.ts` is the shared Bot API boundary for the
support/CV bot, CV notifications, backend Bot endpoints, admin sends, and the
visible CV runner. It deliberately exposes only four runtime operations:

- `telegram.sendOne`
- `telegram.sendMany`
- `telegram.commands.register`
- `telegram.commands.dispatch`

Telegram types come from type-only imports of `@grammyjs/types`. The integration
does not install or run grammY or Telegraf.

The integration assumes exactly one bot. It reads `VEU_SUPPORT_BOT` from server
configuration; callers cannot choose a bot or provide a token. It owns Bot API
HTTP, send validation, result classification, batching, the small command
registry, safe logging, and error reporting. It does not own CV states, roles,
chat-ID discovery, scheduling, TDLib user accounts, or a generic workflow/session
framework. Feature code must not add direct Bot API requests: use this facade.

## TypeScript inputs

```ts
type SendOneInput = {
  chatId: string
  text: string
  messageThreadId?: number
  parseMode?: ParseMode
  replyMarkup?: InlineKeyboardMarkup | ReplyKeyboardMarkup |
    ReplyKeyboardRemove | ForceReply
  linkPreviewOptions?: LinkPreviewOptions
}

type SendManyInput = Record<string, Omit<SendOneInput, 'chatId'>>
```

`chatId` is always a Telegram destination ID. It is never a student, client,
user, mentor, workflow, or database record ID. Link previews are disabled by
default; an explicit `linkPreviewOptions` object takes precedence.

## Result contract

`sendOne` always resolves to `SendOneResult`; an ordinary send failure never
rejects its promise.

- `kind: 'telegram-response'` contains the complete, unchanged Telegram
  `ApiResponse<Message.TextMessage>`. This includes both `ok: true` and every
  valid `ok: false` Bot API response, including `parameters` and unknown future
  fields.
- `kind: 'client-failure'` means that no valid Telegram response was available.
  Its stage is exactly one of `validation`, `configuration`, `transport`,
  `response`, or `internal`.

The minimum accepted success body has `ok: true`, an object `result`, numeric
`message_id` and `date`, an object `chat` with numeric `id` and string `type`,
and string `text`. The minimum accepted API error has `ok: false`, numeric
`error_code`, and string `description`. Extra fields are retained without
mapping. HTML, non-JSON, primitives, arrays, `null`, invalid `ok`, and partial
bodies become a `response` client failure.

Classification is stable:

| Outcome | Result |
| --- | --- |
| Valid Telegram success | `telegram-response`, `response.ok === true` |
| Valid Telegram API error, including 400/401/403/429/5xx | `telegram-response`, `response.ok === false` |
| Invalid local input | `client-failure`, `validation` |
| Missing token/runtime configuration | `client-failure`, `configuration` |
| Timeout, abort, DNS/reset/connection/fetch rejection | `client-failure`, `transport` |
| Unreadable, non-JSON, or malformed Telegram body | `client-failure`, `response` |
| Unexpected implementation failure | `client-failure`, `internal` |

## Exhaustive consumer pattern

CV bot consumers must branch first on `kind`, then on Telegram's native `ok`
discriminant. This is exhaustive and needs no casts:

```ts
import type { ApiError, Message } from '@grammyjs/types'
import { telegram } from '../src/integrations/telegram/index.ts'

const result = await telegram.sendOne({ chatId, text })

if (result.kind === 'client-failure') {
  switch (result.failure.stage) {
    case 'validation':
    case 'configuration':
    case 'transport':
    case 'response':
    case 'internal':
      recordNotificationWarning(result.failure)
      break
  }
} else if (result.response.ok) {
  const sentMessage: Message.TextMessage = result.response.result
  recordTelegramMessageId(sentMessage.message_id)
} else {
  const apiError: ApiError = result.response
  const retryAfter = apiError.parameters?.retry_after
  recordTelegramApiFailure(apiError.error_code, apiError.description, retryAfter)
}
```

Do not repeat a CV business action merely because its notification outcome is
unclear. A completed transition remains completed; record a notification
warning and let the next workflow action read the persisted `CV processing`
state.

## Batches

`sendMany` accepts a map keyed by destination chat ID. It iterates
`Object.entries` in order, returns one `SendOneResult` for every key, and waits
2000 ms only between attempts. A failed or unexpectedly throwing item cannot
stop later items. Tests may inject the delay function.

One call supports one message per chat ID because object keys are unique.
Numeric-looking keys follow JavaScript object-enumeration rules; the contract
does not promise caller insertion order for them.

```ts
const results = await telegram.sendMany({
  '123456789': { text: 'Private message' },
  '-1001234567890': { text: 'Topic message', messageThreadId: 42 }
})
```

## Commands

Registered names must match `/[a-z0-9_]{1,32}`. Registration is case-insensitive
and rejects malformed names, duplicates, and non-functions. `dispatch` is the
only public boundary accepting `unknown`; it validates the minimum native text
message shape before calling a handler.

The handler receives the complete original `Message.TextMessage`. Its
`context.reply()` calls `sendOne` immediately, returns that same result, and
places the same object in `dispatchResult.replies`; there is no deferred or
duplicate send. Handler exceptions are logged and rethrown to the existing
poll-loop boundary, which continues with the next update.

Commands do not expire after inactivity. The separate 30-minute CV task and
rejection context is expected business behavior: expiration is not an
integration failure and must not trigger local or remote error alerts.

```ts
telegram.commands.register('/status', async context => {
  const result = await context.reply({ text: `Chat ${context.message.chat.id}` })
  if (result.kind === 'client-failure') recordWarning(result.failure)
})

const dispatchResult = await telegram.commands.dispatch(rawTelegramMessage)
```

## Backend Bot endpoints

Both endpoints require the existing `X-Bot-Api-Token` authentication enforced
by `requireBotApiToken`. Bot credentials are read from server configuration;
`VEU_SUPPORT_BOT` is never accepted from body, query, or request headers.
`WEB_CONSOLE_BOT_API_TOKEN` remains the sole endpoint credential; no new
authentication mechanism is introduced.

- `POST /api/bot/telegram/send-one` accepts `SendOneInput`. A valid Telegram
  response always uses HTTP 200. Client failures map to 400 `validation`, 503
  `configuration`, 502 `transport`/`response`, or 500 `internal`.
- `POST /api/bot/telegram/send-many` accepts `SendManyInput`. A valid map always
  uses HTTP 200 and returns the complete per-chat result map.

## Logging and reporting

Logs contain metadata such as text length, duration, chat/message ID, stage,
and Telegram error code. They do not contain the outgoing text, bot-token URL,
authorization/cookie/password/secret/credential fields, or credentials.

Malformed values pass through a never-throw sanitizer: depth 5, strings 512
characters, arrays 25 items, objects 50 keys, circular markers, and sensitive
key/token redaction. Logger, sanitizer, and remote reporter failures never
change the original result.

Validation/transport failures and non-401 Telegram API errors report to
`-5216637594`. Configuration/response/internal failures and Telegram 401 report
to `summary_logs_channel_id`. Reporting uses a no-report internal send path, so
its own failure cannot recurse.

## Checks

```powershell
npm run tg:integration:test
npm run tg:support-bot:test
npm run tg:resume:e2e:test
node src/features/web-console/backend/telegram-integration-routes.test.ts
npm run typecheck
```
