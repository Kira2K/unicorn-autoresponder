# Password-free owner acceptance

This folder contains only the independent owner-PC reopening check used by the
Console live runner. The old cloud-clear comparison runner, 30-second experiment
and desktop-removal control have been removed. The verifier cannot change passwords.
It opens a disposable fixture without a password, checks saved cookie/localStorage,
profile identity and ordinary closure. Metadata-only cleanup cannot pass.

## Prepare the fresh owner PC first

Live operations remain separately authorized. Use a PC that will not perform the
bridge's password removal. Install this checkout, dependencies and Node 24+, open
Octo under VEULink, and configure the existing `OCTO_API_TOKEN` and exact
`OCTO_E2E_OWNER_EMAIL`. Before creating any new fixtures:

```powershell
$env:OCTO_ARCHIVE_OWNER_LIVE = '1'
node --env-file=.env src/features/octo-access/archive-acceptance/owner-cli.mts prepare tmp/owner-preflight.json
```

This reads inventory/account identity and records the machine hash and existing
UUIDs. Copy the preflight to the test controller; keep its original and subsequent
`.ledger.json` on this owner PC. Never delete caches, logs or the ledger to obtain
fresh-device evidence. Do not expose local Octo or CDP ports to the network.

## Console live acceptance

The existing `npm run octo:console:e2e:live` runs two synthetic paused Ru-only
clients through three cycles. It requires a separately prepared, empty Octo scope
in `unicorn_noco_copy_restore`; it refuses the application DB before starting its
worker. It creates/migrates/clears no database automatically. Mock regression tests
need no database. No local Console mode is installed in the ordinary backend.

Configure `OCTO_ARCHIVE_OWNER_PREFLIGHT`, `OCTO_ARCHIVE_HANDOFF_DIR` and
`OCTO_E2E_OWNER_EMAIL` on the controller. Use explicit two-client allowlist scope;
new fixture emails may be supplied as `OCTO_E2E_ALEX_EMAIL` and `OCTO_E2E_BOB_EMAIL`
(`alex.octo.<run>@example.com`, `bob.octo.<run>@example.com`). Existing bindings and
interrupted runs are refused. A failed run's state and profiles remain for inspection.

Use the bridge cleanup adapter for bridge acceptance. Its owner session must be
available independently of the restricted Guest session, and its machine must not
be used as the fresh-owner verifier. Publication still lasts 120 seconds; profiles
remain usable after hiding and are normally closed before cleanup.

For each printed `.request.json`, copy it to the fresh owner PC and run:

```powershell
node --env-file=.env src/features/octo-access/archive-acceptance/owner-cli.mts verify tmp/<id>.request.json tmp/owner-preflight.json
```

Copy the generated `.proof.json` back beside the controller request. Requests
contain synthetic markers and identity digests, no profile password. First restore
requires a new fixture absent from preflight, ledger and previous desktop logs;
later cycles require the next marker. The verifier journals before launch, never
retries unknown starts/stops and exports only bounded errors. Run one command at a
time per ledger. Reports and all private state remain ignored local files.

`npm run octo:archive:test` covers proof identity, freshness, marker requirements,
credential-free start and replay exclusion. A mock pass does not establish fresh-PC
archive recovery. Production activation still requires the complete live acceptance;
existing affected client profiles require separately authorized recovery.
