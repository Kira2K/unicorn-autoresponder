# Local LinkedIn web console

The admin-only `LinkedIn` tab runs account checks and authorization on the same
Windows machine as Dolphin Anty. Start both Dolphin and the console locally:

```powershell
npm run web:dev
```

The backend must have working NocoDB, Dolphin, and `UNIPILE_API_KEY`
configuration. Render and MCP are not part of this flow.

## Actions

- `Check settings` performs a dry-run without restarting Dolphin.
- `Connect`, `Reconnect`, and `Verify owner` use the normal apply flow.
- `Refresh session` forces Dolphin restart and session collection.
- A missing or incorrect LinkedIn profile URL can be edited in the account row.
  The backend accepts only absolute `linkedin.com/in/...` URLs, canonicalizes
  them, and stores the result in the existing Noco `url` field.

The En Dolphin profile remains relation-driven and is detected for both `En`
and `en` locale values. Credentials, proxy settings, and Unipile IDs cannot be
entered manually in the web console.

Only one LinkedIn operation runs at a time. The browser receives a run ID and
polls its safe status once per second. A short run summary is stored in the
separate NocoDB table `linkedin_auth_runs`: one create at start and one update
at completion. Detailed stages remain only in `logs/linkedin-auth/`. A run left
open by a backend restart is shown as `Interrupted`.

## Statuses and errors

The tab shows neutral, running, connected, attention, and error states. Safe
error codes are grouped as Settings, Proxy, Dolphin, LinkedIn session, Unipile,
Checkpoint, Owner mismatch, or Internal error. Checkpoints instruct the admin
to restore the LinkedIn session in Dolphin before retrying.

The API and UI never expose `li_at`, the exact user-agent, cookies, API keys, or
proxy host, port, username, and password.

## API

- `GET /api/admin/linkedin/accounts`
- `GET /api/admin/linkedin/runs`
- `POST /api/admin/linkedin/accounts/:platformAccountId/runs`
- `GET /api/admin/linkedin/runs/:runId`

All routes require an admin web-console session.

## Tests

LinkedIn checks are isolated from the legacy web-console and support-bot tests:

```powershell
npm run linkedin:web:test
npm run linkedin:web:e2e
npm run linkedin:web:check
```

The last command also runs the LinkedIn authorization tests, typecheck, and the
web build. All web tests use mock data and never start a real account connection.
