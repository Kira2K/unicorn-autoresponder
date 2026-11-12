# Supervised HH runner: release, first check and Windows VDS

`npm run hh:supervised` runs the existing normal HH queue with an isolated
image-only Codex adapter. Default scope is all enabled ready accounts, Ru then
En, 100 applications each, concurrency 4. Readiness, stop lists, saved confirmed
IDs, pending manual questions, reports and owned-profile cleanup remain in the
normal implementation. Profile Filler is never started by this runner.

## First action of the skill

```powershell
powershell -NoProfile -File .agents/skills/hh-autoresponses/scripts/first-check.ps1 -EnvFile C:\private\hh.env
```

The executable skill resource is the first step on activation. `inspect` checks
runtime dependencies, other HH processes, PostgreSQL/catalog/market flags,
Dolphin local/cloud access, Bot API membership/write permission in the actual
report destinations, and Codex version/login. It makes no inference, opens no
student profile, performs no application and sends no success message.

Before deployment/scheduling use `-Mode full`. It additionally requires an idle
Dolphin and reads synthetic text through the actual configured image-only model.
One short paid/subscription model invocation is expected; usage is in the JSON
proof under `logs/hh-service-checks/`. It tests model access, flags, schema output
and usage, rather than inferring access from login status. Failed checks alert
only the configured manager destination. The launch command repeats a full
preflight under its actual task user before opening any student profile.

Read-only diagnosis/repair can proceed after a failed initial check. Launching
cannot. An old success proof is never used to skip the launch check.

## Prepare an outdated VDS without overwriting it

1. Inventory the VDS: Windows version, timezone, logged-in task user, current Git
   SHA/branch/status, Node/npm versions, HH task names/actions/principals, live
   controllers and Dolphin profiles. The lifecycle/process checks target Windows;
   Linux needs a separately validated runtime.
2. Finish/stop the old HH process normally, verify its reports and profile
   cleanup, then disable only its HH schedule. Confirm this PC and the VDS are
   not running the same accounts. Keep the old directory, ENV, task export,
   Dolphin profile data, confirmed localStorage IDs and manual queues.
3. Check out the reviewed release in a **separate** directory. Fetch master and
   pin its tested merge SHA (or use the reviewed release branch for a canary).
   `git status --short` must be clean. Avoid force-resetting the outdated copy.
4. Install Node 24.12+ and run `npm ci`. `@openai/codex` 0.167.2 and `sharp`
   0.35.5 are pinned in the lockfile. Codex's platform-specific optional package
   must be installed; do not use `--omit=optional`. Neither VS Code nor this chat
   application is needed. A custom native CLI path can be provided explicitly
   through `HH_CODEX_EXECUTABLE`, and is checked again before each run.
5. Prepare local ENV from the intended existing environment and `.env.example`.
   Keep credentials out of Git. Explicitly set `APP_DB=postgres` and the correct
   working `APP_DB_POSTGRES_*` configuration with verified TLS or a local tunnel.
   Do not reuse an old Noco dataset as a fallback. Git does not synchronize data,
   schema, market flags, browser cookies or application history.
6. Set `summary_logs_channel_id` / `HH_REPORTS_CHAT_ID` to the manager reports
   destination, currently `-1004369925631`. `HH_TECHNICAL_CHAT_ID` defaults to that
   same destination; an old stored `logs_channel_id` does not override it for HH.
   Student destinations use the canonical secured-group selection already in
   the application. Reads and sends use the existing shared Bot API integration.
7. Authenticate the **task's Windows account** to the pinned CLI:

   ```powershell
   node node_modules/@openai/codex/bin/codex.js login
   node node_modules/@openai/codex/bin/codex.js login status
   npm run sql:check -- C:\private\hh.env
   npm run typecheck
   npm run hh:supervised:test
   npm run orchestrator:test
   powershell -NoProfile -File .agents/skills/hh-autoresponses/scripts/first-check.ps1 -Mode full -EnvFile C:\private\hh.env
   ```

   For a remote login use the CLI's device-code authentication when needed.
   Saved auth stays outside the repository. The recognizer receives only the
   image, minimal instructions and a runtime/auth-location environment; no
   student data, application secrets, browser control, plugins, web or shell.
8. Start Dolphin in that interactive Windows session and operate it headful
   through the existing API. If launched from an Electron-hosted environment,
   remove `ELECTRON_RUN_AS_NODE` only in Dolphin's child environment; the old
   inherited variable previously made Dolphin exit immediately. Preserve other
   apps and personal Telegram sessions. Disconnecting RDP and signing out are
   different; validate the chosen session/task behavior on the actual VDS.

The initial rollout still requires a small, explicitly scoped real-HH canary on
the VDS: English image selected and captured, configured model answer with
usage, HH acceptance, continuation of the same operation, history/manual queue
preserved, required reports delivered and profile/tag/status cleanup confirmed.
Unit tests and a synthetic model check do not prove HH acceptance on another
machine. Use Monday–Thursday or the user's explicit weekend override.

For a developer smoke without student accounts, `npm run hh:captcha:smoke --
--env-file=C:\private\hh.env` opens a fresh isolated headless Edge context with
all requests intercepted on `hh-fixture.invalid`. It exercises the real English
selector, pixel capture, model transcription, fill and submit adapters against
a local fixture. It records usage and image removal and sends no HH request.
`HH_TEST_BROWSER_CHANNEL` selects an installed test browser (default `msedge`);
this browser is optional and is not needed for production Dolphin/CDP operation.

## Invocation and configuration

```powershell
npm run hh:supervised -- --env-file=C:\private\hh.env
npm run hh:supervised -- --markets=en --limit=80 --concurrency=4 --client-names="Student Name" --env-file=C:\private\hh.env
```

The CLI rejects Friday–Sunday in `HH_TIME_ZONE` (default Europe/Moscow), unless
the user's explicit weekend instruction is represented by `--allow-weekend`.
Preparation and read-only checks can run any day. Both markets always sequence
Ru before En. Names are an explicit user scope; all-profile runs have no fixed
client IDs/names or extra exclusions. Pre-existing narrowing ENV is cleared.

`HH_RESPONSE_LIMIT`/`HH_CONCURRENCY` default to 100/4; explicit CLI values take
precedence. Watch/idle defaults are two hours/ten minutes. Startup/selection has
a 15-minute deadline because credential hydration may take several minutes;
the campaign defaults to a 24-hour wall-clock deadline. A provider failure or
deadline requests a graceful stop through IPC: new queue admissions stop and
the worker's existing owned-profile cleanup runs. If it cannot exit within 90
seconds, the failed run retains its owner lease for explicit recovery. It is
never reported as a clean completion or followed by the next market.

The controller writes `owner.json`, `status.json`, `progress.json`, per-market
manifests/results, worker stdout, CAPTCHA result and usage journals under
`logs/hh-supervised-<time>-<id>/`. The manifest points to the actual existing
orchestrator ledger. Inspect `run-start`, real responder starts, confirmed
counters, provider health, report results and cleanup. Do not treat opening
Dolphin or a completed queue as a successful application.

`HH_CAPTCHA_MODEL` defaults to **gpt-6.1-sol**, reasoning `high`. Calls are bounded
to 90 seconds, a challenge to three attempts/four minutes, and browser waiting
to five minutes. Images are saved only under `tmp/captcha/` and erased in
`finally`. Reissued images are rechecked by hash before fill and submit. A
provider unavailable/auth/protocol failure stops the shared provider; a rejected
answer remains a bounded per-client CAPTCHA outcome. No model polls pages or
presses application buttons.

Admission accounting defaults to 200 calls and 1,500,000 known/reserved tokens,
with 20,000 reserved per concurrent call. The preflight invocation is included
in campaign counters. Unknown usage remains reserved and closes the provider.
Input already includes cached input; output already includes reasoning output.
The budget is an admission limit, not an exact provider billing guarantee:
in-flight requests can exceed an estimate. Logs distinguish unknown from zero.
Runtime report failure is never a reason to replay an application or resend an
uncertain message automatically.

## Schedule

Convert the intended time to the VDS host clock. No-time requests mean the next
Monday–Thursday 04:40 GMT+3 (05:40 on a Georgia-time host). The helper uses **host
local weekdays/time**; verify those map to the intended market timezone/day.
It displays the host timezone and principal in its plan. Do not substitute a
different existing HH task or change unrelated schedules.

```powershell
powershell -NoProfile -File scripts/register-hh-autoresponses-task.ps1 -AtLocal 05:40 -EnvFile C:\private\hh.env
```

This prints a plan only. After inspecting its timezone, paths and task user,
add `-Apply` to run a full service test and register the main and one-hour-before
check tasks. Existing task names cause a failure, not replacement. Both are
Monday–Thursday; a midnight launch correctly moves the check to the preceding
day. `IgnoreNew`, interactive principal and persistent file logs are used.
No password or service token is written into task arguments. Verify actual task
execution, RDP disconnect and reboot behavior on the VDS before routine use.

## Stop and restart recovery

The standard stop disables only the specified market in PostgreSQL:

```powershell
npm run hh:flag -- --client-name="Student Name" --market=ru --disable --env-file=C:\private\hh.env
```

Canonical identity/row uniqueness are checked, the row is locked, only the named
flag is patched through the existing adapter, and the result is reread. The
other market is preserved. `--enable` reverses an explicitly requested change.
Do not use a failure as authorization to disable a student. An already running
profile needs a separate scoped graceful stop; queue admissions read the latest
flag before opening their profile.

A global lease in the Windows temporary directory prevents separate checkouts
from launching two new supervisors. The normal profile tag/status lock remains
in use, and existing locks are not forcibly taken. The preflight also checks
legacy orchestrator processes and open local Dolphin profiles. This is not a
distributed lock between different machines; confirm one host owns the accounts.

After a crash/restart, inspect the exact run; do not remove its lease manually:

```powershell
npm run hh:recover -- --run-dir=C:\apps\hh-release\logs\hh-supervised-<id> --env-file=C:\private\hh.env
```

Inspection does not modify profiles, tags, flags or reports. After confirming
the owning controller/worker are dead and no other host is running, add
`--apply`. Recovery uses that run's recorded lock plan/verified previous status,
stops only its proven profiles through the existing Dolphin integration,
preserves unrelated tags, verifies cleanup, erases its image directory and then
releases only its matching lease. Changed ownership or missing evidence blocks
cleanup. No applications, reports or whole campaigns are retried.

When resuming, preserve existing history and calculate only proven remaining
quotas through the normal queue. A missing count is unknown, not zero. Partial
remaining-quota maps require explicit selected scope and validation. A new full
campaign omits the map entirely; it never passes `{}`. Prefer a fresh explicitly
authorized run over inventing recovery counts.

## Rollback and release checks

Run the focused provider/controller/flag/recovery tests plus existing HH,
SQL/login, shared-reporting and type checks. Verify `npm ci` from the lockfile,
not a parent checkout's `node_modules`. No ENV, browser data, images or session
files belong in a release archive or Git. Pin the tested commit when merging
the PR and deploying.

Rollback code after the owned profiles have stopped and their state is checked.
Retain the current SQL data and Dolphin history. Returning to an old Noco dataset
or replaying uncertain operations is not code rollback. Keep the previous
checkout and its task export until the new VDS canary and schedule are verified.

Official CLI background:
[non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode),
[authentication](https://learn.chatgpt.com/docs/auth).
