# Telegram Admin Dialog Backend

This is the implementation guide for the web console's TDLib-backed Telegram
features. Read it before changing account discovery, proxy selection, TDLib
session reuse, dialog collection, history, or sending.

The central compatibility rule is simple: admin dialog collection extends the
deployed single-account browsing and admin-sending workflow. It does not own a
second TDLib runtime or a different proxy, database, or authorization policy.

## Transport boundaries

There are two independent Telegram transports in this repository:

| Feature | Main endpoint | Transport |
| --- | --- | --- |
| Client Telegram workspace | `/api/telegram/*` | A student's TDLib account |
| Admin account sender | `/api/admin/telegram/send` | A selected student's TDLib account |
| Admin dialog table | `/api/admin/telegram/dialogs/scan` plus existing read endpoints | The same TDLib adapter |
| Linked common-chat sender | `/api/admin/clients/:clientId/telegram/send` | Telegram Bot API |

A successful Bot API operation says nothing about a student's TDLib database,
authorization, or Dolphin proxy. Conversely, the admin dialog feature must not
change the Bot API sender.

The relevant code boundaries are:

- Noco normalization and sender discovery:
  `src/features/web-console/backend/repository.ts`
- existing account, database-path, and proxy resolution plus the scan queue:
  `src/features/web-console/backend/telegram-service.ts`
- the shared TDLib client cache, login, snapshots, history, sending, and the
  feature-specific exhaustive scan:
  `src/integrations/telegram/tdlib-client.ts`
- HTTP authorization and scan cancellation:
  `src/features/web-console/backend/app.ts`
- progressive orchestration and lazy history:
  `src/features/web-console/frontend/src/App.vue`
- Render-to-local service transport and access policy:
  `src/features/web-console/backend/telegram-gateway.ts`

## Render-owned TDLib gateway

TDLib storage is environment-local. Development must not mount, merge, or copy
the six production session databases while Render is using them. When the local
backend needs production Telegram data, it delegates the existing
`TelegramService` contract to Render over the internal gateway:

```text
local browser -> local backend -> Render gateway -> existing Render TelegramService -> TDLib disk
```

Only Telegram service calls cross this boundary. Login, Noco-backed dashboard
routes, Dolphin UI actions, Bot API routes, and all other application behavior
remain local. The gateway does not create another TDLib adapter or alter proxy,
database-path, authorization, read-state, or send-delivery behavior.

The Render service exposes:

- `GET /api/internal/telegram-gateway/health`;
- `POST /api/internal/telegram-gateway/rpc`.

Both require `Authorization: Bearer <WEB_CONSOLE_TDLIB_GATEWAY_TOKEN>`. This is a
dedicated service credential and must never reuse `WEB_CONSOLE_BOT_API_TOKEN`.
The token stays in backend environments and is never sent to the browser.

RPC requests use an explicit operation and account reference:

```json
{
  "operation": "dialogs",
  "clientId": 102,
  "accountId": 473,
  "input": { "list": "main", "limit": 50 }
}
```

Supported operations are `list_admin_senders`, `status`, `folders`, `dialogs`,
`messages`, `scan_admin_dialogs`, `send`, `send_to_username`,
`rename_contact`, `connect`, `reauth`, and `disconnect`. The server validates
the operation and positive account identifiers before invoking the existing
service. The service then resolves the account through the client's linked
Telegram platform accounts, so mismatched, missing, and non-Telegram accounts
are rejected without a static gateway allowlist. Newly connected accounts are
eligible automatically.

Gateway responses strip production database paths, local file paths, event
logs, phone numbers, proxies, and passwords. Safe Telegram error codes are
preserved; unknown Render failures become `telegram_gateway_operation_failed`.
No gateway call is automatically retried. This is especially important for
sends and account mutations, whose result could otherwise be duplicated or
ambiguous.

### Render configuration

```dotenv
WEB_CONSOLE_TDLIB_GATEWAY_TOKEN=<random value of at least 32 bytes>
WEB_CONSOLE_TDLIB_GATEWAY_ALLOW_WRITES=true
WEB_CONSOLE_TDLIB_GATEWAY_ALLOW_AUTH_MUTATIONS=true
WEB_CONSOLE_TDLIB_GATEWAY_ALLOW_DISCONNECT=true
```

Do not set `WEB_CONSOLE_TELEGRAM_MODE=remote` on Render. Render must construct
the local Telegram service that owns its persistent disk. An absent, short, or
malformed token disables the internal gateway without affecting the ordinary
web console. No account-reference environment variable is required: the
gateway scope is always `all_telegram_accounts` and account ownership comes
from Noco through the existing Telegram service.

### Local backend configuration

```dotenv
WEB_CONSOLE_TELEGRAM_MODE=remote
WEB_CONSOLE_TDLIB_GATEWAY_URL=https://<render-web-console-service>
WEB_CONSOLE_TDLIB_GATEWAY_TOKEN=<same dedicated token>
WEB_CONSOLE_TDLIB_GATEWAY_TIMEOUT_MS=180000
```

Remote mode requires an HTTPS URL and a token of at least 32 bytes. Partial or
invalid remote configuration stops backend startup; it never falls back to
local TDLib. Plain HTTP is accepted only for localhost integration tests.

The capability flags are independent. `ALLOW_WRITES` controls sends and contact
renames. `ALLOW_AUTH_MUTATIONS` controls connect and reauth. Disconnect has its
own flag because the deployed implementation removes that account's TDLib
storage. With all three flags enabled, the gateway bearer token is a master
credential for every current and future Telegram account; never expose it to a
browser or reuse it for another service.

### Safe rollout

1. Deploy the gateway code while Render remains in local Telegram mode.
2. Configure the dedicated token and capability flags; do not configure an
   account list.
3. Verify health reports `accountScope: all_telegram_accounts` and sender
   discovery returns every active account with usable Render storage.
4. Verify main/archive dialogs, one lazy history request, exhaustive scan, and
   a final dialog request for each sender.
5. Confirm local `storage/tdlib` timestamps did not change.
6. Keep automated verification read-only even when mutation capabilities are
   enabled. Never use disconnect as a status reset.

Gateway logs contain only request ID, operation, account reference, duration,
and outcome. They must never include tokens, message content, usernames,
credentials, attachments, proxy data, or storage paths.

## Account discovery and compatibility behavior

`GET /api/admin/telegram/senders` is the account catalog for the card. It uses
`listActiveTelegramSenders`, which selects platform-account rows linked to a
Telegram platform, with stored session status `active` and a stored TDLib path.
The service additionally checks that either the stored path or the existing
canonical fallback path exists. Future accounts therefore appear without a
gateway configuration change once connection has created usable Render TDLib
storage.

The linked platform decides whether a row is Telegram. `account_label` is only
a display label and may contain a legacy value such as `phone_en`; do not reject
an otherwise canonical linked Telegram row because of that label.

The feature deliberately preserves these deployed service rules:

- `getAccount` and `baseRef` choose the same account and database path used by
  client dialogs, history, and sending;
- the existing Dolphin resolver walks the client's bound profiles and returns
  the first usable SOCKS5 proxy;
- all TDLib operations use the same adapter instance and its per-account
  `clients`, authorization-state, proxy-applied, and login-promise caches;
- `getClient` and `loginWithSuppliedValues` remain the only client/login path;
- cancellation of an admin scan removes scan work and listeners but does not
  close, replace, or disconnect the cached client.

The current resolver is not market-specific and the current cache is not a new
session manager. Changing either is a separate compatibility-sensitive task
that requires client browsing and sending regression tests. Do not fold such a
refactor into admin dialog work.

The scan service itself does not patch Noco status or event fields. Existing
status/connect/disconnect endpoints retain their deployed behavior.

## Progressive dialog flow

The browser owns multi-account orchestration:

1. Fetch `/api/admin/telegram/senders`.
2. Filter the catalog by market and stack. The date filter does not change the
   account denominator.
3. For one account at a time, call the deployed dialog endpoint sequentially
   for `list=main&limit=50&privateOnly=true` and
   `list=archive&limit=50&privateOnly=true`.
4. Retain only rows explicitly marked `isPrivate: true`, filter each successful
   list by `lastMessageAt`, and render it immediately;
   finalize the account's snapshot coverage after both attempts settle.
5. Do not scan automatically. When the administrator chooses **Load all
   dialogs**, call the exhaustive scan endpoint for one snapshot-successful
   account at a time.
6. Merge results by client, account, and chat ID and sort newest activity first.
7. Fetch `/api/telegram/messages` only when an admin expands a row.

Main and archive are sequential within one account because both calls use the
same deployed TDLib client/login state. Accounts are also serialized because
concurrent cold TDLib restoration proved unreliable on the Render service.
Rows still render progressively as each account settles.

A two-list snapshot counts as initially loaded even when no dialogs match the
date. One successful snapshot list is partial and its rows remain visible.
Exhaustive completion is reported separately.

Apply, Reset, card collapse, logout, and component unmount abort obsolete
browser requests. Request generations also prevent late results from replacing
newer filters. History has independent controllers and generations, so a late
history response cannot reopen a collapsed or removed row.

## Snapshot behavior

The deployed `/api/telegram/dialogs` implementation is intentionally small:

- call `getChats` for the selected list and limit;
- call `getChat` for each returned ID;
- optionally call `getUser` for private-chat username display;
- expose `lastMessageAt` from `chat.last_message.date`.

When `privateOnly=true`, the service filters the hydrated result to TDLib
`chatTypePrivate`. Calls that omit the flag retain the existing mixed chat list,
which keeps the client Telegram workspace compatible. The admin frontend also
fails closed by rejecting rows not explicitly marked `isPrivate: true`.

It does not call `loadChats`, history, `openChat`, or `viewMessages`. A snapshot
is fast initial evidence, not proof that the list is complete.

## Exhaustive scan behavior

`GET /api/admin/telegram/dialogs/scan` accepts:

- `targetClientId` (required positive integer);
- `platformAccountId` (required positive integer);
- `days` (greater than zero and at most 3650).

Admin authorization is required. Invalid input and missing authorization are
non-2xx responses. Expected per-account TDLib problems return HTTP 200 with a
structured failed or partial account result, allowing other accounts to keep
loading.

The adapter operation obtains the client through the deployed `getClient` and
`loginWithSuppliedValues` functions. It then:

- attaches one temporary listener for `updateNewChat`, `updateChatPosition`,
  and `updateChatLastMessage`;
- scans main and archive independently in batches of 100;
- invokes `loadChats` repeatedly and treats TDLib code 404 as end of list;
- re-reads `getChats` after batches and combines those IDs with update-derived
  IDs;
- fails a list as stalled after two successful batches add no IDs;
- deduplicates main/archive IDs with main taking display precedence;
- enforces a combined 5,000-chat limit;
- hydrates lightweight metadata with `getChat` at concurrency eight;
- filters on `last_message.date` without loading message history;
- returns only hydrated `chatTypePrivate` rows (including bots) and excludes
  groups, supergroups, channels, secret chats, and unknown chat types;
- removes the temporary listener on success, partial completion, failure,
  timeout, and cancellation.

TDLib does not expose a private-only main/archive list. The scan therefore sees
mixed chat IDs and performs one lightweight `getChat` hydration to identify
their type. It never loads group message history or changes read state.

The default per-account deadline is 60 seconds and is configurable with:

```env
TELEGRAM_TDLIB_DIALOG_SCAN_TIMEOUT_MS=60000
```

The backend scan semaphore permits three exhaustive scans globally within the
server process, including overlapping browser tabs. Snapshot, history, and send
operations do not enter that queue. The browser is deliberately stricter: it
serializes account snapshots and scans, and gives each snapshot call a
75-second client-side bound.

Cancellation is cooperative: it prevents more scan batches and releases the
temporary listener. It intentionally does not close the shared TDLib client or
cancel unrelated history/send activity.

## Response and coverage

The response has lightweight rows and exactly one account result:

```json
{
  "rows": [
    {
      "clientId": 102,
      "clientName": "Example",
      "accountId": 473,
      "accountLabel": "telegram_en",
      "market": "en",
      "stack": "PYTHON",
      "chatId": "123",
      "dialogTitle": "Example dialog",
      "lastMessageAt": "2026-07-19T12:00:00.000Z"
    }
  ],
  "accountResult": {
    "clientId": 102,
    "accountId": 473,
    "outcome": "complete",
    "stage": "complete",
    "durationMs": 1234,
    "discoveredCount": 512,
    "matchedCount": 60,
    "lists": {
      "main": { "complete": true, "discovered": 500 },
      "archive": { "complete": true, "discovered": 12 }
    }
  }
}
```

`complete` requires both main and archive to reach TDLib end-of-list and all
selected metadata to hydrate. Timeout, cancellation, stall, limit, or hydration
error is partial when the adapter can preserve results. A failure before useful
scan output is failed. A complete scan with zero date matches is still complete.

The frontend derives:

- `Accounts loaded: X/N` from successful two-list snapshots;
- `Full scans: Y/N` from explicitly requested exhaustive results;
- partial, failed, and not-processed counts from per-account state.

Snapshot rows survive a partial or failed exhaustive scan. A transport failure
keeps the last successful table marked stale, and each account can be retried.

Diagnostics expose only account/client IDs and labels, stage, allowlisted code
and message, list completeness, counts, and duration. They must never expose
phone numbers, database paths, proxy endpoints or credentials, passwords,
message bodies, or stack traces.

## Read/write guarantees

Initial snapshots and exhaustive scans never call:

- `getChatHistory`;
- `openChat`;
- `viewMessages`;
- send or contact-update operations.

Expanded row history uses the deployed `/api/telegram/messages` route. It calls
`getChatHistory` but does not mark messages read. Actual sending keeps its
deployed, intentional best-effort `viewMessages(force_read: true)` behavior and
waits for TDLib delivery success. The admin-dialog feature never sends.

## Safe errors and troubleshooting

Important allowlisted codes include:

- `telegram_auth_code_required`: the stored session reached TDLib's code prompt;
- `telegram_password_required`: the stored session reached the cloud-password
  prompt;
- `telegram_authorization_failed`: authorization restoration failed for another
  reason;
- `telegram_proxy_unavailable`: the existing Dolphin proxy lookup failed;
- `telegram_tdlib_database_locked`: another process has the account database;
- `telegram_dialog_scan_timeout`: the scan exceeded its deadline;
- `telegram_dialog_scan_stalled`: TDLib accepted batches but exposed no new IDs;
- `telegram_dialog_chat_limit`: the 5,000-chat guard was reached;
- `telegram_dialog_hydration_failed`: one or more chat metadata reads failed.

Interpret the first failing stage before changing shared TDLib code. If deployed
snapshot/history and the new scan fail with the same authorization, proxy, or
database condition, it is an account condition. If deployed browsing succeeds
but the scan remains incomplete, it is a scan feature defect.

## Verification

Deterministic gates:

```powershell
npm run web:test
npm run web:e2e
npm run web:build
npm run typecheck
git diff --check
```

The opt-in live test targets an already-running local application. Never launch
a second backend against the same TDLib storage.

```powershell
npm run web:e2e:telegram-live-readonly
```

Optional environment controls are:

- `WEB_CONSOLE_LIVE_BASE_URL` (default `http://127.0.0.1:4301`);
- `WEB_CONSOLE_LIVE_ACCOUNT_REFS` (comma-separated `clientId:accountId`);
- `WEB_CONSOLE_LIVE_CONCURRENCY` (one to three);
- `WEB_CONSOLE_LIVE_SCAN_ONLY=true` for a focused scan diagnostic.

The test records only safe account references, counts, stages, codes, and list
completeness in `tmp/web-console-live-telegram/summary.json`. It never sends,
opens a chat, calls `viewMessages`, or records titles, message bodies, phones,
paths, or proxy data. A full run checks main/archive snapshots, at most one
history count, exhaustive scan, and post-scan snapshot usability.

Completion requires an explicit result for every selected account and no case
where both deployed snapshots work but the new scan fails or remains partial.
