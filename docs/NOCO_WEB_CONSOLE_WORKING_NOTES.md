# Noco Web Console Working Notes

These notes are for web-console work that reads or patches Noco records directly.
They come from the Telegram/TDLib admin work on 2026-07-05.

## Mistakes To Avoid

- Do not infer Telegram readiness from a client row alone. The source record is a
  `platform_accounts` row with `telegram_session_status === active` and a real
  `telegram_tdlib_db_path`.
- Do not assume the label is the platform. Telegram may be stored on a row whose
  `account_label` is `phone_en`, while the linked/normalized platform can still
  be usable for Telegram.
- Do not create a new Telegram/Noco concept when the existing row can represent
  it. Use the existing account `Id`, client relation, phone fields, and TDLib DB
  path.
- Do not patch Noco from a guess after a UI symptom. First fetch the exact row,
  inspect its `Id`, linked client, platform/label, phone, session status, and DB
  path.
- Do not rely on sandboxed one-off scripts for live validation unless the command
  has network approval. A local Express API call can work while a direct script
  fails because the script itself cannot reach Noco/Dolphin from the sandbox.
- Do not treat old Google/sheet data as live truth. For web-console behavior,
  Noco records and native relations are authoritative.

## Safe Workflow

1. Identify the user-facing action and the exact Noco table it depends on.
2. Fetch the current row through the repository/API path used by the feature.
3. Confirm canonical IDs before writing:
   - client `Id`
   - `platform_accounts.Id`
   - linked client relation
   - linked platform or normalized `platform`
4. For Telegram sessions, require:
   - existing account row
   - `telegram_session_status`
   - `telegram_tdlib_db_path`
   - local DB path exists when the feature needs a live sender
5. Write only the minimum Noco fields needed for the feature.
6. Re-read through the same API path the UI uses.
7. Only then run a live action such as sending a Telegram message.

## Current Telegram Fields

On `platform_accounts`:

- `phone` is preferred; `phone_en`/`foreign_number` may be fallback inputs.
- `telegram_session_status`: `active`, `expired`, `needs_reauth`, etc.
- `telegram_tdlib_db_path`: TDLib persistence directory.
- `telegram_last_active`: updated when status becomes active.
- `telegram_event_log`: append-only operational notes from the web console.

## Validation Commands

Use the existing web API when possible because it exercises the same repository
mapping as the UI:

```powershell
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$body = @{ email = '<admin-email>'; password = '<admin-password>' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:4300/api/auth/login -Method Post -ContentType 'application/json' -Body $body -WebSession $session
Invoke-RestMethod http://127.0.0.1:4300/api/admin/telegram/senders -WebSession $session
```

If a direct Node script must read Noco/Dolphin, run it with explicit network
approval in Codex. Otherwise a network failure can look like a feature bug.

## Commit Hygiene

- Commit code and docs.
- Do not commit local TDLib session DBs, uploaded Telegram files, local logs, or
  generated one-off validation artifacts.
- Keep generated Noco reports under `logs/` out of focused feature commits unless
  the report is the deliverable.
