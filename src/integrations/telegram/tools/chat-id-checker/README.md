# TG Chat ID Checker

Service for finding fresh student Telegram mentor chats and producing the final chat-id report that we can use to fill `Id общего чата` in the personal data table.

## What This Service Answers

The final question is:

> Which fresh VEU mentor chats exist in Telegram, which student from our table belongs to each chat, and what Telegram `chatId` should be written back to the table?

The service does not update Google Sheets by itself. It only reads Telegram + Google Sheets and writes a local report.

## Data Sources

### Telegram

The service logs in through `createTelegramClient` from `messenger.ts` and scans dialogs visible to that Telegram account.

Only readable group dialogs are considered:

- `dialog.isGroup === true`
- not a private user dialog
- not a broadcast channel

By default, a chat is considered a fresh student mentor chat when its title:

- starts with `VEU`
- contains `ментор`

Examples:

```text
VEU Иван Ч. React [ментор Лиза]
VEU Дима Python [ментор Лиза]
```

### Google Sheet

The service reads only `ПЕРС ДАННЫЕ`.

Relevant rows:

- `имя`
- `рынок`
- `Id общего чата`
- `Реальные данные` / `ФИО`
- `Реальные данные` / `ТГ`

The student Telegram username from the table is normalized before matching:

- leading `@` is removed
- case is ignored
- surrounding spaces are ignored

## Commands

Print all matching fresh student chats:

```powershell
npm run tg:chat-id-checker
```

Generate the final belongings report:

```powershell
npm run tg:chat-id-checker -- --belongings
```

Write the report to a custom file:

```powershell
npm run tg:chat-id-checker -- --belongings --output src/integrations/telegram/tools/chat-id-checker/fresh-student-chats.txt
```

Default output file:

```text
src/integrations/telegram/tools/chat-id-checker/fresh-student-chats.txt
```

## Final Report Meaning

The report is a pipe-separated text table:

```text
Chatname | student's tg according to table | student's name according to table | рынок according to table | chatId | status
```

Column meanings:

- `Chatname`: Telegram group title.
- `student's tg according to table`: student Telegram username from `ПЕРС ДАННЫЕ`.
- `student's name according to table`: student full name from `Реальные данные / ФИО`, or fallback `имя`.
- `рынок according to table`: market from `рынок`.
- `chatId`: Bot API compatible chat id to paste into `Id общего чата`.
- `status`: confidence of the match.

Statuses:

- `verified`: exactly one matching table student was found among chat participants.
- `ambiguous`: more than one matching table student was found in the same chat; this needs manual review.
- `not_found`: reserved for unmatched cases, but the current belongings report normally omits chats without a matching target student.

## Which Rows Appear In The Final Report

The belongings report intentionally shows only students who:

- are found in a matching Telegram mentor chat,
- have a Telegram username in `ПЕРС ДАННЫЕ`,
- have empty `Id общего чата`,
- have market `En` or `Ru/En`.

So the final report is a to-do list: each row is a chat id we likely need to write back to the table.

Rows are skipped when:

- the student already has `Id общего чата`,
- the market is not `En` or `Ru/En`,
- the student has no Telegram username in the table,
- the student is not visible in the chat participants list,
- the chat title does not match the `VEU` + `ментор` pattern.

## Chat ID Rules

Telegram internal ids are converted to Bot API compatible ids:

- `Channel` / megagroup: `-100${entity.id}`
- classic `Chat`: `-${entity.id}`
- fallback: raw dialog id

This is why the final `chatId` often starts with `-100`.

## Safety

This service is read-only for external systems:

- does not write to Google Sheets
- does not send Telegram messages
- does not create or modify Telegram chats

The only write is the local output report file.

## Known Limits

- Matching depends on Telegram usernames. Students without usernames cannot be matched.
- If the table username is stale, the match will be missed.
- The Telegram account must have access to the mentor chats.
- `ambiguous` rows must be checked manually before writing `chatId` to the table.
- If the naming convention changes, update `titlePrefix` / `titleContains` options or the default matching logic.
