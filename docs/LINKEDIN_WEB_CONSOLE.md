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

## Comment replies

The `Comment replies` column starts a 48-hour monitor for the two latest posts.
It shows the current stage, next check, remaining time, counters, tracked post links,
safe errors, and a Resume action for an uncertain write.

Before the first local run:

```powershell
npm run noco:linkedin-comment-monitor-schema:dry-run
npm run noco:linkedin-comment-monitor-schema:apply
```

Generation uses `OPENAI_LINKEDIN_COMMENT_API_KEY` and
`OPENAI_LINKEDIN_COMMENT_MODEL`, falling back to the existing LinkedIn Profile
variables. Detailed safe events are written to `logs/linkedin-comments/*.jsonl`.

When a reply is needed, the backend reads the account's current Headline and About through
Unipile and caches them in `linkedin_comment_monitor_jobs` for 24 hours. Failed or empty reads
are retried after 30 minutes and do not stop replies. The values are never exposed by the admin
API or written to JSONL logs.

The monitor ignores emoji-only and one-word comments, AI-authorship questions or accusations,
explicit provocations, direct insults, and comments clearly unrelated to the post or thread.
Unrelated trivia, abrupt topic switches, and unrelated advertising use the safe reason code
`irrelevant_to_context`. Constructive criticism, relevant questions, and uncertain relevance
default to a short English reply. Ignored items keep only a safe reason code and are never passed
to the publisher.

Comment monitor routes:

- `GET /api/admin/linkedin/comment-monitors`
- `GET /api/admin/linkedin/comment-monitors/:jobId`
- `PUT /api/admin/linkedin/accounts/:id/comment-monitor`
- `POST /api/admin/linkedin/comment-monitors/:jobId/resume`

## Profile Filler

Profile Filler builds a read-only preview before `Apply`. During execution each
step is shown as waiting, writing, accepted, verifying, completed, or failed.
The current checklist is stored in `linkedin_profile_jobs.result_json`, so a
backend restart keeps the last known completed and pending steps.
Uploaded JSON is first normalized into schema V1. Known aliases, single objects,
date variants, and named Skill objects are converted deterministically. Each
issue includes a path, correction hint, and example. The normalized document is
editable in Preview and can be downloaded. Any edit disables `Apply` until a
fresh read-only preview creates a new plan hash.

MCP v2 accepts Job Title, Company, Location, and Skills by name, so Preview does
not query their parameter catalog. Experience `employment_type` is temporarily
excluded: live Unipile v2 rejects it even with an ID returned by its own catalog.
The analyzer removes that field with a visible warning. Open to Work
`employment_types` remains supported. Preview resolves the Job Title and
Location IDs required for Open to Work. Parameter searches are admin-only,
read-only, and their logs exclude searched values and returned IDs.

The canonical generator contract and supported field enums are documented in
[LinkedIn Profile JSON v1](LINKEDIN_PROFILE_JSON.md) and its linked JSON Schema.
Preview normalizes aliases and dates, removes unsupported fields with visible
warnings, resolves every mandatory LinkedIn ID from the current account catalog,
then validates the final payload against the MCP-confirmed Unipile v2 contract.
IDs supplied by uploaded JSON are ignored and never forwarded.

Writes run sequentially. Each step gets exactly one read-only check. A write
accepted but not yet visible becomes `verification_delayed`, and later writes
continue. At the end, exactly one shared read-only check runs for the complete
plan after a randomized 55-65 second pause. Immediately before every write,
Profile Filler reads the target field again. Existing Experience and Education
entries are edited by provider ID,
already matching fields are skipped, and Skills payloads contain only values
still missing at write time. Multiple matching entries block the write instead
of selecting one and creating or editing another duplicate. LinkedIn dates
returned as `MM/DD/YYYY` are normalized before matching. Only an explicitly rejected write
stops execution. Unresolved checks finish in the warning state
`pending_verification`.
A fresh preview re-reads LinkedIn and contains only changes still required.
The UI shows overall elapsed time, status age, and the countdown to each planned
write or check. A verified step replaces its timer with a green check.

Safe diagnostic events are written to `logs/linkedin-profile/*.jsonl`. Analysis,
preview, Apply, every wait/write/read-back, progress persistence, final read-only
verification, rollback, and completion are logged. Events contain job/step IDs,
section, attempt, outcome, duration, payload field names, and safe error code.
Unipile failures also keep only the HTTP status, request ID, and sanitized schema
diagnostic. Profile values, response messages, credentials, cookies, API keys,
and proxy data are excluded.

Profile Filler routes:

- `POST /api/admin/linkedin/profile-analysis`
- `GET /api/admin/linkedin/profile-jobs`
- `GET /api/admin/linkedin/profile-jobs/:jobId`
- `POST /api/admin/linkedin/accounts/:id/profile-previews`
- `GET /api/admin/linkedin/accounts/:id/profile-parameters`
- `POST /api/admin/linkedin/profile-jobs/:jobId/apply`
- `POST /api/admin/linkedin/profile-jobs/:jobId/rollback`

## Tests

LinkedIn checks are isolated from the legacy web-console and support-bot tests:

```powershell
npm run linkedin:web:test
npm run linkedin:web:e2e
npm run linkedin:web:check
```

The last command also runs the LinkedIn authorization tests, typecheck, and the
web build. All web tests use mock data and never start a real account connection.
