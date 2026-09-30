---
name: telegram-manager-messages
description: Prepare, preview, explicitly approve, and manually send manager-authored Telegram messages to one or many linked common chats using read-only backend data and the shared sendOne/sendMany integration. Use when a manager asks to notify students selected by stack, market, status, or other database/API fields, including personalized per-student messages. Never modify code or source data; only read through SELECT/GET operations and, after explicit approval, use the existing Telegram delivery endpoints.
---

# Telegram Manager Messages

## Purpose

This is an operational skill for sending manual Telegram messages requested by a human manager.

It is not a coding skill.

Its responsibilities are:

1. Understand a manager’s natural-language request.
2. Translate the request into actual database and API entities.
3. Read the required data without modifying anything.
4. Build the exact Telegram delivery payload.
5. Show a clear preview before sending.
6. Require explicit human approval after the preview.
7. Send only through the existing shared Telegram integration, using the
   bundled local adapter when operating inside this repository.
8. Return a clear delivery report.

The skill must never autonomously send messages, schedule messages, change workflows, or modify source code.

## Required context

Before operating:

1. Read `docs/telegram-integration.md`.
2. Read `.agents/skills/telegram-bot/SKILL.md`.
3. Read the canonical database/schema documentation relevant to the requested audience and fields.
4. When Dolphin or another existing integration is involved, read that integration’s documentation before calling it.
5. Use actual current schema names and API contracts. Never guess table names, column names, relations, or endpoint formats from memory.

For the current client audience, verify these canonical mappings against the
live schema before every operation:

- identity: `clients.client_name`;
- destination: `clients.telegram_general_chat_id`, which is the linked common
  Telegram chat, not necessarily the student’s private chat;
- primary stack: `clients.rel_clients_primary_stack` linked to `stacks`;
- market: `clients.market`;
- English level: `clients["English level"]` / `clients.english_levels_id`
  linked to `english_levels`.

The current schema registry is `src/integrations/noco/core/schema.ts`. Current
client projection and relation handling are in
`src/features/web-console/backend/repository.ts`. These implementation paths
are schema evidence, not permission to modify code.

If documentation and the actual API/schema disagree, stop and report the conflict. Do not send.

Use the repository’s already configured application data source. Respect
`APP_DB` and the existing PostgreSQL or NocoDB runtime configuration; do not ask
the manager to choose a source or provide database credentials. Use
parameterized `SELECT` for PostgreSQL or the configured read-only NocoDB client
and `GET` operations. If the configured source cannot be read, report that exact
environment blocker and stop.

## Hard boundaries

### Allowed

- PostgreSQL `SELECT` queries.
- Existing read-only HTTP `GET` endpoints.
- Existing read-only Dolphin API operations.
- Reading NocoDB or other data sources without modifying them.
- Joining, filtering, parsing, deduplicating, counting, grouping, and rendering data in memory.
- Building a temporary `chatId -> message` delivery map.
- Calling the existing Telegram `sendOne` or `sendMany` operation after explicit approval.
- Running `scripts/send.ts` after approval; it is a thin local adapter over the
  same shared integration and does not call the raw Bot API itself.

Local combining, parsing, templating, and counting are considered read-only operations.

### Forbidden

- Modifying repository files.
- Writing new application code.
- Creating branches, commits, or pull requests.
- SQL `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `UPSERT`, DDL, stored procedures with side effects, or `SELECT ... FOR UPDATE`.
- HTTP `POST`, `PUT`, `PATCH`, or `DELETE` calls, except the existing approved Telegram `send-one` and `send-many` delivery endpoints.
- Changing data through NocoDB, Dolphin, the web console, or another integration.
- Calling the raw Telegram Bot API directly.
- Supplying or overriding the bot token.
- Modifying Telegram commands or workflows.
- Using `commands.register` or `commands.dispatch`.
- Creating scheduled or cron-based notifications.
- Browsing the web to invent or supplement student data.
- Inferring missing values from model knowledge.
- Automatically retrying failed sends.

If a read-only operation unexpectedly requires a write-style endpoint, stop and explain the blocker. Do not bypass the restriction.

## Source of truth

Use each source only for the facts it owns:

1. The manager’s explicit current instruction owns the intended audience,
   message meaning, language, and requested action.
2. The live database/API response owns current student values and membership in
   the resolved audience.
3. The live schema and canonical repository documentation own field, relation,
   and endpoint meanings.
4. Existing documented business mappings apply only when they do not conflict
   with the manager’s instruction or current schema/data.

A manager instruction cannot override factual database values or redefine a
schema field. A database value cannot silently change the requested meaning.

Never use remembered or invented student data.

If required data is missing, show it as missing. Do not fabricate a value.

## Interpreting human requests

Translate the manager’s request into a structured plan containing:

- delivery action;
- target entity;
- audience filters;
- required data fields;
- message mode;
- message language;
- exact final message or template;
- delivery method.

### Default semantic mappings

Unless the manager explicitly says otherwise:

- `send`, `write`, `notify`, or `message` means Telegram delivery.
- An unqualified audience such as `every Java EN` means linked common Telegram
  chats from `clients.telegram_general_chat_id`.
- `Java`, `Go`, `React`, and similar terms refer to
  `clients.rel_clients_primary_stack` linked to `stacks`; resolve the requested
  value against current stack records.
- `EN` refers to the market relation, not the message language, and matches
  canonical market values `en` and `both`.
- `RU` refers to the market relation, not automatically to the Russian message
  language, and matches canonical market values `ru` and `both`.
- `in English`, `write in English`, or equivalent wording refers to message language.
- `every`, `all`, or `everyone` means all records matching the resolved filters.
- `their English level` means the linked `English level` value resolved through
  `english_levels_id` and the `english_levels` table.
- `chat` or `Telegram chat` means the linked common chat stored in
  `clients.telegram_general_chat_id`.

These mappings must always be shown in the preview.

Do not silently add hidden filters such as active status unless canonical business documentation defines that as the normal meaning of “students.” Always display any applied status filter.

### Example interpretation

Manager request:

> Send every Java EN student that they are potatoes.

Interpret as:

- action: Telegram `sendMany`;
- entity: students;
- audience filter: stack = Java;
- audience filter: market = EN;
- destination: linked common Telegram chat ID from
  `clients.telegram_general_chat_id`;
- message: convert the manager’s intent into a direct recipient-facing message, then show the exact wording in the preview.

Do not send after interpretation. First display the preview and wait for approval.

### Ambiguity

If one phrase can map to several materially different fields or audiences, do not guess.

Examples:

- `English students` could mean EN market, English language, or English level.
- `Java students` could mean primary stack or any related stack.
- `current students` could map to several statuses.

Any request using a status term must be clarified before querying, even when
one interpretation looks likely. Ask which current schema field/relation and
which exact value or values the manager means. Do not maintain or infer a fixed
list of status fields: new status domains may be added over time.

Resolve ambiguity from canonical business documentation where possible.

If it remains ambiguous:

1. Explain the possible interpretations.
2. Ask the manager to choose.
3. Do not produce an approvable send preview until the ambiguity is resolved.

## Query construction

Natural language must never be inserted directly into SQL.

Convert the request into structured, allowlisted filters.

Requirements:

- use parameterized SQL;
- use actual documented columns and relations;
- use read-only queries only;
- select only fields required for audience resolution, preview, and message rendering;
- record the resolved source fields in the preview;
- do not execute arbitrary SQL supplied inside the manager’s message;
- do not treat message text as a query expression.

For the current default client audience, use the exact mappings documented
above. Treat `en`/`both` as EN and `ru`/`both` as RU. Do not substitute the
legacy sheet labels when current Noco/PostgreSQL fields and relations are
available.

When several read-only sources are required, join them using documented stable identifiers.

Report unmatched or conflicting records rather than guessing how to join them.

## Audience resolution

For every potential recipient, resolve at least:

- a manager-readable identity, such as student name;
- Telegram `chatId`;
- fields used by audience filters;
- fields used to personalize the message;
- exclusion reason, when excluded.

### Telegram chat rules

- The delivery integration accepts Telegram `chatId`, not internal database IDs.
- The current destination source is `clients.telegram_general_chat_id`. It is a
  linked common chat with the team and must not be described as a guaranteed
  private student chat.
- Never pass student ID, client ID, platform-account ID, or another application ID as `chatId`.
- Trim and validate chat IDs before preview.
- Canonicalize a digits-only positive value read from
  `clients.telegram_general_chat_id` by prefixing `-` before preview and
  delivery. This field is defined as a linked common group chat, and Telegram
  group chat IDs are negative. Preserve an existing leading `-` unchanged.
- Show both the stored value and the canonical destination in the preview
  whenever this sign normalization was applied.
- This sign rule applies only to `clients.telegram_general_chat_id`; do not
  invent, reconstruct, or normalize missing IDs or IDs from another field.
- A missing or invalid chat ID must be shown as an exclusion.

### Deduplication

Deduplicate by `chatId`.

If duplicate rows produce the same final message:

- keep one delivery;
- report how many duplicate rows were collapsed.

If the same `chatId` would receive different personalized messages:

- do not overwrite one message with another;
- mark the batch as blocked;
- display the conflicting records;
- require the manager to resolve the conflict.

## Message modes

### Common message

One exact message is sent to every selected chat.

Example:

> You are a potato.

### Personalized message

Each chat receives a separately rendered message based on read-only data.

Example manager request:

> Send every student their English level and tell them to update it if it is no longer relevant.

Possible rendered message:

> Your current English level is B2.
>
> Please update this information if it is no longer accurate.

The complete personalized `chatId -> message` payload must be finalized before approval.

It is not necessary to display every rendered message when the batch is large.

Before approval, show:

- the template and fields used;
- the total recipient count;
- 2–3 representative fully rendered messages;
- normal variations in the data;
- every materially different exceptional variant;
- counts for missing values, fallback variants, and exclusions.

Representative examples should cover meaningful normal differences.

Exceptional examples must cover cases such as:

- no English level set;
- missing personalization data;
- fallback wording;
- unusual formatting;
- exclusion from sending.

Approval applies to the complete frozen payload, including messages that are not displayed individually.

### Example personalized preview

```text
Personalized message variants

Representative example — B2:
“Your current English level is B2.

Please update this information if it is no longer accurate.”

Representative example — C1:
“Your current English level is C1.

Please update this information if it is no longer accurate.”

Missing English level — 3 students:
No message will be sent to these students until you choose one of the following:

- exclude them; or
- approve this fallback message:

“Your English level is not currently specified.

Please update this information.”
```

### Missing personalization data

Never render values such as:

- `undefined`;
- `null`;
- an empty placeholder;
- a guessed default.

If a required personalized field is missing:

1. Count affected recipients.
2. Show representative affected recipients.
3. Show the exact exceptional message variant, when one is proposed.
4. Block sending until the manager chooses one of:
   - exclude recipients with missing data;
   - use an explicitly approved fallback message;
   - cancel the operation.

Do not make that decision silently.

### Message validation

Before creating an approvable preview, validate every final rendered message:

- it must be a non-empty string after trimming;
- it must contain no more than 4096 characters;
- it must contain no unresolved template markers or missing-value placeholders;
- its `chatId` must be a non-empty trimmed Telegram destination string from the
  documented source field.

Block the batch and report every invalid recipient/message. Do not rely on the
send endpoint to discover validation failures after approval.

## Message wording

Preserve the manager’s requested meaning and language.

Do not silently:

- translate;
- soften;
- expand;
- improve;
- add marketing wording;
- add emojis;
- add greetings;
- add signatures.

When the manager gives indirect wording, convert it into a direct recipient-facing message only for preview.

Always display the exact common message or the exact personalized template and representative variants before approval.

Approval confirms the exact prepared payload.

## Mandatory preview

The initial message requesting a send is only a request to prepare a preview.

Even when the manager writes `send`, `notify`, `write`, or another imperative, that initial instruction is not final approval.

No Telegram delivery may happen before a separate approval message sent after the preview.

### Preview ID

Bind every preview ID to the complete frozen payload. Generate a fresh 128-bit
random nonce, canonicalize the payload as a JSON array of
`[chatId, finalMessage]` pairs sorted lexicographically by `chatId`, and
calculate SHA-256 over the nonce, a newline, and the canonical UTF-8 JSON. Use
the first eight uppercase hexadecimal characters after `TG-`, for example:

```text
TG-A7C31F20
```

Use eight hexadecimal characters in every preview. If recipients, messages, or
personalized values change, recalculate the hash and create a new preview ID.
The approval authorizes only the exact canonical payload associated with that
preview ID. Keep the nonce, full hash, and frozen map together in the active
operation context; never accept an approval for an ID whose frozen context is
no longer available. Re-preparing even the same payload uses a new nonce and a
new preview ID.

### Required preview format

Use this structure:

```text
Telegram delivery preview: TG-A7C31F20

Interpretation
- Operation: sendMany
- Entity: students
- Stack: Java
- Market: EN
- Status filter: <exact applied filter or “none”>
- Message mode: common / personalized
- Message language: English

Data sources
- <actual table/API and relevant fields>
- <additional GET source, if used>

Resolved schema
- Identity: clients.client_name
- Destination: clients.telegram_general_chat_id (linked common chat)
- Stack: clients.rel_clients_primary_stack -> stacks
- Market: clients.market (EN includes en + both)

Audience
- Matched records: 12
- Unique valid chat IDs: 11
- Excluded: 1
- Deduplicated: 0
- Conflicts: 0

Exact common message
“You are a potato.”

Or, for a personalized batch:

Personalization
- Template: “Your current English level is {{englishLevel}}...”
- Fields used: englishLevel
- Fully populated recipients: 9
- Missing englishLevel: 2
- Exceptional variants: 1

Representative messages
- Student A: “Your current English level is B2...”
- Student B: “Your current English level is C1...”
- Missing-value variant: “Your English level is not currently specified...”

Excluded recipients
- Student Name — missing Telegram chat ID

Delivery operation
- sendMany
- one message per chat ID
- existing Telegram integration
- no database changes

To approve exactly this prepared batch, reply with one of:

SEND TG-A7C31F20
ОТПРАВИТЬ TG-A7C31F20
ОТПРАВЬ TG-A7C31F20
ОТПРАВЛЯЙ TG-A7C31F20
```

For personalized batches, do not print all 50 messages when representative examples and complete variant counts are sufficient.

Show the full prepared recipient/message table only when reasonably small or when the manager explicitly requests it.

Never hide:

- exclusions;
- missing data;
- fallback variants;
- message conflicts;
- deduplication counts.

## Approval rules

Accept approval only after a valid preview.

Approval matching is case-insensitive, but the exact current preview ID is mandatory.

Supported approval phrases:

```text
SEND <previewId>
ОТПРАВИТЬ <previewId>
ОТПРАВЬ <previewId>
ОТПРАВЛЯЙ <previewId>
```

Valid examples:

```text
SEND TG-A7C31F20
ОТПРАВИТЬ TG-A7C31F20
ОТПРАВЬ TG-A7C31F20
ОТПРАВЛЯЙ TG-A7C31F20
```

These are not approvals:

```text
send
отправить
отправь
отправляй
да
ок
yes
looks good
go
можно отправлять
👍
```

Without the exact current preview ID, nothing is sent.

Approval given before the preview is invalid.

Approval mentioning an expired, replaced, or incorrect preview ID is invalid.

If the approval message includes any modification, such as:

```text
ОТПРАВЬ TG-A7C31F20, но исключи Ивана
```

do not send.

Instead:

1. Apply the requested change using read-only operations.
2. Create a new preview ID.
3. Show a new preview.
4. Require approval again.

Any change to recipients, filters, message text, template, personalized values, language, fallback rules, or exclusions invalidates the previous approval.

## Frozen delivery plan

At preview time, create the exact prepared delivery plan:

```text
chatId -> final rendered message
```

Approval authorizes only that frozen map.

Do not silently regenerate the message wording after approval.

Do not silently re-resolve the audience after approval in a way that changes the batch.

If a necessary final read detects changed recipients or personalized data:

1. Do not send.
2. Invalidate the preview.
3. Show what changed.
4. Create a new preview.
5. Require new approval.

## Sending

After exact approval:

- use `sendOne` when there is one destination;
- use `sendMany` when there are multiple destinations;
- when operating locally in this repository, use the bundled adapter first:
  `node .agents/skills/telegram-manager-messages/scripts/send.ts
  --payload-base64=<base64-json>`;
- encode only `{ previewId, operation, input }`; never include credentials in
  the adapter payload;
- the adapter calls the shared `telegram.sendOne` or `telegram.sendMany`
  directly, performs exactly one integration call, and prints safe typed
  evidence without the outgoing text;
- use `POST /api/bot/telegram/send-one` or
  `POST /api/bot/telegram/send-many` only when operating as a remote client of
  an already running backend;
- resolve the backend from `WEB_CONSOLE_BASE_URL`, defaulting to
  `http://127.0.0.1:4300` consistently with the existing support bot;
- authenticate with the existing `X-Bot-Api-Token` header populated from
  `WEB_CONSOLE_BOT_API_TOKEN` in the execution environment;
- use existing preset bot credentials;
- never ask the manager for the bot token;
- never call the raw Telegram Bot API;
- never add an additional delay outside the shared integration;
- rely on the existing two-second inter-message delay inside `sendMany`.

`VEU_SUPPORT_BOT` is a server-side Telegram credential and must never be read
from the manager, placed in a payload, or sent as a header. The manager does not
need to provide credentials. A local operation does not require the web backend
to be running and does not require `WEB_CONSOLE_BOT_API_TOKEN`; the adapter uses
the configured `VEU_SUPPORT_BOT` only inside the existing shared integration.
For a remote operation, if `WEB_CONSOLE_BASE_URL` is unreachable or
`WEB_CONSOLE_BOT_API_TOKEN` is absent, report the exact configuration blocker
and do not send or invent another remote route.

The endpoint payloads are:

```json
{ "chatId": "<telegram destination>", "text": "<final message>" }
```

and:

```json
{
  "<chatId>": { "text": "<final message>" }
}
```

Do not change database or external-service data before or after sending.

## Delivery result handling

Consume the existing typed results exactly as documented in `docs/telegram-integration.md`.

### Telegram response

When:

```text
kind = telegram-response
```

inspect the native `ApiResponse`.

If:

```text
response.ok = true
```

the message was accepted by Telegram.

Record at least:

- recipient identity;
- chat ID;
- Telegram message ID.

If:

```text
response.ok = false
```

report the native Telegram error:

- `error_code`;
- `description`;
- relevant `parameters`, such as `retry_after`.

### Client failure

When:

```text
kind = client-failure
```

report:

- failure stage;
- error name;
- error message;
- available safe code/status.

Do not reinterpret a client failure as a Telegram `ApiError`.

Do not duplicate the Telegram integration’s own error logging or critical-alert routing.

## Post-send report

Choose the report headline from the outcome.

When every attempted message has `kind = telegram-response` and
`response.ok = true`, begin the report with exactly:

```text
Все сообщения успешно отправлены
```

For a partial or complete failure, use:

```text
Telegram delivery completed with failures: TG-A7C31F20

Prepared: 12
Attempted: 11
Sent successfully: 10
Telegram API errors: 1
Client failures: 0
Excluded before sending: 1

Successful
- Student A — chat 123... — message ID 501
- Student B — chat 456... — message ID 502

Failed
- Student C — chat 789... — Telegram 403:
  Forbidden: bot was blocked by the user

Not attempted
- Student D — missing Telegram chat ID
```

For large successful batches, a compact successful summary is acceptable.

Every failure and every exclusion must be shown.

Never report a message as sent unless the typed result confirms Telegram success.

## Retry rules

Do not automatically retry any failed message.

To retry:

1. Prepare a new batch containing only the failed recipients.
2. Show a new preview with a new preview ID.
3. Display the original failure reasons.
4. Require a new explicit approval.
5. Send only after that approval.

A partial failure never authorizes an automatic retry.

## Manual-only invariant

Every send must originate from a current human manager request.

This skill must not:

- act on cron events;
- monitor data for changes;
- send proactive messages;
- schedule future delivery;
- reuse an old approval for a new batch;
- send follow-ups without another explicit request and approval.

## Example: common batch

Manager:

```text
Send every Java EN student that they are potatoes.
```

Skill:

1. Resolves `Java` to the canonical stack field.
2. Resolves `EN` to the canonical market field.
3. Resolves the audience to student Telegram chats.
4. Reads matching records and chat IDs.
5. Displays the exact final common message.
6. Displays the count, exclusions, deduplication, and filters.
7. Creates a preview ID.
8. Waits for an exact approval phrase containing that preview ID.
9. Calls `sendMany` only after approval.
10. Returns the typed delivery report.

## Example: personalized batch

Manager:

```text
Send every student their English level and ask them to update it if it is no longer accurate.
```

Skill:

1. Reads student name, Telegram chat ID, and English level.
2. Detects missing chat IDs and missing English levels.
3. Renders the complete personalized `chatId -> message` map.
4. Shows the template and fields used.
5. Shows 2–3 representative normal messages.
6. Shows every exceptional variant and the number of recipients affected.
7. Blocks approval if missing levels have no approved handling rule.
8. Creates a frozen delivery payload.
9. Requires an exact approval phrase with the preview ID.
10. Calls `sendMany`.
11. Reports every success, failure, and exclusion.

## Final invariants

- Read first, preview second, approve third, send fourth.
- The initial `send` request is never final approval.
- Only `sendOne` and `sendMany` may perform writes.
- All audience and personalization-data access is read-only.
- No source code is created or modified.
- No database or external-service data is changed.
- Human terms are mapped to actual documented schema entities.
- EN includes `en` and `both`; RU includes `ru` and `both`.
- Every status-based filter is clarified against the current schema before
  querying; status meanings are never inferred from a fixed list.
- Every applied interpretation is visible before approval.
- The complete delivery payload is finalized before approval.
- Large personalized batches use representative examples rather than printing every message.
- Every exceptional message variant is shown with its recipient count.
- Missing values are never invented.
- Duplicate-chat conflicts are never silently overwritten.
- One approval applies to one exact frozen delivery plan.
- The preview ID is derived from the canonical frozen payload hash.
- The exact preview ID is mandatory.
- Russian approval verbs `ОТПРАВИТЬ`, `ОТПРАВЬ`, and `ОТПРАВЛЯЙ` are supported only when followed by the exact current preview ID.
- One failure never causes an automatic retry.
- Every reported success must be supported by the typed Telegram response.
