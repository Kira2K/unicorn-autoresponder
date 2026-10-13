# Octo Console pilot

Octo runs inside the existing Console backend. Dolphin keeps its existing workflows;
`browser = 'octo'` bindings never reach Dolphin consumers. No additional Render service
is required. Production access lasts 120 seconds from verified publication.

## Runtime and storage

- `service.mts`: authenticated client ownership, locale rules, idempotent provisioning
  and grants. Exactly two allowed client IDs are configured; their emails must match
  `alex.octo@example.com` and `bob.octo@example.com`.
- `provision.mts`: private profile creation, optional En proxy reservation and naming.
  Ru uses the existing no-proxy rule. Unknown creation outcomes are reconciled using a
  persisted operation marker; they never cause blind duplicate creation.
- `grant-workflow.mts`: protect, anonymize, publish, hide, then remove protection only
  after ordinary closure and complete cloud event evidence. There is no stop method
  in its cloud adapter contract.
- `runtime.mts`: independent per-profile work, one PostgreSQL advisory-lock leader,
  durable Action Log cursor and recovery. The separate pool is a database connection
  pool, not a separate service/process. Use a direct/session-pinned PostgreSQL connection,
  not a transaction-pooling proxy, for the session advisory lock.
- `postgres-store.mts`: short transactions, revisions and unique constraints.
  `noco.octo_profiles.state.password` intentionally contains the five-digit plaintext
  string. It is retained after protection is removed. Common inventory exposes only
  `browser`, never private state/passwords. Secrets are returned only for the owner's
  currently published grant, with `Cache-Control: no-store`.

The worker keeps hiding expired profiles even while the event stream is disconnected.
Clearing protection waits for replay, a matching post-hide event, ordinary closure (or
proof of no launch), cloud closed state and an unchanged, fully drained event checkpoint.
Any observed force-stop prevents clearing. Octo does not provide an atomic operation
combining event history, status and password clearing: a concurrent external force-stop
after the final check is outside this guarantee. Do not force-stop managed grants.

With insufficient history, a profile stays private and protected. Backend downtime delays
operations; restart retains original deadlines. Keep the Render backend awake. Disabling
`OCTO_ENABLED` while retaining folder/client configuration blocks new grants and allows
existing cleanup to finish. Do not remove configuration before grants have drained.

## Explicit setup

No startup migration or seeding runs automatically. Remote writes require explicit
operator authorization under repository `AGENTS.md`.

1. Build the existing frontend: `npm run web:build`.
2. Inspect `sql/001-octo.up.sql`; run `npm run octo:console:migrate -- --apply` only after
   approval. It backs up affected existing records locally, verifies preservation,
   checks rerun compatibility and commits atomically. Without `--apply` it still executes
   DDL inside a rolled-back transaction; that also needs authorization on a remote DB.
3. `npm run octo:console:seed` is a genuinely read-only preview. With approved `--apply`
   it creates only marked, paused Alex/Bob clients, using existing FRONTEND and Ru
   records, synthetic chat IDs and no platform accounts. Collisions fail; reruns reuse
   only exact fixtures. No messages are sent.
4. Set `OCTO_ENABLED=1`, `OCTO_ALLOWED_CLIENT_IDS=<returned IDs>`, `OCTO_API_TOKEN`,
   `OCTO_HOME_FOLDER_UUID`, `OCTO_GUEST_FOLDER_UUID`, `OCTO_GUEST_EMAIL` and
   `OCTO_GUEST_PASSWORD` on the existing Console backend. All credentials remain server-side
   except Guest credentials and the individual profile password intentionally shown to
   authorized clients during their grant. `APP_DB=postgres` is required.
5. `npm run octo:console:preflight` checks the token, Guest folder-only rights, folders
   and proxy pool through cloud GET requests. It never accesses the local desktop API.

For the approved local live test, put the nonsecret pilot IDs/folder configuration and
`OCTO_E2E_LIVE=1` in ignored `.env.octo-pilot`; keep credentials in existing `.env`.
Do not override the 120-second production TTL. UI creates the two new Ru profiles.
Existing experiments are neither adopted nor modified.

## Validation

- `npm run octo:console:test`: API authorization, ownership, contracts, persistence mocks,
  runtime leadership/restarts, failures, UI API helper and Dolphin filtering.
- `npm run octo:test`: regressions of the reused experimental cloud adapter/listener.
- `npm run octo:console:db-test`: disposable LOCAL Docker PostgreSQL integration, including
  migration twice, rollback, concurrent reservations, CAS and loss of leader connection.
  It never reads application DB environment; unavailable Docker is reported as skipped.
- `npm run octo:console:e2e:mock`: real Console form and UI, separate Alex/Bob sessions,
  mocked Octo/DB, two cycles with 45-second leases. This does not prove desktop behavior.
- `npm run octo:console:e2e:live`: existing Console auth and real SQL/cloud Octo modules,
  with unrelated automation mocked. Requires an authenticated local Guest desktop.
  Only this test driver uses `localhost:58888`, for two newly created, verified fixture
  UUIDs. It checks the other client's actual password is rejected, opens both windows,
  checks Wikipedia identity and a storage marker, waits 120 seconds, checks hidden but
  running/protected profiles, closes normally and repeats with unchanged passwords.

The live runner refuses existing fixture bindings by default. To resume an interrupted test,
inspect the exact new bindings and cloud metadata, then explicitly allow their internal IDs
via `OCTO_E2E_RESUME_PROFILE_IDS`. Resume requires the same pilot owners, operation markers,
canonical private metadata and closed profiles. Each profile must either have no previous
grant and remain protected, or have a fully completed, expired grant and cleared protection.
Unfinished grants and old experimental profiles are rejected. No grant history is reset.
Do not create additional profiles to bypass a failed run.
Artifacts go to ignored `tmp/octo-console*`; screenshots mask credentials, reports never
contain passwords or provider errors. A mock pass is marked `live: false`.

Create a PR only after the full live acceptance passes. No deployment or Git publication
is part of the setup scripts.
