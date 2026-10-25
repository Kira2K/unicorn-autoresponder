# LinkedIn creation tasks

`linkedin_creation_task` references the existing client, LinkedIn preparation and Outlook account rows. FIO, stack,
blocked accounts, credentials and Octo bindings are read from their original stores. The table contains task state,
optimistic version and a verified EN proxy receipt, not copies of student data or secrets.

Statuses: `не начата` → `блок` / `сделана экспертом` → `выполнение подтверждено`. The contractor can choose the first
three; confirmation is a staff SQL/admin-database operation. Confirmed tasks disappear from contractor reads.
Multiple manual tasks for a client are allowed. The student form owns one `source='student_intake'` task per client;
repeated/concurrent saves update that row. Existing-account saves never create a registration task.

## Composition and authorization

Apply the explicit migration before enabling the feature; startup never performs DDL:

```powershell
node --env-file-if-exists=.env --env-file-if-exists=.env.octo-pilot --env-file-if-exists=.env.octo-onboarding src/features/linkedin-automation/creation-tasks/migrate.mts
node --env-file-if-exists=.env --env-file-if-exists=.env.octo-pilot --env-file-if-exists=.env.octo-onboarding src/features/linkedin-automation/creation-tasks/migrate.mts --apply
```

Configure `LINKEDIN_CREATION_TASKS_ENABLED=1`, `LINKEDIN_CREATOR_LOGIN`, `LINKEDIN_CREATOR_PASSWORD` in server secrets
or ignored local ENV. The existing `NODEMAVEN_API_KEY` is read on demand by the authenticated copy endpoint.
Credentials and the key must never enter Git, task rows, localStorage or logs. This does not configure Render.

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

Close Octo normally and wait for the grant's cleanup to complete before capturing. The capture adapter verifies
the cloud profile is closed/private, reads its actual proxy, persists its existing saved-proxy reference through
the Octo store, then writes a task receipt after revision/read-back checks. Inline connections use the existing
durable proxy creation/attachment workflow; pending or uncertain results cannot produce a success receipt.
No input password is copied into a task. Concurrent profile edits invalidate the operation.

Expert result editing writes URL/login/password to the linked platform account and preserves a blank submitted
password. The existing LinkLab handoff runs in the same transaction when configured. Completion verifies full
LinkedIn credentials and the current closed EN proxy against the receipt, with SQL checks as a second barrier.
Student saves, result saves and status changes serialize on the client; stale task versions return 409.
An uncertain commit requires reloading the task, never automatic retry.

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
