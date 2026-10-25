# Octo Console

Octo runs inside the existing Console backend. Dolphin keeps its existing workflows;
`browser = 'octo'` bindings never reach Dolphin consumers. No additional Render service
is required. Production access lasts 120 seconds from verified publication.

## Runtime and storage

The student entry flow is documented in
[`../linkedin-automation/console-intake/README.md`](../linkedin-automation/console-intake/README.md).
New Console setup uses structured manual proxy fields for an existing LinkedIn
account, or a durable direct/no-proxy setup when preparing a new account. These
explicit sources skip NodeMaven and proxy scoring. Legacy setup records remain
readable; the SQL Console stops undispatched retired checker jobs rather than
restarting them. Existing in-flight provisioning/grant cleanup is preserved.

Password-free owner reopening is a separate acceptance requirement. The cloud
password flag does not prove saved archive readability. See
[`archive-acceptance/README.md`](archive-acceptance/README.md) for the independent
owner-PC check and three-cycle Console release gate. The old cloud comparison and
local fixture-console runtimes have been removed; existing private reports remain.

An opt-in local Octo bridge is available in [`../../../octo-bridge`](../../../octo-bridge/README.md).
Set `OCTO_PASSWORD_CLEANUP=bridge` plus its private identity/secret configuration
to queue local password removal in the same backend process. The bridge makes
outbound requests and calls only the local Octo password API. Existing 120-second
publication/hiding and event-history checks remain; no password is changed on
profile launch. There is no cloud-clear fallback in bridge mode. Its durable
one-shot authorization and local acknowledgement are stored in the existing
private grant JSON, without a database migration. Pending bridge operations also
remain bridge operations after a restart/configuration change. The default cloud
adapter is unchanged; enabling bridge mode and deployment require a separate
rollout after fresh second-PC archive acceptance.
The bridge README describes the Render/PC setup. The PC needs no local backend.

- `service.mts`: authenticated client ownership, locale rules, idempotent provisioning
  and grants. `OCTO_ACCESS_SCOPE=all` enables all authenticated client accounts;
  `allowlist` keeps the initial scoped pilot. Every profile and operation remains owner-bound.
- `provision.mts`: private profile creation, optional En proxy reservation and naming.
  Ru uses the existing no-proxy rule. Unknown creation outcomes are reconciled using a
  persisted operation marker; they never cause blind duplicate creation.
- `proxy-input.mts` / `proxy-workflow.mts`: client-owned proxy form, saved Octo proxy
  creation and verified attachment. HTTP(S), SOCKS4/5 and optional IP-change URL are
  supported. Credentials are accepted only on write, removed from operation state after
  attachment and never returned in status. The URL is stored, not called by Console.
  Changes require a closed private profile with no active grant. Lost acknowledgements
  are reconciled by the operation marker; ambiguous writes stay blocked. Replacing a
  connection creates a separate saved proxy; the old proxy is not deleted automatically.
- `grant-workflow.mts`: protect, anonymize, publish, hide, then remove protection only
  after ordinary closure and complete cloud event evidence. There is no stop method
  in its cloud adapter contract.
- `runtime.mts`: independent per-profile work, one PostgreSQL advisory-lock leader,
  durable Action Log cursor and recovery. The separate pool is a database connection
  pool, not a separate service/process. Use a direct/session-pinned PostgreSQL connection,
  not a transaction-pooling proxy, for the session advisory lock.
- `postgres-store.mts`: short transactions, revisions and unique constraints.
  `noco.octo_clients` stores one unique five-digit plaintext password per client and
  the private NodeMaven key/setup operation. Every owned profile has that same password,
  enforced by a composite foreign key. Leading zeros and existing passwords survive migration
  and protection removal. Common inventory exposes only
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

### Two Consoles with one Octo worker

Use the existing active backend as the only Octo worker. On that backend set
`OCTO_CONTROL_SECRET` to a new, separate random server secret (at least 32 non-whitespace
characters); leave `OCTO_CONTROL_URL` empty. The configured Console entrypoint mounts
`POST /internal/octo-control/v1/ready` and `/grants` before its static fallback.

On the secondary/local Console set the same secret and `OCTO_CONTROL_URL` to the worker's
HTTPS **origin** (no path, credentials, query or fragment). Both use the same SQL database
and Octo folder configuration. This mode does not start a second Octo worker or listener;
other configured feature workers retain their own existing enablement. The local desktop
bridge keeps its current backend configuration and does not move to the secondary Console.
No migration is needed for the control transport. Without these new variables the old
single-backend behavior is unchanged.

Only acquire is delegated. Both student and task-scoped contractor routes receive the
same injected service; the active backend calls the existing acquire implementation.
Status, grant polling, provisioning/proxy intents and task capture retain shared SQL
storage. Readiness checks compare the client/profile/UUID/operation and folder identity,
then require current worker leadership and an event-history checkpoint. Authentication
uses a dedicated bearer secret, never session cookies or browser-provided client IDs.
Neither endpoint returns guest/profile passwords. Existing authenticated grant polling
is still the only credential delivery path.

Each acquire issues at most one mutation request. A lost response is reconciled against
the same SQL binding/grant; unresolved results return `octo_control_uncertain` with no
automatic resend or local-write fallback. Redirects are rejected. Keep the worker awake.
An already issued, unexpired access can still be reused from SQL while the worker is
unavailable; the shared acquisition checks preserve its original deadline and ownership.
To roll out: deploy these routes disabled, configure the worker secret, verify readiness,
then enable the local URL/secret and restart only the local Console. A 200 HTML page from
the worker is not readiness: it means the route was not deployed. Never remove listener
checks to work around an unavailable worker. Deployment remains an explicit operator action.

For the existing local Octo Console configuration, run `npm run web:dev`, or
`npm run web:backend` and `npm run web:frontend` in separate terminals.
Both backend commands (`web:backend` and the watched `web:backend:dev`) load
`.env`, `.env.octo-pilot` (enablement and folders), then `.env.octo-onboarding`
(all-client scope and checker URL), using native Node. Missing files are optional;
explicit process environment values take precedence. Without Octo configuration,
the Octo status endpoint returns 403 and the frontend hides its card. Pilot-only
scope excludes OctoGuide (client 261).
Stop the previous backend before replacing it with this command; keep the existing
frontend running. This is the normal backend against the configured database,
including its normal workers, not the disposable archive acceptance test. It does
not repair encrypted archives. Production `web:start` and Dolphin logic are unchanged.

No startup migration or seeding runs automatically. Remote writes require explicit
operator authorization under repository `AGENTS.md`.

Before starting the deletion-aware backend, explicitly apply the permission-only migration:
`node --env-file=.env src/features/octo-access/migrate-deletion.mts --apply`.
Without `--apply`, the same grant validation rolls back. Migration 003 grants DELETE on
the common profile binding, private profile state and event inbox; it creates no table
and copies no profile data. Startup verifies these permissions and fails closed if missing.

## Deleted profiles and proxies

`profiles.trashed` / `profiles.deleted` events atomically mark the managed profile for
cleanup and invalidate stale profile/onboarding writes. The UI hides credentials and
blocks further actions. `deletion-workflow.mts` confirms absence with one cloud profile
GET (`404` plus `not_found`); a restored profile is retained. There is no startup scan or
periodic cloud presence polling. Each verification/cleanup stage has at most two attempts,
30 seconds apart; persisted counters survive restarts. Other grants keep their deadlines.

Cleanup waits for in-flight work, finds saved/pending proxies by UUID or the exact
creation operation marker, and deletes only proxies unreferenced in DB and unused in
Octo. Ambiguous creation with no discovered proxy remains blocked instead of losing its
marker. Unknown DELETE outcomes are reconciled before another write. Shared proxies,
Dolphin connections and provider subscriptions are preserved.

After cloud cleanup, a single transaction removes private state, the `browser='octo'`
binding, UUID-specific events and dependent onboarding inputs. Client password and
NodeMaven key remain. Late events for unknown UUIDs are discarded under the stream lock;
the global cursor still advances. Old profile/grant IDs return 404. There is no deletion
archive, and restoring from Octo trash does not recreate the binding. A missed event
outside Octo's replay retention cannot be discovered by this event-only design.

Explicit headful live acceptance uses only the paused `Test For Octo Proxy creation` client:
set `OCTO_E2E_DELETION=1`, load the same local environment files as Console, then run
`node src/features/web-console/e2e/octo-deletion-live.e2e.mts`. It creates through Console,
deletes via cloud API, verifies automatic SQL/proxy cleanup and recreates the missing
profile without manual SQL cleanup. It never launches LinkedIn or an Octo desktop profile.

The catalogue accepts exact Unicode/punctuation codes using URLSearchParams and catalog
membership validation. The checker service must also support them; see
`docs/proxy-checker-geography-request.md`. Do not normalize the city into a different target.

Local development with a loopback checker URL (or missing checker configuration) shows
an unavailable-service error and a support link when `/health` is unavailable. The UI
does not offer checker downloads or installation instructions. The two-second probe is
shared/cached across status requests; no new proxy setup is queued while unavailable.
Production/Render and remote checker URLs do not use this local health probe.
Ru-only creation does not need the checker.

When refreshing the supplied checker client, preserve these Console compatibility edits:
explicit class fields instead of TypeScript parameter properties (Node strip-only mode),
the optional injected fetch argument (sanitized transport handling and contract tests),
and `.js` extensions on type imports for the project's NodeNext configuration.

## Initial setup commands

1. Build the existing frontend: `npm run web:build`.
2. Inspect `sql/001-octo.up.sql`; run `npm run octo:console:migrate -- --apply` only after
   approval. It backs up affected existing records locally, verifies preservation,
   checks rerun compatibility and commits atomically. Without `--apply` it still executes
   DDL inside a rolled-back transaction; that also needs authorization on a remote DB.
3. Apply `node --env-file=.env src/features/octo-access/migrate-onboarding.mts --apply`
   after reviewing `sql/002-octo-onboarding.up.sql`. It verifies a local backup, preserves
   existing profile JSON and rejects pending grants or conflicting client passwords.
   Migration 001 must not be rerun after 002; its operator command rejects that order.
   `npm run octo:console:seed` is a genuinely read-only preview. With approved `--apply`
   it creates only marked, paused Alex/Bob clients, using existing FRONTEND and Ru
   records, synthetic chat IDs and no platform accounts. Collisions fail; reruns reuse
   only exact fixtures. No messages are sent.
4. Set `OCTO_ENABLED=1`, `OCTO_ACCESS_SCOPE=all` (or `allowlist` with
   `OCTO_ALLOWED_CLIENT_IDS=<returned IDs>`), `OCTO_API_TOKEN`,
   `OCTO_HOME_FOLDER_UUID`, `OCTO_GUEST_FOLDER_UUID`, `OCTO_GUEST_EMAIL` and
   `OCTO_GUEST_PASSWORD` on the existing Console backend. All credentials remain server-side
   except Guest credentials and the individual profile password intentionally shown to
   authorized clients during their grant. `APP_DB=postgres` is required.
   Also configure `PROXY_CHECKER_BASE_URL` and `UNICORN_PROXY_CHECKER_SECRET_KEY`.
   On Render, use the checker's **Service Address** with its protocol and port:
   `PROXY_CHECKER_BASE_URL=http://<internal-host>:<port>` (no `/docs` or endpoint suffix).
   Set both variables on the **Console backend**, and the identical secret on the checker.
   Keep both services in the same workspace/region with private network access allowed.
   The secret is sent server-to-server in JSON, never in a `VITE_*` variable or browser request.
   No public checker URL, browser CORS setup, extra Console worker, or localhost fallback is needed.
   Local development can still use `http://127.0.0.1:8002` with its local secret.
5. `npm run octo:console:preflight` checks the token, Guest folder-only rights, folders
   and proxy pool through cloud GET requests. It never accesses the local desktop API.
6. From **Console's Render Shell**, run `npm run octo:checker:preflight` using the deployed
   environment. It checks `/health`, then authenticates with a deliberately incomplete
   proxy URL. Expected output: `{"reachable":true,"secretAccepted":true,"proxyChecksStarted":0}`.
   The expected `422 invalid_proxy` proves the request passed authentication without
   starting a check, spending NodeMaven traffic or creating profiles. This command makes
   no database writes and is not an automatic startup dependency or periodic probe.
   A wrong secret, invalid URL, unreachable service or unexpected response gives
   a sanitized error and a nonzero exit code. No secret or internal URL is printed.
   This proves connectivity/authentication; the existing Console onboarding workflow
   is still required to validate actual generation in the deployed environment.

Render network reference: https://render.com/docs/private-network

## First Octo profiles and proxy setup

New Console client profiles are created in Octo. Clients with Dolphin profiles can still
open those profiles, even when their current market requires additional locales; the
client Dolphin route no longer creates missing profiles. Dolphin appears first when
present. The one-time browser notice is versioned and stored per client in localStorage.

Ru clients skip proxy setup. En/Both clients prepare one En proxy before creating any
missing profiles. Existing Ru profiles are reused. The sources are a SOCKS5 string, an
owned Dolphin proxy (copied without changing Dolphin), or a saved NodeMaven key. Country,
available region and available city are mandatory, fetched through the live NodeMaven
catalogue. Catalogue errors never become empty choices.

`onboarding-service.mts` validates ownership and queues a durable operation. The backend
calls the private checker: `/v1/proxies/check` for own/copied proxies, `/v1/proxies/best`
with `count=20` for NodeMaven, matching the refreshed API default (maximum 100).
The external checker uses 10 candidate workers. The UI
announces up to four minutes; the application abort deadline is 15 minutes. Transport
failures may happen earlier, and a longer measured duration must be reported during acceptance. Own/copied scores below 70 require explicit
confirmation; failed checks cannot be confirmed. NodeMaven uses the geo-matched winner.

`onboarding-workflow.mts` reserves the required profiles, waits for cloud creation and
attaches the checked proxy to En. The proxy operation ID is bound to that setup. The
old proxy-edit form remains available after setup completes. No browser is automatically
launched. Two independent checker requests can run without blocking grant expiry.
Shutdown cancels in-flight requests. A restarted `checking` operation becomes `unknown`;
it requires operator review and never automatically repeats a paid request.

New owner-only routes are `POST /api/octo/onboarding`,
`POST /api/octo/onboarding/:id/continue`, `PUT /api/octo/nodemaven-key`, and
`GET /api/octo/locations?level=countries|regions|cities&country=...&region=...`.
The existing status route returns only safe setup progress, never provider keys or proxy
credentials. The account password is unchanged; the shared profile password is shown last.

The operator seed flag `--proxy-fixture` selects only the paused En client
`Test For Octo Proxy creation` (`octo.proxy.test@example.com`), without platform accounts
or messaging. `OCTO_E2E_PROXY_ONBOARDING=1` enables
`web-console/e2e/octo-onboarding-live.e2e.mts`: real headful login, NodeMaven Tbilisi setup,
Ru/En password equality, cloud attachment, desktop En opening and Scamalytics verification.
It refuses used fixtures by default; `OCTO_E2E_RESUME_SETUP_ID` can continue observing
an inspected, exact in-flight setup without repeating generation. Errors stop the run.
Artifacts contain no credentials.

### Local acceptance on 2026-10-14

- Migration 002 applied to `unicorn_noco_copy`; existing profile JSON and passwords
  unchanged. The new fixture client is 250, paused, with no platform accounts.
- 104 focused module/SQL/frontend tests passed, plus the headful wizard test and two
  complete Alex/Bob mock cycles. The actual checker capacity suite passed 26 tests.
- Kira profile 307: headful Console login, Octo grant/opening, HH authenticated, normal
  close and cloud cleanup passed. Zero submissions; schedules unchanged; no LinkedIn.
- New fixture: actual Console login, saved NodeMaven key, country/region/city selection
  and setup submission passed. Only one generation was dispatched, with count 100.
  The checker response was lost; Console persisted `octo_proxy_check_unknown`. No new
  profiles were created. Four-minute completion and Scamalytics Tbilisi were **not**
  verified. Do not reset/retry this unknown operation automatically.
- The checker health endpoint remains reachable, but the synchronous contract does
  not return a job ID before completing and cannot recover that lost reply. Its hidden
  `/v1/checks` and `/v1/checks/{check_id}` routes need an agreed, typed, recoverable
  contract before Console changes to them. No silent transport/endpoint workaround was made.
- The broader legacy `backend/app.test.ts` fails at its pre-existing SQL dependency
  guard before exercising these changes; the affected SQL Dolphin integration test passed.

Reports: ignored `tmp/octo-onboarding-live/report.json`, `tmp/octo-kira/hh-auth-report.json`,
and `tmp/octo-console-mock/`. Release acceptance is incomplete; no PR/deployment for this
onboarding change. Render also still needs a reachable checker URL.

The refreshed checker contract retains the same endpoints and response shapes but changes
the best-proxy default to 20. The Octo adapter and E2E driver share that candidate count;
a contract test compares it with the copied OpenAPI. A user-authorized repeat archives
the exact previous unknown setup for fixture 250 before starting a new UI operation.
This is an explicit operator action, not an automatic application retry. New evidence
is written to `tmp/octo-onboarding-live-20/`, preserving the earlier 100-candidate report.

### Successful repeat with the refreshed 20-candidate API

The real headful Console E2E passed for fixture 250. Login, key persistence, country
`ge`, region/city `tbilisi`, generation and both profile creations completed through
the UI. Checking plus provisioning took 132 seconds; checker score was 78/100.
Profiles 312 (Ru, no proxy) and 313 (En, checked proxy) share the same five-digit
password. En opened on the Guest desktop. Its actual outbound IP `94.240.240.240`
showed country Georgia, region Tbilisi and **City: Tbilisi** on Scamalytics.
Normal close and automatic cloud cleanup of both grants passed; no LinkedIn page
was opened. Evidence: `tmp/octo-onboarding-live-20/report.json`, `console.png`,
`scamalytics.png`. The earlier unknown attempt remains archived separately.

This repeat also found and fixed a UI race when replacing a saved NodeMaven key:
country/region/city controls now remain disabled until saving and catalogue refresh
finish. The browser regression test covers a delayed key-save response. No checker
endpoint fallback or automatic generation retry was introduced. This is local
acceptance; Render still requires a reachable checker URL and explicit deployment.

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
  real HTTP bridge gateway/agent, mocked Octo/DB, three cycles with 45-second leases.
  It verifies six mocked native removals and no cloud clear. The browser is headless;
  this does not prove desktop/archive behavior.
- `npm run octo:console:e2e:live`: existing Console auth and real SQL/cloud Octo modules,
  with unrelated automation mocked. Requires an authenticated local Guest desktop.
  It now requires an empty Octo fixture scope in the isolated `unicorn_noco_copy_restore`
  database and a second VEULink PC; the application database is refused before startup.
  The client test driver uses `localhost:58888` for two newly created, verified fixture
  UUIDs. It checks the other client's actual password is rejected, opens both windows,
  checks Wikipedia identity and saved markers, waits 120 seconds, checks hidden but
  running/protected profiles, closes normally and repeats three cycles with unchanged
  passwords. Every cleanup also requires password-free owner reopening on a different
  PC through the archive-acceptance handoff.

Full live acceptance now refuses `OCTO_E2E_RESUME_PROFILE_IDS`: an interrupted or older
run cannot establish its first fresh owner restore. Retain its exact bindings, journal
and data for inspection. Use separately prepared, paused, unused synthetic fixture
clients for a separately identified acceptance run, never replacements for client
profiles. See the archive-acceptance procedure for fixture email overrides and preflight.
Artifacts go to ignored `tmp/octo-console*`; screenshots mask credentials, reports never
contain passwords or provider errors. A mock pass is marked `live: false`.

The Kira proxy driver is `web-console/e2e/octo-proxy-live.e2e.mts`, gated by
`OCTO_E2E_KIRA=1`. It uses a visible browser, authenticates through the real Console
form, creates one new Ru profile and saves Kira's existing proxy connection through the
form. It reads the Dolphin source without changing its binding. An interrupted final
verification may resume the exact recorded binding with `OCTO_E2E_RESUME_PROFILE_ID`;
this does not create another profile/proxy or repeat a successful write.

`hh-responses/octo` reuses HH authentication, scenario injection, responder and stop-list
logic on an already opened Octo CDP session. A desktop runner still owns profile start
and ordinary close; the cloud-only Console backend does not launch desktop browsers.
This manual runner does not enable scheduled HH work or migrate Dolphin targets.
Its scoped submission guard counts attempts before dispatch, including ambiguous results.
LinkedIn requests are blocked in the Kira test; no LinkedIn connection is created.

`web-console/e2e/octo-hh-live.e2e.mts` is deliberately scoped to the inspected Kira
pilot binding. `OCTO_E2E_KIRA=1` plus `OCTO_E2E_HH_AUTH_ONLY=1` tests Console login,
grant, desktop opening, HH login and ordinary-close cleanup without submissions.
For the separately approved single application, set `OCTO_E2E_HH_ONE_APPLICATION=1`
and leave auth-only off. `OCTO_E2E_HH_COVER_TEXT` is a run-only override; it never
updates the database. Both HH schedule flags remain disabled. A durable one-run marker
prevents silently repeating the application budget after an interrupted/uncertain run.
Inspect the saved report before any operator-authorized retry; a successful profile
launch or auth-only test is not evidence of a successful application.

LinkedIn onboarding still selects a Dolphin En binding and uses its inspector/session
collector. Octo needs its own target selection and collector (UUID, grant/password,
proxy mapping and desktop CDP session); the existing Unipile account adapter and later
LinkedIn features can retain their contracts. Keep the existing DataImpulse SOCKS5 to
HTTPS mapping for Unipile. No live LinkedIn compatibility is claimed by these tests.

Create a PR only after the full live acceptance passes. No deployment or Git publication
is part of the setup scripts.
