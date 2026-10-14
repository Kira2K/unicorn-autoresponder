# Octo deletion and checker integration acceptance — 2026-10-14

Passed locally on the real Console backend, PostgreSQL copy, Octo cloud and updated
proxy-checker. This is not a Render deployment.

## Real visible-browser acceptance

`web-console/e2e/octo-deletion-live.e2e.mts` authenticated through the Console form
as the existing paused `Test For Octo Proxy creation` fixture. Two complete UI
creation/access/deletion cycles passed with NodeMaven Tbilisi proxies.

- First cycle created Ru and En; deleting En in Octo automatically removed its saved
  proxy, both DB profile records, events, grant and dependent setup credentials.
- The UI removed the profile and access fields; old profile/grant IDs returned 404.
- Second cycle recreated only missing En, retaining Ru and the client's password.
  Its deletion automatically cleaned the replacement profile and proxy again.
- Final deletion cleaned the remaining Ru profile without a proxy. Total: three
  profiles and two saved proxies removed, no fixture profiles/setup left in DB.
- Other managed profiles, including Kira, remained unchanged in DB and cloud.
  LinkedIn was not opened. No manual SQL cleanup was used to make the test pass.

Safe local evidence: `tmp/octo-deletion-live/report.json` and `clean-console.png`.
The test does not launch Octo desktop windows; timed open-window access is covered
by the earlier live acceptance in `ACCEPTANCE.md`.

## Contracts and recovery

138 tests passed, covering deletion/no proxy, absent/shared/reserved proxies,
duplicate/late events, restored profiles, 30-second retries and persisted budgets,
deletion during pending proxy creation, uncertain outcomes, UI cleanup and checker
unavailability. No startup or periodic cloud presence scan was introduced.

Disposable local PostgreSQL integration passed, including permission migration
rerun, transactional rollback, stale writer rejection and concurrent late-event
cleanup. Migration 003 was separately applied to `unicorn_noco_copy` and verified;
it only grants DELETE permissions and creates no tables or profile archives.

TypeScript and the frontend production build passed. The build retains its existing
large-chunk warning. After restarting the local backend, a real headful Console
login/status smoke passed without creating any profiles.

## Updated checker

OpenAPI/types/client were refreshed from the sibling checker repository. Source
OpenAPI SHA-256: `0298dd672ab8a2a2c31ab268d56f91dd8fc436bf97084cb0d68c72f3439b6447`.
The running API matched the contract. The live request for
`es / basque_country / donostia_/_san_sebastian` returned Spain,
`Donostia / San Sebastian`, matching location, score 78. No substitute city was used.
Safe report: `tmp/octo-deletion-live/geography-report.json`.

Unavailable local checker/configuration now shows an installation link to
`https://github.com/Kira2K/unicorn-proxy-checker` and blocks new proxy setup.
Recovery and production/Render suppression are tested. The health probe runs from
existing status/start requests, is cached, and has a two-second timeout.

Render still needs an authenticated checker URL reachable from its backend.
Deletion events outside Octo's available replay history cannot be discovered by
this event-only approach; continuous cloud polling remains intentionally absent.

The prepared PR tree also passed TypeScript, build and disposable PostgreSQL tests.
Its UI fixture initially timed out during a cold Vite page load; a separate rerun
passed without code changes. The other 137 tests passed on the first isolated run.
