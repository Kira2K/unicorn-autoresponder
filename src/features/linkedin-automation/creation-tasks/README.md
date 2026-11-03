# LinkedIn creation tasks

`linkedin_creation_task` references the existing client, LinkedIn preparation and Outlook account rows. FIO, stack,
blocked accounts, credentials and Octo bindings are read from their original stores. The table contains task state,
optimistic version and a verified EN proxy receipt, not copies of student data or secrets.

Statuses: `не начата` → `блок` / **`сделана экспертом` (final)**.
Denis completes through the existing status endpoint; there is no separate approval command.
Completion immediately hides the task from the contractor, restores student LinkedIn/Octo access,
starts the local LinkLab cycle and records two deliveries. Completed tasks cannot reopen.
Repeated completion, including an old version after a lost response, does not replay effects.
The admin LinkedIn tab is a read-only history with independent delivery outcomes.

The completion checklist lists saved LinkedIn URL, login, password and the task's proxy confirmation, with
instructions for each missing item. Reopening a task restores its saved proxy confirmation when the EN
profile is idle; a new access session or proxy edit requires confirmation again in the current view.
The backend still re-reads and validates the actual proxy when completing an unfinished task.
The Denis result form keeps the profile URL in `url` and the account login in `login`.
If no LinkedIn login has been saved, the form prefills it from this task's linked Outlook account,
without checking its email domain. It remains editable and is persisted only by the explicit result save.
Existing nonblank LinkedIn logins, including legacy URL values, are not replaced or migrated on opening.
The expert's current task also reads the student's archived LinkedIn accounts and their submitted blocked
history. Copied identical history cards are shown once; distinct archived account rows stay separate.
Archived account names, URLs, logins and locations are shown without passwords. The list is numbered and
shows its total count. This is a read-only view: opening a task does not rewrite history or migrate data.
Initial list loading shows a spinner and skeletons; refresh keeps the current list and selected card visible.
Failed requests show a retry hint instead of an empty-list message. Only the newest list response is applied.
List labels use a single read of client names and stacks, avoiding full client hydration for every task.

The expert proxy form shows a SOCKS5 one-line input immediately. It accepts `host:port:login:password`
or a `socks5://` / `socks5h://` URL and fills the existing fields locally; parsing never saves or checks a proxy.
Passwords containing colons are preserved, and invalid input leaves the existing fields unchanged.
Saved credentials hydrate the same fields, including the password show/hide control; background status
polling preserves unsaved edits. «Сохранить прокси» below the Octo card submits that form and retains its
validation, connectivity check and existing profile assignment. Initial Octo loading has a spinner and
failed loading shows a retry message. Completed grant IDs are not polled again; when a new proxy is
required, the card explains why access remains unavailable while the proxy form stays editable.

## Notifications

Real transitions between open statuses through the contractor endpoint retain the existing post-commit
reporter, manager destination and configured mention (currently `@KiraSamsonova`). Same-status saves,
draft/proxy saves, initial creation and direct SQL changes do not invoke this reporter.

Completion does **not** invoke that reporter. Its transaction creates two independently claimable rows
in `linkedin_cycle_notifications`, keyed by `(task_id,recipient)`: `reports` to `-1003187558078`
with no mention, and `student` to the student's effective group. Destination selection is nonblank
`secured_general_chat_id`, otherwise `telegram_general_chat_id`, frozen when the event is created.
No private Telegram account or username is used. Missing student group records a failed delivery with
`recipient_missing`; it never falls back to the reports group. No credentials appear in either message.

The worker sends through shared Bot API `sendOne` after commit. Delivery receipts are independent;
failure of one cannot cancel completion or suppress the other. Sent/failed/uncertain events are never
automatically retried; expired in-flight claims become uncertain. Opening/reloading a task only reads.
The older open-status reporter has no durable queue; its failure still leaves the saved status intact.

## Composition and authorization

Tasks and the expert Console are always composed in the PostgreSQL + Octo Console; there is no separate
expert feature flag. Existing Octo configuration and access policy still apply. Apply the explicit migration
before deploying this version; startup checks the existing schema and never performs DDL:

```powershell
node --env-file-if-exists=.env --env-file-if-exists=.env.octo-pilot --env-file-if-exists=.env.octo-onboarding src/features/linkedin-automation/creation-tasks/migrate.mts
node --env-file-if-exists=.env --env-file-if-exists=.env.octo-pilot --env-file-if-exists=.env.octo-onboarding src/features/linkedin-automation/creation-tasks/migrate.mts --apply
```

Configure `LINKEDIN_CREATOR_LOGIN`, `LINKEDIN_CREATOR_PASSWORD` and `NODEMAVEN_API_KEY` in server secrets
or ignored local ENV. Missing credentials do not grant expert access. The NodeMaven key is read on demand
by the authenticated copy endpoint.
Credentials and the key must never enter Git, task rows, localStorage or logs. This does not configure Render.

For the current Render deployment these three keys belong only to the **Very Evil Unicorn** Web Console backend.
They are not needed by `unicorn-bot`, `unicorn-proxy-checker`, the local bridge or Octo Desktop.
The separate E2E stand needs its own values only when explicitly running that stand.
Keep the existing student Octo/bridge settings. On a single backend the expert uses the same worker as students;
no new Docker container, `OCTO_CONTROL_URL` or `OCTO_CONTROL_SECRET` is required for this feature.
The removed `LINKEDIN_CREATION_TASKS_ENABLED` ENV is ignored, including an old value of `0`; it can be deleted.

The new `linkedin_creator` session role is restricted to `/api/linkedin-creator/*`, auth/me and logout.
Nariman's existing `provider` role and endpoints stay unchanged. Task routes resolve student/account/profile IDs
server-side. Grants reuse Octo's existing TTL, cleanup and single-worker ownership, restricted to that task's EN
profile. No worker is started by the task module; an unavailable listener remains an explicit 503.
For a local Console sharing an existing deployed worker, configure the common
[Octo control transport](../../octo-access/README.md#two-consoles-with-one-octo-worker).
It is injected into the same service used by student routes, not a contractor-specific grant path.
The contractor's EN card also reuses the student's existing proxy form, expanded by default.
Its task-scoped `POST /api/linkedin-creator/tasks/:id/octo/profiles/:profile/proxy` resolves
the student and sole EN profile server-side, then delegates to the same `saveProxy` queue.
RU/foreign profiles are rejected and no other profile data is returned. Enter a proxy in
this card, save, wait for attachment, then use the existing capture button to verify it
for the task. No login to the student's Console and no Octo edit rights are required.

Students with any Dolphin binding continue their Dolphin flow and cannot use this Octo intake. Completed tasks
lock the student's LinkedIn/Outlook changes through both intake and generic platform-account mutations.
The optional SQL before-write hook runs in the same transaction and takes the client row lock, shared with
intake/expert changes. Other platform types are unaffected.

## Proxy and completion

Opening Octo is not required to confirm a saved proxy. If access is already active, close Octo normally and
wait for the grant's cleanup to complete before capturing. The capture adapter verifies
the cloud profile is closed/private, reads its actual proxy, persists its existing saved-proxy reference through
the Octo store, then writes a task receipt after revision/read-back checks. Inline connections use the existing
durable proxy creation/attachment workflow; pending or uncertain results cannot produce a success receipt.
No input password is copied into a task. Concurrent profile edits invalidate the operation.

Every new LinkedIn application requires a new connection, entered manually by Denis. Only EN is changed;
RU and the profile set/password remain intact. The baseline UUID is recorded when the task is created.
The server compares a hash of protocol/host/port/login/password, ignoring the Octo UUID/title and rotation URL.
A simple HTTPS connectivity probe must return a valid `exit_ip` for the proposed connection before it is queued.
It uses the same local, 10-second bounded adapter as student manual proxy setup; no remote quality/geography
checker or checker ENV is needed for Denis's new-proxy validation. A necessary old-IP probe has its own bound.
The UI shows a spinner and «Проверяем прокси, это может занять до минуты» through checking and assignment.
Rejected checks show an inline alert beside the submit button and retain the entered fields.
The existing profile poll includes the current task version, so asynchronous assignment invalidation updates
the open task without discarding result drafts or requiring it to be reopened. Older responses cannot reduce
the locally known task version; optimistic checks still reject genuinely concurrent changes.
The same provider gateway is allowed; identical credentials or a known identical exit IP are refused.
If the old IP is unknown or its connection is unavailable, comparison is explicitly recorded as `skipped`.
This is successful validation of the new connection, not proof that the old and new IP differ.
Baseline fingerprints/IP and the old saved Octo proxy reference remain in the verification journal.
Before the first queued replacement, its old connection fields are also saved in `baseline_connection`,
restricted to the backend/owner alongside existing sensitive proxy state; they are not returned by task DTOs,
included in notifications or logged. This preserves connection history independently of the Octo saved object;
the previous saved proxy is not deleted. No automatic proxy purchase or selection is performed.

Network validation runs outside SQL transactions. The queue locks the client/task/EN profile and checks
versions and the old binding again before storing the existing durable proxy operation. Active access must
finish first. A pending or uncertain external create/attach is read back by its operation marker and is
never blindly repeated. Denis access, capture and expert completion require this verified operation;
capture/completion also re-read actual cloud connection fields. Substitution invalidates the receipt.

Expert result editing writes URL/login/password to the linked platform account and preserves a blank submitted
password. Draft result saves do not rebind LinkLab. Completion verifies full
LinkedIn credentials and the current closed EN proxy against the receipt, with SQL checks as a second barrier.
Student saves, result saves and status changes serialize on the client; stale task versions return 409.
An uncertain commit requires reloading the task, never automatic retry.

## New local cycle and release order (PR #100)

**CRM СЕЙЧАС НЕ ПОДКЛЮЧАЕМ. ДЛЯ БУДУЩЕГО ПОДКЛЮЧЕНИЯ НУЖНО ИЗМЕНИТЬ ЕЁ ЛОГИКУ: ПЕРЕДАВАТЬ НОВЫЙ ЦИКЛ И ПРИВЯЗЫВАТЬ РЕЗУЛЬТАТЫ К КОНКРЕТНОМУ LINKEDIN-АККАУНТУ.**

The SQL transition to final `сделана экспертом`, including a direct staff SQL update, atomically rebinds
LinkLab to the new owned account and resets status to `Новый`, progress to 0 and revision to -1. It clears
the block/completion dates and next-account URL, preserving the CRM student ID, EN CV approval, history
and active physical proxy pause. A missing LinkLab row is created. A different previous binding must refer
to this student's archived account; arbitrary rebinds remain forbidden. The per-task/account ledger makes
confirmation idempotent. Already confirmed tasks are not replayed when installing the migration.

This local reset is required independently of `LINKLAB_ENABLED`; the flag still governs legacy exchange.
Reset rows have `crm_integration_required=true`: the legacy queue excludes them and locked SQL entry points
reject/ignore delayed CRM writes, acknowledgements and errors. Other students retain their existing behavior.
Do not clear the flag to reconnect the old worker; the future CRM protocol must identify the cycle/account.

In the same completion transaction, two delivery rows are inserted into `linkedin_cycle_notifications`.
The manager message announces the ready LinkedIn and new cycle, with name, stack, task number and URL,
without a tag. The student message explains that login/password and Octo are in the cabinet, asks for no
LinkedIn login during the first month, then Octo-only access, no 2FA and no password changes.
Its HTML paragraphs/bullets are covered by the notification contract tests.

Install with the Console/Octo writers stopped and an owner-authorized connection. Keep the existing
application role's Octo/profile/task rights; never give it ownership or write access to the cycle ledger.

1. Existing Octo schema, LinkLab SQL `001` → `005`, then creation-tasks `001` must already be installed.
2. Run the new explicit runner **without `--apply`** first; it executes and rolls back the DDL for validation.
3. Apply once: creation-tasks `002-new-proxy` then LinkLab `006-account-cycle`, in one transaction. The runner
   grants the selected application role SELECT/UPDATE on proxy proof and notification journals, and SELECT
   on the cycle ledger. Connect as the migration operator allowed to `SET ROLE unicorn_noco_copy_owner`.
   Use `--app-role unicorn_sql_app` for Render's separate restricted application role; this does not grant
   ownership or membership in the owner role. Without this option the grant target is the connecting role.
4. Start the new backend only after the migration. Startup validates schema and performs no DDL. Pending tasks
   require a newly verified proxy; historical confirmed tasks/accounts are not rewritten.

```powershell
node --env-file-if-exists=.env src/features/linkedin-automation/creation-tasks/migrate-cycle.mts --app-role unicorn_sql_app
node --env-file-if-exists=.env src/features/linkedin-automation/creation-tasks/migrate-cycle.mts --app-role unicorn_sql_app --apply
```

Do not rerun the old task `001` runner after installing this cycle migration. Do not drop the ledger/flag or
restore old CRM functions as an automatic rollback after cycles exist. Preserve data and use a reviewed
forward repair. This PR does not apply these migrations, modify working data, send real messages or deploy.

For actual SQL verification, `LINKEDIN_CYCLE_ISOLATED_CONFIG` names a private JSON config for a fresh disposable
loopback PostgreSQL at port 55439, user `cycle_owner`, database `unicorn_noco_copy_restore`, `local_proof:true`.
The test refuses an existing `noco` schema, loads real migrations and checks restricted app rights, CAS,
atomicity, CRM fences, preserved state and concurrent notification claims. Never point it at working ENV.

## Verification

```powershell
node --test src/features/linkedin-automation/creation-tasks/*.test.mts src/features/linkedin-automation/console-intake/*.test.mts src/features/web-console/backend/linkedin-creation-routes.test.mts
node src/features/web-console/e2e/linkedin-creation.e2e.mts
```

`linkedin-creation-live.e2e.mts --apply-octoguide` is an explicit live-write test scoped to the pre-existing
`octoguide@julian.com` fixture (client 261). It submits the saved student preparation through the browser twice,
checks one task, preserves existing passwords/profiles/proxies, and verifies the contractor console. It never
starts background workers or publishes LinkedIn content. Use only with the loaded local ENV and explicit
authorization. Reports/screenshots belong in ignored `tmp/linkedin-creation`.

### Denis EN access acceptance: tasks 1 and 9

`src/features/web-console/e2e/linkedin-creator-access.e2e.mts --preflight` is read-only.
It validates the existing OctoGuide client 261/task 1 and the explicitly marked paused
demo client 266/task 9, the original EN proxy, idle operations, guest rights, the local
Desktop identity and the deployed control endpoint. It never starts a worker or changes
Desktop login. `--apply-denis` requires all preflight checks to pass before any write;
the explicitly selected `--switch-desktop` mode switches sessions as described below.

After the control endpoint is deployed/configured, provide a dedicated usable test
proxy in **private process ENV** `LINKEDIN_CREATOR_E2E_PROXY_JSON`, with the same structured
fields accepted by the current proxy form (`type`, `host`, `port`, `login`, `password`,
optional `changeIpUrl`). Form input is mandatory on every run, even for an already configured
profile. Never store credentials in command arguments, reports or Git.
For the explicitly approved Октон-to-Artyom test, `--proxy-from-octon` reads the
connection from client **257** (Октон Октонович)'s EN profile in memory and enters it into task 9's form. It creates
a separate saved proxy object for the demo; the source binding/object is unchanged.
The source is resolved by numeric ID and confirmed by name; OctoGuide (client 261/task 1)
is a different fixture and must not be substituted. This flag is not a general student-copy mechanism.
NodeMaven's API key alone is not a proxy connection. The script does not provision paid
proxy capacity or call the retired proxy-scoring setup.

The apply run tests task 1 completely before preparing task 9's missing profiles.
Normal market rules reserve RU+EN for an En client; the contractor sees only EN.
The demo's required chat marker exists only in the injected fixture client object;
no Telegram destination is written. Reservation/provisioning and proxy attachment reuse
the existing durable workflows and shared worker. It performs real authenticated Console
grant requests, scoped Desktop starts and ordinary closes, cleanup, the proxy-capture
button, then demo-only LinkedIn result saving, expert completion and reload/readback.
Proxy fields are typed with keyboard events in a visible browser and submitted once with
the form button; no target proxy is assigned through an operator API call. The test verifies
all actual cloud connection fields in memory, the SQL proxy reference, and the task receipt.
OctoGuide's RU profile and original EN proxy are compared afterwards. It never creates
another student/task, directly sends a message, registers an actual LinkedIn account,
force-stops a profile or overwrites the existing bridge configuration.

The safe report is `tmp/linkedin-creation/denis-access/report.json`. It records the
initial Desktop role and a separate verified guest-open result for each task. Owner-side
opening cannot pass the full run. Existing fresh-owner archive acceptance is separate.
An uncertain start/stop is inspected for the exact attempted UUID, never blindly resent.

The existing shared guest has `profiles.edit=false` and `proxies.edit=false`, as required
by the current guest validator. Proxy entry is performed in the contractor's Console
form and verified in the cloud, not by editing inside Octo. Do not broaden this shared
guest's rights or relax the validator as an incidental E2E setup operation.

### Full contractor acceptance on an isolated stand

`src/features/web-console/e2e/linkedin-creator-staging.mts` is an explicit E2E entry point,
not the production entry point. It exposes only auth, contractor, protected Octo control/bridge
and static UI routes. It never starts lifecycle, bot, LinkedIn automation or recovery jobs.
Build it with `OCTO_ENABLED=0`; activate only after the production Octo composition has been
disabled and its SQL leadership lock released. Both environments use the same existing data.
Retain the production ENV backup and bridge journal; the stand uses a distinct bridge identity,
secret, configuration directory and journal. Drain the stand before restoring production.

The full runner is `src/features/web-console/e2e/linkedin-creator-access.e2e.mts`:
`--preflight --proxy-from-octon --switch-desktop` checks prerequisites without mutations;
`--apply-denis --proxy-from-octon --switch-desktop` performs the approved two-fixture run.
Its private ENV additionally requires `LINKEDIN_CREATOR_E2E_BRIDGE_CONFIG` and
`OCTO_E2E_OWNER_PASSWORD`. Supply the latter only in process memory through a masked local
prompt; never put it in source, saved reports, command arguments or the stand's ENV.
The production bridge must be stopped. The runner switches the closed desktop to the guest
before each grant/open, then back to the owner for journalled cleanup. It never force-stops.
Both task 1 (client 261) and task 9 (client 266) require verified guest opening to pass.
Artyom's mandatory proxy form source is **Октон Октонович, client 257**, not OctoGuide.
Existing EN/RU profiles are reused; no real LinkedIn registration is performed.

Alternatively use `--manual-desktop` instead of `--switch-desktop`. No owner password is
required or read in that mode. After grant publication the visible Console shows the guest
credentials; the operator uses Octo's Add/Switch account menu within 90 seconds. After normal
profile closure the runner waits for the owner account before processing bridge cleanup.
`operator-step.json` contains only the stage/required role/time; no credentials. An expired
grant or missing guest identity fails the run rather than counting an owner launch as success.

For unattended local acceptance use `--isolated-owner`: keep the Windows Desktop signed
into the configured guest, and run a separate owner Desktop locally. The reference
[Dockerfile](../../web-console/e2e/octo-owner/Dockerfile) follows Octo's official container recipe.
Bind only `127.0.0.1:58889:58889`, provide `OCTO_API_TOKEN` at runtime rather than in image
layers/arguments, and retain the stopped container's local cache outside Render and Git.
Set private `LINKEDIN_CREATOR_E2E_OWNER_PORT=58889` and use a separate bridge configuration
directory/journal. The injected fetch rewrites only the three existing localhost bridge
endpoints; protected backend requests and the user's guest API keep their original targets.
The runner checks both identities, opens/closes only in the guest Desktop, and runs the
unchanged one-shot bridge protocol through the owner Desktop. No account switching or owner
password is needed. This is not the independent fresh-owner archive acceptance test.

## Completion release and admin history

The previous confirmation API `POST /api/admin/linkedin-creation/tasks/:id/confirm` is removed.
Admin GET list/detail and the protected profile read remain; detail exposes
`notification.deliveries[]` with recipient, destination, state, message ID or error code.
The UI has no mutation button. Denis' `PUT /api/linkedin-creator/tasks/:id/status` is the sole completion API.

Install creation-tasks `004-three-statuses.up.sql` after the prior cycle/Denis migrations.
Use the explicit `migrate-completion.mts` command (default dry-run), not the old schema installer.
Stop all Console writers/dispatchers, including local backends using the same database, before installation.
The new backend checks the delivery schema and never applies DDL on startup.
Historical confirmed statuses are renamed with their versions/dates/cycles/delivery outcomes unchanged;
there is no student backfill. Unconfirmed expert-completed tasks block installation with their IDs.
The migration is transactional and rerunnable. Application table privileges are preserved.

See [release and verification guide](../../../../docs/qa/linkedin-three-statuses.md) for commands and checks.
The live runner now verifies final completion and both deliveries by GET after Denis finishes;
it never invokes an admin confirmation or SQL-confirmation helper. Running it live still needs authorization.
The old portable confirmation skill/archive is obsolete and must not be used for this release.
