---
name: telegram-manager-messages
description: Prepare, preview, explicitly approve, and manually send manager-authored Telegram messages to one or many existing chats using read-only backend data and the shared sendOne/sendMany integration. Use when a manager asks to notify students selected by stack, market, status, or other database/API fields, including personalized per-student messages. Never modify code or source data; only read through SELECT/GET operations and, after explicit approval, use the existing Telegram delivery endpoints.
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
7. Send only through the existing shared Telegram integration.
8. Return a clear delivery report.

The skill must never autonomously send messages, schedule messages, change workflows, or modify source code.

## Required context

Before operating:

1. Read `docs/telegram-integration.md`.
2. Read `.agents/skills/telegram-bot/SKILL.md`.
3. Read the canonical database/schema documentation relevant to the requested audience and fields.
4. When Dolphin or another existing integration is involved, read that integration’s documentation before calling it.
5. Use actual current schema names and API contracts. Never guess table names, column names, relations, or endpoint formats from memory.

If documentation and the actual API/schema disagree, stop and report the conflict. Do not send.

## Hard boundaries

### Allowed

- PostgreSQL `SELECT` queries.
- Existing read-only HTTP `GET` endpoints.
- Existing read-only Dolphin API operations.
- Reading NocoDB or other data sources without modifying them.
- Joining, filtering, parsing, deduplicating, counting, grouping, and rendering data in memory.
- Building a temporary `chatId -> message` delivery map.
- Calling the existing Telegram `sendOne` or `sendMany` operation after explicit approval.

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

Use this priority:

1. The manager’s explicit current instruction.
2. Canonical repository documentation.
3. The actual current database/API response.
4. Existing documented business mappings.

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
- An unqualified audience such as `every Java EN` means student Telegram chats.
- `Java`, `Go`, `React`, and similar terms refer to the canonical stack field or stack relation.
- `EN` refers to the EN market field, not the message language.
- `RU` refers to the RU market field, not automatically to the Russian message language.
- `in English`, `write in English`, or equivalent wording refers to message language.
- `every`, `all`, or `everyone` means all records matching the resolved filters.
- `their English level` means the actual English-level field from the database.
- `chat` or `Telegram chat` means the stored Telegram `chatId`.

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
- destination: stored student Telegram chat ID;
- message: convert the manager’s intent into a direct recipient-facing message, then show the exact wording in the preview.

Do not send after interpretation. First display the preview and wait for approval.

### Ambiguity

If one phrase can map to several materially different fields or audiences, do not guess.

Examples:

- `English students` could mean EN market, English language, or English level.
- `Java students` could mean primary stack or any related stack.
- `current students` could map to several statuses.

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
- Never pass student ID, client ID, platform-account ID, or another application ID as `chatId`.
- Trim and validate chat IDs before preview.
- Do not invent or reconstruct missing chat IDs.
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

Create a unique short preview ID for every prepared batch, for example:

```text
TG-A7C31F
```

The approval authorizes only the exact prepared payload associated with that preview ID.

### Required preview format

Use this structure:

```text
Telegram delivery preview: TG-A7C31F

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

SEND TG-A7C31F
ОТПРАВИТЬ TG-A7C31F
ОТПРАВЬ TG-A7C31F
ОТПРАВЛЯЙ TG-A7C31F
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
SEND TG-A7C31F
ОТПРАВИТЬ TG-A7C31F
ОТПРАВЬ TG-A7C31F
ОТПРАВЛЯЙ TG-A7C31F
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
ОТПРАВЬ TG-A7C31F, но исключи Ивана
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
- call only the documented authenticated backend endpoints or internal client;
- use existing preset bot credentials;
- never ask the manager for the bot token;
- never call the raw Telegram Bot API;
- never add an additional delay outside the shared integration;
- rely on the existing two-second inter-message delay inside `sendMany`.

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

After delivery, show a report in this format:

```text
Telegram delivery completed: TG-A7C31F

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
- Every applied interpretation is visible before approval.
- The complete delivery payload is finalized before approval.
- Large personalized batches use representative examples rather than printing every message.
- Every exceptional message variant is shown with its recipient count.
- Missing values are never invented.
- Duplicate-chat conflicts are never silently overwritten.
- One approval applies to one exact frozen delivery plan.
- The exact preview ID is mandatory.
- Russian approval verbs `ОТПРАВИТЬ`, `ОТПРАВЬ`, and `ОТПРАВЛЯЙ` are supported only when followed by the exact current preview ID.
- One failure never causes an automatic retry.
- Every reported success must be supported by the typed Telegram response.
