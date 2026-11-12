# HH supervised release validation — 13 November 2026

The release combines PR 104's CAPTCHA/history/quota/reporting changes with the
nine preserved later source/test files and a portable tracked supervisor.
The updated skill begins with its executable `scripts/first-check.ps1` resource;
actual launches independently repeat the full service/model preflight before
opening a student profile.

## Completed locally

- Integrated master `021a3930a66404cb9e6ac426663fb31b30a6d210` without conflicts.
  Repeated all 101 focused tests, the existing orchestrator suite and full
  TypeScript check on the combined tree; all passed.
- Clean `npm ci` completed from the lockfile in an isolated checkout.
- 101 focused CAPTCHA/history/provider/budget/controller/flag/ownership/recovery
  tests passed. They include a real Windows process-detection fixture, native
  worker-exit accounting drain, provider failure/sequence stop, unknown usage,
  typed login diagnostics, partial lock cleanup and no foreign profile stop.
- The existing orchestrator suite passed, including 13 node:test cases for
  SQL storage/login and the PowerShell wrappers/first-check/task dry run.
- PostgreSQL adapter/readiness tests: 23 passed; existing Noco adapter tests
  passed. Shared Telegram integration and protected-route tests passed.
- Full TypeScript and CJS syntax checks passed. The skill passed its maintained
  validator; referenced resources and deployment-document links were checked.
- Real `powershell -File` task-registration dry run passed; no tasks were
  registered. It reports the actual principal/timezone/paths and requires an
  explicit apply flag before changing task definitions.
- The executable skill first-check was run in full mode after the clean install.
  Node 24.20.0, pinned Codex CLI 0.167.2, PostgreSQL schema/read, Dolphin local/cloud
  with zero running profiles, bot membership/report destinations and the
  configured `gpt-6.1-sol` high-reasoning image test all passed. The earlier
  service check also passed with Node 24.22.1.
- A fresh isolated headless browser fixture exercised the real CAPTCHA adapter:
  exactly one English switch, real pixel capture, native model transcription,
  one fill/submit, fixture acceptance and image removal. All page requests were
  intercepted on `hh-fixture.invalid`; no HH server request or student profile
  was used.
- Three short image-only model invocations across service checks and browser
  smoke reported **22,215 input+output tokens**, including 4,224 cached input.
  This is recognition-test usage, not this preparation chat's usage.
- No student profile was opened, application sent, student flag changed or
  successful Telegram probe sent by the preparation checks.

Local evidence is under `logs/release-validation/`, `logs/hh-service-checks/`
and the isolated browser smoke JSON. Runtime artifacts, ENV/auth/session files,
node_modules and CAPTCHA images are not included in Git.

## Release behavior covered

The default run uses PostgreSQL, all enabled ready targets, Ru then En, 100 per
account and concurrency 4. Each queued account rereads its market flag. Native
Codex receives only image data/minimal instructions; model tools and project
context are disabled. The supervisor checks calls, known usage and reservations,
fails closed on unavailable usage/provider failures, cancels owned work, drains
recognition before image cleanup and verifies Dolphin cleanup before En.

The final state distinguishes a completed sequence with per-client errors from
clean completion. Preparation skips and missing counters stay visible. Confirmed
counts remain minima where a started responder has no final counter. Required
report failures/unknown delivery cannot become success and never trigger a
business-action replay. The final report journal retains returned chat/message
IDs. The standard stop command changes only the requested market flag through
the existing SQL adapter; restart recovery requires the dead owner's exact
lease and recorded profile-lock proof and never restarts applications.

## Remaining deployment gates

The actual VDS was not accessed. Its Windows account, checkout/ENV, data source,
Dolphin setup, model login, timezone and existing HH tasks must be inventoried.
Run the shipped first-check there and a small authorized real-HH CAPTCHA canary
before a broad campaign. Verify HH acceptance, continued application/history,
required notifications, cleanup, RDP disconnect and task/reboot behavior on that
host. Synthetic/fixture acceptance is not a claim of real HH acceptance there.

Recent credential/proxy/canonical-account blockers are operational data issues;
they are reported/skipped through the normal lifecycle, not repaired by changing
passwords, buying proxies or disabling students automatically.

`npm audit --package-lock-only` reports the same 21 baseline advisories before
and after the release (3 moderate, 16 high, 2 critical). No new affected package
was introduced and neither new direct dependency was flagged. Existing dependency
debt remains; no unrelated automatic dependency fixes were applied.

See [deployment and rollback](hh-supervised-deployment.md) for the complete
outdated-VDS upgrade, task registration, standard stop and recovery procedure.
