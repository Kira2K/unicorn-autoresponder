# Octo access experiments

## Cloud-only manual-close experiment

`node --env-file=.env src/features/octo-access-test/cloud-experiment.mts --grant Alex` runs the existing workflow with **all desktop API calls forbidden**. It does not expose an HTTP server or start/stop browsers. Open the published `John Doe …` profile manually in Octo with the fixture password `Alex`. **This manual experiment starts its 45 seconds on receipt of the first cloud launch event**, giving the user time to open the window. Before that it persists `awaiting_start`. Later launch events never extend the deadline. The normal timed backend still counts from publication. The worker restores original metadata/private folder on expiry, keeps the password, and remains running while the user decides when to close the browser normally.

The cloud-only mode requires the current grant's `profiles.started` followed by `profiles.stopped`, plus cloud status zero and private-folder readback, before removing the password. It never interprets status zero alone as a normal close. A new start invalidates the previous stop; force-stop prevents cleanup. Busy rejections can be retried using the saved normal-close evidence. Missing history leaves protection in place. The earlier local-mode fallback has different acceptance checks and is retained separately.

The experiment uses `storage/octo-access-test/cloud-state.json` and its own process lock. Run without `--grant` to resume the watcher after a graceful shutdown. It reuses the workflow, API adapter, Action Log listener, atomic store and fixture identifiers. Every REST request is restricted to `https://app.octobrowser.net/api/v2/automation/`; sanitized request paths/statuses and cloud readbacks are written to `logs/octo-access-test/cloud-manual-<run-id>/events.jsonl`. No passwords or tokens are logged. `cloud-manual-latest.json` points to the current run. Final password removal is confirmed by `phase: complete` and a cloud readback of `has_user_password: false`.

### Live manual-close acceptance: 2026-10-12

Run `957b529e-fdc4-4cba-93fc-33993905af13` passed for Alex using only the cloud REST API and Action Log WebSocket. The user opened `John Doe bc04e7f9` manually. Receipt of `profiles.started` at 19:47:35.430 Asia/Tbilisi started the 45-second timer. The folder move was acknowledged at 19:48:22.168; readback confirmed original name `Alex`, private `octo-test-main`, cloud status `1`, and password still set. The browser was left open for the user.

After the user closed it herself, event `856796dc-1dff-4ce3-b585-25968c7518af` (`profiles.stopped`) triggered the background handler. Cloud `clear_password` returned HTTP 200 at 19:51:56.567. The grant became `complete` with `lastTrigger: event`; readback confirmed status `0` and `has_user_password: false`. An independent cloud-only GET at 19:52:11 confirmed the result and Bob's unchanged original, stopped, unprotected state. The assistant issued no clear/start/stop call in response to the user's final "closed" message; it only read the result. There were zero desktop/localhost API requests and zero force-stop calls in this run.

The preceding attempt `0db78027-b58b-4e5a-b51e-8c09a8f16fdd` expired before the user opened the window, so it did not validate an open-browser handoff. After she confirmed it had never opened, that exact fixture grant was restored through a separately journaled cloud-only cleanup. The repeat used the explicit manual-experiment deadline measured from launch. Neither run establishes arbitrary new-password rotation or independent-device data synchronization.

Evidence: `logs/octo-access-test/cloud-manual-957b529e-fdc4-4cba-93fc-33993905af13/events.jsonl` and `storage/octo-access-test/cloud-state.json` (ignored local files). The cloud watcher remains running with this grant complete.

## Current local mode: hide after 45 seconds, clear after ordinary close

Run `npm run octo:timed:serve` with Node 24+, `OCTO_API_TOKEN` in the root `.env`, and the local Octo application available on `127.0.0.1:58888`. For the Guest test, sign into `kind.cute.unicorn@gmail.com` in Octo. The terminal backend listens on **127.0.0.1:58890**.

This mode adopts **only the existing Alex/Bob fixture IDs** from `storage/octo-access-test/state.json`. It does not create profiles or modify Guest permissions. Its journal is separate: `storage/octo-access-test/timed-state.json`. The old blocked handoff journal is retained unchanged.

```powershell
npm run octo:timed:serve
# In another terminal:
$octoTimed = 'http://127.0.0.1:58890'
Invoke-RestMethod "$octoTimed/setup" -Method Post -ContentType 'application/json' -Body '{}'
Invoke-RestMethod "$octoTimed/grant" -Method Post -ContentType 'application/json' -Body '{"profile":"Alex"}'
Invoke-RestMethod "$octoTimed/start" -Method Post -ContentType 'application/json' -Body '{"profile":"Alex","password":"Alex"}'
Invoke-RestMethod "$octoTimed/grant" -Method Post -ContentType 'application/json' -Body '{"profile":"Bob"}'
Invoke-RestMethod "$octoTimed/start" -Method Post -ContentType 'application/json' -Body '{"profile":"Bob","password":"Bob1"}'
Invoke-RestMethod "$octoTimed/status" | ConvertTo-Json -Depth 8
Invoke-RestMethod "$octoTimed/inspect" | ConvertTo-Json -Depth 8
```

- Each grant gets a random `John Doe …` name and an independent, persisted 45-second deadline. A repeated active grant returns the existing grant without extending its deadline. `setup` validates existing folders; it creates nothing.
- On expiry, the timer moves the profile into `octo-test-main` and restores its original metadata. An open browser keeps running with its password. State becomes `awaiting_close`.
- Close the browser normally whenever finished. The owner-authenticated [Octo Action Log WebSocket](https://github.com/octobrowser/documentation/blob/main/api/action-log.md) supplies `profiles.stopped`. The backend verifies private-folder membership, original metadata, cloud status zero, and absence from the local running list, then clears the password through the **cloud** API. Readback must confirm success before state becomes `complete`.
- Every 30 seconds, a fallback check reconciles waiting profiles in case an event was missed. Definite password/busy rejections stay pending; uncertain write results block that grant for review. Recovery can confirm an already-applied clear or folder move without replaying the write. A known force-stop event blocks password cleanup.
- The backend never stops browsers. Timers, API requests, and events share a serial mutation queue. Alex and Bob have separate deadlines and states. The event cursor and bounded duplicate history survive a restart. After a downtime longer than the 24-hour event history, current-state checks provide fallback; history cannot prove how an old browser was closed.
- The backend must be running for timers/events to execute. After a graceful stop/restart it resumes persisted work. A process crash leaves a lock; verify that its PID is no longer alive before removing **only** `storage/octo-access-test/timed-state.json.lock`. Do not remove the journal to bypass a blocked operation. There is no HTTP override or force-cleanup endpoint.

This remains a local fixture experiment. Alex=`Alex` and Bob=`Bob1` are the previously verified test passwords; new random passwords are not implemented here because the earlier archive-decryption experiment did not pass. Cross-device synchronization and the full Console/Render deployment are separate acceptance work. The local running-state check also requires the Octo desktop to remain available. A stop event plus successful password removal does not independently prove a complete cloud data sync.

Implementation reuses the existing cloud/local adapter, terminal HTTP routes, atomic file store, process lock, and fixture contracts. New modules are `timed-workflow.mts` (lease/cleanup transitions), `action-log.mts` (stream adapter), and `timed-server.mts` (composition and periodic checks). Run `npm run octo:test` for mock regression tests.

### Live HTTP acceptance: 2026-10-12, 15:16–15:17 UTC

Run `0b43db61-d1ea-4e04-bc9c-14a90a688bfe` passed on the restricted Guest desktop. The driver issued `/setup`, `/grant`, `/start`, `/status`, and `/inspect` against this new backend on port 58890. Grant and cleanup writes were performed by the backend, not the driver. The driver only simulated ordinary user closes after both expiry proofs.

| Check | Alex | Bob |
|---|---|---|
| Other fixture's password rejected; correct password opened browser | Passed | Passed |
| Independent 45-second deadline, anonymous name | Passed | Passed |
| Expiry readback: private folder, original name, still protected and running | Passed (deadline +1.25 s) | Passed (deadline +1.24 s) |
| Local storage and cookie written/reloaded before and after expiry | Passed | Passed |
| Backend restart preserved lease IDs/deadlines; stream reconnected | Passed | Passed |
| Normal close → `profiles.stopped` → automatic cloud password clear | Passed; trigger=`event` | Passed; trigger=`event` |
| Final cloud state: original metadata, private folder, stopped, no password | Passed | Passed |

Closing/clearing Alex left Bob running and protected. Guest permissions remained unchanged. Force-stop calls: **zero**. The complete run took about 80 seconds; delayed closure after an actual hour was not separately exercised. The restart check stopped/recreated the backend runtime and reloaded its file journal within the driver process; it was not an operating-system reboot test. Independent-machine cloud data sync remains unverified.

Sanitized evidence: `logs/octo-access-test/deferred-backend-0b43db61-d1ea-4e04-bc9c-14a90a688bfe/events.jsonl` and `result.json` (ignored local diagnostics). Reproduction driver: `logs/octo-access-test/deferred-backend-validation.mts` (explicit live fixture mutations; do not run alongside the backend).

## Historical handoff experiment (120 seconds; separate old mode)

Backend-only experiment for the main Octo account. It does not integrate with the console, clients, Dolphin, or business authentication. Guest permissions and isolation between separate users/machines are outside this experiment.

## Contract

- `POST /setup` creates two new Windows profiles, Alex and Bob, without passwords, in a new `octo-test-main` folder. It also creates the empty `g-folder`. Wikipedia search start pages distinguish Alex and Bob. Local storage is enabled for the save check.
- `POST /grant` with `{"profile":"Alex"}` protects Alex with `Alex`, changes its title to `John Doe`, and moves it into `g-folder`.
- A different grant is rejected with HTTP 409 until at least 120 seconds after the preceding successful grant. There is no timer, automatic expiry, or automatic switch. Requesting the currently granted profile is a no-op and does not restart its guarantee.
- `POST /grant` with `{"profile":"Bob"}` after the guarantee restores Alex's name, moves it into `octo-test-main`, and clears its password. It protects Bob with `Bob1` before publishing Bob as `John Doe` in `g-folder`. The guarantee begins again after the complete handoff is verified.
- The backend never stops profiles. Alex may remain open while Bob is granted. Before granting a previously used profile again, close that target normally and let it sync; a locally running destination is rejected.
- Password removal uses `DELETE /api/profiles/password` on the **local Octo client**, which owns the running session. In the 2026-10-12 live check, the cloud password-clear endpoint returned `400 profiles.password_error` / `Profile was started by another user`; the local endpoint cleared the password while Alex remained open. This is a same-machine solution, not proof of remote Guest handoff.
- `POST /start` forwards the password supplied by the caller to the local Octo client. It does not fill in or correct passwords. An already-running profile is rejected because it cannot demonstrate a fresh password check.
- `GET /status` reads saved test state. `GET /inspect` also reads current cloud metadata and local running state, exposing only the two test profiles. Neither endpoint mutates anything.

Only profile IDs created by this setup are eligible for operations. Their ownership marker is checked before later operations. Existing resources named `g-folder` or `octo-test-main` cause setup to fail, rather than being adopted. All existing account profiles remain outside scope.

## Run

Requires Node.js 24+, the owner token in the repository root `.env` as `OCTO_API_TOKEN`, and Octo logged into the same main account on this Windows machine. Its local API must respond on `127.0.0.1:58888`.

```powershell
npm run octo:test
npm run octo:test:serve
```

Starting the server does not create or edit Octo resources. The terminal API listens only on `127.0.0.1:58889`; `OCTO_TEST_PORT` can override the port. It rejects browser Origin headers and non-local Host headers. No owner token is returned by this API. The two intentionally simple profile passwords are test data, not production credentials.

In a second PowerShell terminal:

```powershell
$octoTest = 'http://127.0.0.1:58889'
Invoke-RestMethod "$octoTest/setup" -Method Post -ContentType 'application/json' -Body '{}'
Invoke-RestMethod "$octoTest/inspect" | ConvertTo-Json -Depth 8
Invoke-RestMethod "$octoTest/grant" -Method Post -ContentType 'application/json' -Body '{"profile":"Alex"}'

# This must fail while Alex is stopped and password-protected.
Invoke-RestMethod "$octoTest/start" -Method Post -ContentType 'application/json' -Body '{"profile":"Alex","password":"wrong"}'

# This opens Alex; keep its window open during the handoff.
Invoke-RestMethod "$octoTest/start" -Method Post -ContentType 'application/json' -Body '{"profile":"Alex","password":"Alex"}'
Invoke-RestMethod "$octoTest/status"

# Before remainingSeconds reaches zero: expect HTTP 409 and no changes.
# Once it reaches zero: repeat this same explicit request to switch.
Invoke-RestMethod "$octoTest/grant" -Method Post -ContentType 'application/json' -Body '{"profile":"Bob"}'
Invoke-RestMethod "$octoTest/inspect" | ConvertTo-Json -Depth 8

# Alex's password must not open the stopped Bob profile.
Invoke-RestMethod "$octoTest/start" -Method Post -ContentType 'application/json' -Body '{"profile":"Bob","password":"Alex"}'
Invoke-RestMethod "$octoTest/start" -Method Post -ContentType 'application/json' -Body '{"profile":"Bob","password":"Bob1"}'
```

You can also open the profiles manually in Octo. Seeing other profiles as the owner is expected. `g-folder` should contain only the current `John Doe`. The outgoing profile should have its original name and no password in `octo-test-main`.

## Manual acceptance

1. Confirm setup produces two unprotected profiles and their different Wikipedia start pages.
2. Confirm wrong/missing passwords reject a fresh launch of the protected profile, and the correct password succeeds. Do not use an already-open window as evidence.
3. Confirm an early switch fails and does not alter either profile. Leaving the API idle after 120 seconds must do nothing; restarting the backend must retain the original grant/deadline.
4. With Alex still open, grant Bob and confirm Alex remains usable. Verify restored Alex metadata, Bob's alias/password, and the Wikipedia identities.
5. **After the handoff**, open Developer Tools in Alex's Wikipedia tab and run:

   ```javascript
   localStorage.setItem('octo-handoff-proof', 'alex-after-bob');
   ```

   Record Alex's cloud `version` from `/inspect`, close Alex normally, and wait for Octo to finish saving. Treat the version as diagnostic metadata: the API returned `"0"` before and after normal closes in the Guest test, so an increment is not a usable acceptance check. Reopen Alex without a password using `POST /start` with `{"profile":"Alex"}`, return to the same Wikipedia origin, and check `localStorage.getItem('octo-handoff-proof')` returns `alex-after-bob`. A same-machine cached value alone is not evidence of cloud saving; verify the marker on an independent device or in an independently restored cloud export.

The 2026-10-12 live API run verified running-profile rename/move, **local** password clearing, and both browsers remaining open after handoff. **Subsequent cloud saving remains unverified** until step 5 passes. Mock tests alone prove backend control flow only. Fail the experiment if Alex closes unexpectedly, password clearing is rejected, data does not save, or a wrong password launches a protected, stopped profile. Even a successful single-machine experiment does not prove Guest access isolation.

## Live API result: 2026-10-12

Executed against the real Octo cloud API and the logged-in Windows client, using only the two newly created test profiles:

| Check | Result |
|---|---|
| Setup creates two unprotected profiles; repeated setup returns the same IDs | Passed |
| Grant Alex, reject wrong password, start with `Alex` | Passed |
| Reject an immediate Bob grant; remain on Alex after 120 seconds without a switch request | Passed |
| Clear running Alex's password through the cloud endpoint | Failed: HTTP 400, `profiles.password_error`, `Profile was started by another user` |
| Clear running Alex's password through the local endpoint | Passed; Alex remained open |
| Corrected complete backend handoff after restoring the Alex baseline, retaining its original grant time | Passed |
| Alex restored to its name/home folder without a password; Bob published as `John Doe` with a password | Passed |
| Bob rejects `Alex` and opens with `Bob1` | Passed |
| Alex and Bob both still running after the handoff | Passed |
| Post-handoff changes survive normal close and cloud synchronization | Not tested yet |

The failed cloud attempt was kept in the audit. Recovery was explicit: restore Alex's password through the local API and its alias/folder through the cloud API, verify the complete baseline, preserve the failed journal, restart the corrected backend with the original grant timestamp, then call `/grant` again. No browser was stopped or force-stopped.

Local evidence: `logs/octo-access-test/live-20261012.json` and `logs/octo-access-test/failed-cloud-handoff-state-20261012.json` (ignored runtime artifacts). The test backend was left running on port 58889 with Bob granted and both test browsers open. This is a same-machine result; the original remote Guest workflow still needs separate validation.

## Restricted Guest API result: 2026-10-12

The permanent Guest's permissions were changed through the owner API and verified by readback: only `g-folder` is visible; all profile/password/proxy/template/tag/folder/team/task management permissions are disabled. The local Octo client was logged in as Guest. Only Alex and Bob were modified.

| Real API check | Result |
|---|---|
| Guest starts private Alex, or previously cached Bob after Bob returns to the private folder | Rejected |
| Guest starts visible Bob without a password or with a wrong password | Rejected |
| Guest starts visible Bob with `Bob1` | Passed |
| Guest sets or clears a profile password | Rejected: `profiles.password_permission` |
| Owner changes or clears Bob's password while Guest runs it | Rejected: `profiles.password_error`, `Profile was started by another user` |
| Existing backend `/grant Alex` under the restricted Guest | Failed at local `clear_password:Bob`; the journal became blocked |
| Explicit fallback: return running Bob home, keep its password, protect/publish Alex | Passed |
| Bob reloads and writes cookies/local storage after losing folder access | Passed |
| Old Bob password cannot start Alex; correct Alex password starts it while Bob remains open | Passed |
| Guest normally closes hidden Bob; owner then clears its password | Passed |
| Regrant/reopen Bob after cleanup: post-handoff cookie and local-storage markers survive | Passed on the same machine |
| Independently verify the saved cloud data | Unverified: cloud export returned `no_tokens`; no second device was used |

The fallback was exercised through an audited local validation script, **not implemented in the test backend**. The current backend's local password-clearing strategy requires permissions the restricted Guest must not have. Do not enable Guest password management to make that strategy pass. The backend remains blocked to prevent replaying the failed handoff; its original failure and the explicit fallback steps are preserved.

Final observed state: both test browsers normally stopped; Alex is unprotected in `octo-test-main`; Bob is password-protected as `John Doe` in `g-folder`. Guest permissions remain restricted. No force-stop, account recreation, or profile deletion was used.

Local evidence: `logs/octo-access-test/guest-validation-20261012.jsonl`, `guest-deferred-state.json`, and `guest-proof.json`. The current grant timestamp is in the deferred-test evidence; the blocked backend journal is not a current successful-grant record.

Production acceptance still requires independent cloud-persistence proof and durable, owner-side cleanup after normal close. Immediate password reset while another user runs the profile failed and must not be represented as supported.

## Fixed 20-minute API experiment: 2026-10-12

This is a separate, disposable integration experiment; the original 120-second backend above remains blocked. The real Octo 3.1.3 Windows client was signed in as restricted Guest. Only the existing Alex/Bob fixtures were used. No production grant endpoint or expiry worker was implemented.

Each profile received a different random alias and a unique 32-character password. Description, tags and start pages were masked before publishing to `g-folder`. Both grant deadlines were exactly 1,200,000 ms after their respective publish acknowledgements. Alex's first launch failed; the runner was resumed with the **same** password and original deadline. Neither grant was extended or manually expired.

| Real API check | Result |
|---|---|
| Owner sets both random passwords, publishes two anonymous profiles, and reads back protection/metadata | Passed |
| Guest starts either profile with its new password | **Failed**: HTTP 400 `profiles.invalid_password`, error code 13; repeated minutes later |
| Old fixture passwords or the other profile's password launch a profile | Rejected |
| Alex automatically returns home after its full 20 minutes | Passed: deadline 12:34:57.286 UTC; completed 12:34:57.828 UTC (+542 ms) |
| Alex's expiry leaves Bob's alias, protection, folder and original deadline unchanged | Passed by independent cloud readback |
| Bob automatically returns home after its own full 20 minutes | Passed: deadline 12:36:58.992 UTC; completed 12:36:59.550 UTC (+558 ms) |
| Owner automatically clears passwords on the stopped, expired profiles | Passed for both |
| Guest starts expired profiles with no password, the expired password, or the old fixture password | Rejected; no-password requests returned `profiles.start_failed`, password requests `profiles.invalid_password` |
| An already-open browser is terminated by this timed expiry | Not tested in this run: neither new-password launch succeeded. The earlier Guest test showed folder removal leaves a running browser usable |
| Profile data survives random-password rotation and independent cloud restore | **Not established** |

Client logs distinguish the password failure stages: the new passwords proceed past initial verification into profile preparation, then `unpack_profile_archive` / `unpack_archive` raises `InvalidProfilePasswordException`. Downloading the archive also does not complete preparation. Old passwords fail earlier in the local API router. This suggests an archive/password mismatch after rotation; the precise cause is unconfirmed, and there is no evidence that password length caused it. A successful cloud password response is insufficient acceptance evidence: a real launch and saved-data read must succeed before delivering a grant.

Final cloud readback: Alex and Bob are stopped, in `octo-test-main`, under their original names/descriptions/start pages, with `has_user_password=false`. `g-folder` is empty and Guest permissions remain restricted. This verifies metadata cleanup, **not** successful owner reopening or archive recovery. Keep the original and generated test passwords available for recovery; do not delete cached profile data to work around the failure.

Evidence is in ignored `logs/octo-access-test/timed-20m-d76ebfb5-3c27-43af-93ad-d079c452302f/`: `events.jsonl`, `diagnostic.jsonl`, and credential-free `password-failure-evidence.json`. **`state.json` contains generated test passwords and must not be shared or committed.** The disposable runner is `logs/octo-access-test/timed-20m-validation.mts`; it requires a live process and is not a durable production scheduler. Its `test_complete` event means the experiment/cleanup completed, not that every acceptance condition passed. In particular, `passwordsCleanedAfterNormalClose=true` records successful cleanup but these two browsers never opened during this run.

That experiment also considered stopping running browsers. The subsequent user clarification below removes browser termination from acceptance; an already-open browser continuing to work is expected. Independent-device persistence remains unverified.

## Concurrent two-minute Guest test: 2026-10-12

The user clarified the required behavior: two simultaneous, non-conflicting profile grants; each is renamed, password-protected, published, and opened; after its own two-minute timer its name/folder are restored and its password should be removed. Already-open browsers should remain usable. This test used the existing fixtures and the previously agreed distinct passwords `Alex` / `Bob1`, with new random aliases. **It did not retest random password rotation.**

The real cloud API and restricted Guest local API were exercised. Alex's grant ran from 12:48:14.969 to 12:50:14.969 UTC; Bob's from 12:48:45.378 to 12:50:45.378 UTC. Each deadline was 120,000 ms after publication; no deadline was extended.

| Real API/browser check | Result |
|---|---|
| Rename, protect, and publish both profiles concurrently | Passed; cloud readback confirmed distinct aliases and protection in `g-folder` |
| Open both with their own passwords; reject the other profile's password | Passed |
| Both browsers run concurrently with separate cookie/local-storage markers | Passed |
| Bob retains the saved marker from the earlier Guest test | Passed on the same machine |
| Automatically restore Alex's name/metadata and private folder after two minutes | Passed; completed +319 ms after its deadline |
| Alex's expiry leaves Bob's name, password, folder, deadline and open browser unchanged | Passed |
| Automatically restore Bob after its own two minutes | Passed; completed +353 ms after its deadline |
| Each open browser retains its marker, accepts further data writes, and reloads after folder removal | Passed |
| Remove each password immediately while restricted Guest still runs that profile | **Rejected** by owner cloud API (`profiles.password_error`) and Guest local API (`profiles.password_permission`) |
| Normally close each test browser, then clear its password through owner cloud API | Passed for both |
| Guest reopens a private, unprotected fixture after cleanup | Rejected for both |

Both browsers were left running until **both** timed expiries and post-expiry browser checks finished. Only then were they normally closed for test cleanup. No force-stop or Guest permission change was used. Final readback: both stopped, original names/metadata in `octo-test-main`, password flags cleared, `g-folder` empty, Guest still restricted.

The concurrent flow works with the tested passwords and **deferred password removal**: restore name/folder at expiry, preserve the open session, then have an owner-side worker clear the password after a normal close. Immediate removal while Guest runs the profile is the remaining mismatch with the exact requested sequence. The earlier main-account local-clear result does not apply to restricted Guest. This test exercises that deferred cleanup directly; it does not add a production background worker.

The previous random-password launch failure is still unresolved. Restoring the original fixture passwords allowed both archives to open, so the data was readable again with those passwords. This does not establish arbitrary password rotation, password-free owner reopening, or independent-device cloud persistence.

Evidence: ignored `logs/octo-access-test/concurrent-2m-03b1b02f-95d9-4f4f-879a-41c089454b88/events.jsonl` and `diagnostic.jsonl`. Disposable runner: `logs/octo-access-test/concurrent-2m-validation.mts`. The old 120-second handoff backend remains blocked; the experiment does not change its behavior.

## Force-stop prerequisite test: 2026-10-12

The user requested one additional real force-close test before implementing the Console/Render feature, with an explicit instruction to stop and report on failure. The existing concurrent runner was reused with `--force-close`; only the original Alex/Bob fixtures were changed. The Windows client remained signed in as restricted Guest. No production implementation, client database changes, deployment, or PR followed this test.

Alex was published at 14:15:15.009 UTC with a deadline of 14:17:15.009; Bob at 14:15:45.311 with a deadline of 14:17:45.311. Both opened with their agreed fixture passwords, rejected each other's passwords, and held separate cookie/local-storage markers. This run did not retest arbitrary random password rotation.

| Real API/browser check | Result |
|---|---|
| Concurrent anonymous, protected grants and real Guest launches | Passed for Alex and Bob |
| Restore Alex's name/metadata and private folder after its two-minute deadline | Passed; completed +344 ms after expiry |
| Owner cloud `POST /profiles/{Alex UUID}/force_stop` with `version: null`, before password removal | HTTP 200; cloud status became inactive (`0`) |
| Force-stop actually closes Alex on the Guest machine | **Failed**: local API still listed Alex as running; CDP remained reachable and read the marker written immediately before force-stop |
| Alex's force-stop changes Bob's active grant/browser | No; Bob retained its alias, folder, protection, deadline, and running browser |
| Clear Alex's password immediately after force-stop while its browser is still open | Not attempted: the prerequisite failed and the experiment stopped |
| Preserve/synchronize the active version after cloud force-stop | Not established by this experiment; the documented behavior explicitly excludes the running version from synchronization |

The cloud operation is a server status reset, not a remote browser close. [Octo's force-stop documentation](https://docs.octobrowser.net/en/profiles/edit-profiles/#force-stopping-a-profile) states that the current window remains open and its running version/further work will not synchronize. HTTP 200 therefore does not meet the requested close-and-preserve-data prerequisite. Local `/api/profiles/stop` was used only for cleanup on this Windows machine; it is not evidence that Render can close a remote client's browser.

After the failed gate, Alex was normally closed and its password cleared. A local Windows `EPERM` on the atomic journal rename then interrupted fixture cleanup before Bob's expiry action. Independent readback reconciled the outcome: Alex was already restored, stopped, and unprotected; Bob remained granted and running. Cleanup was explicitly resumed using the same run/deadlines and the existing cleanup functions (`--force-close --cleanup-only`), without repeating force-stop or issuing new grants. Bob returned home at approximately 14:18:31 UTC, **about 46 seconds after its deadline**, then normally closed and had its password cleared. This is a failed run, not a successful two-minute expiry test.

Final readback verified both fixtures stopped, unprotected, and restored to their original names/descriptions in `octo-test-main`; `g-folder` was empty and Guest permissions unchanged. Guest launch attempts for the private profiles were rejected. No unrelated profile was modified. Cleanup restores metadata and access state; it does not prove preservation of Alex's cloud data after force-stop. A private pre-force cookie/local-storage snapshot was saved locally for fixture recovery.

Evidence: ignored `logs/octo-access-test/force-close-2m-fde812a5-0072-4c45-bae2-6c31379608c8/events.jsonl` and `diagnostic.jsonl`. The run remains `blocked` despite successful cleanup. The original handoff backend also remains blocked. The conditional Console/Render implementation and full UI acceptance test were not started, and no PR was created.

## Password changes without normal close, 45-second test: 2026-10-12

The user explicitly requested continuing past the earlier force-close failure to verify password changes **without ordinary browser closing**, and reduced the test timeout from 120 to 45 seconds. The existing concurrent runner was reused with `--force-passwords`. This mode forbids both local `/api/profiles/stop` and local `/api/profiles/force_stop`, including during cleanup. Each grant lasts 45,000 ms from publication; Bob is published 15 seconds after Alex. This changes this experiment only, not a production lease duration.

The restricted Guest opened both original fixtures with their agreed passwords. At each deadline the owner API restored the fixture's original metadata/private folder, called cloud `force_stop`, directly changed the password via `set_password` with `old_password`, checked that the old password could no longer clear protection, and cleared protection with the new password. Separate random 20-character passwords were generated and retained only in the ignored local state file for recovery.

| Real API/browser check | Alex | Bob |
|---|---|---|
| Publication / 45-second deadline (UTC) | 14:23:31.969 / 14:24:16.969 | 14:23:47.143 / 14:24:32.143 |
| Restore original metadata and private folder at expiry | Passed, +329 ms | Passed, +308 ms |
| Cloud force-stop while local browser remains open | HTTP 200 | HTTP 200 |
| Change original password to a new random password without closing | HTTP 200 | HTTP 200 |
| Clear protection with the old password after rotation | Rejected: HTTP 400 `profiles.password_error` | Rejected: HTTP 400 `profiles.password_error` |
| Clear protection with the new password, still without closing | HTTP 200; protection flag became false | HTTP 200; protection flag became false |
| Read existing marker, write new cookies/local storage, reload after rotation | Passed | Passed |
| Other fixture's metadata, protection, deadline, and running browser unaffected | Passed | Passed |

The narrow **cloud password-change/removal test passed for both profiles without any ordinary close**. Audit of all mutation events found zero local stop/force-stop calls, exactly two cloud force-stop calls, and mutations for Alex/Bob only. The cloud reported both inactive, while the local API/CDP confirmed both browsers remained running throughout the changes.

Independent final readback at 14:25:17.788 UTC verified both original names/descriptions/tags/start pages and `octo-test-main`, no profile passwords, and unchanged restricted Guest permissions. `g-folder` was empty. **Both test windows were deliberately left open**; no normal-close cleanup was performed.

This result establishes that cloud force-stop removes the restriction that previously prevented owner-side password changes while Guest was running the profile. The old/new password check here used the cloud clear-password endpoint; **it does not establish that a fresh browser launch can decrypt the archive with the new password**. The earlier random-password launch failure remains unresolved. The test also does not establish cloud preservation of current session data: [Octo documents](https://docs.octobrowser.net/en/profiles/edit-profiles/#force-stopping-a-profile) that force-stop leaves the window open but excludes its current version/further work from synchronization. Successful credential mutation therefore does not validate the full production workflow.

Evidence: ignored `logs/octo-access-test/force-passwords-45s-951979f6-4b4b-4648-9d6f-be3f2c21bc51/events.jsonl` and `diagnostic.jsonl`. Its `state.json` contains generated passwords; do not commit or share it. Private pre-force storage snapshots are retained for fixture recovery. No Console/Render implementation, client database changes, UI authentication acceptance, deployment, or PR was performed in this run.

## Moving running profiles out of the Guest folder, 45-second retest: 2026-10-12

The user requested validating the deferred-password-removal approach and reported closing the previous test windows. Read-only preflight at 14:43:39.904 UTC confirmed both original fixtures stopped, unprotected, with restored metadata in `octo-test-main`. This run started fresh Guest browser sessions; it did not reuse the earlier force-stopped windows.

The existing runner was reused with `--deferred-folder`: independent 45,000 ms grants, staggered by 15 seconds, using the agreed fixture passwords. Both cloud and local force-stop calls are forbidden in this mode. After each expiry, `PATCH /profiles/{uuid}` moves the running profile from `g-folder` to the private `octo-test-main` folder and restores its original metadata. Password removal is deliberately deferred until normal close.

| Real API/browser check | Alex | Bob |
|---|---|---|
| Fresh Guest launch with correct password; other fixture password rejected | Passed | Passed |
| Publication / 45-second deadline (UTC) | 14:45:18.622 / 14:46:03.622 | 14:45:33.979 / 14:46:18.979 |
| Move an open profile out of `g-folder` via owner cloud API | HTTP 200; completed +470 ms after expiry | HTTP 200; completed +499 ms after expiry |
| Independent profile GET after move | Private folder, original name, password retained, cloud status still running (`1`) | Private folder, original name, password retained, cloud status still running (`1`) |
| Local browser remains running; old marker readable, new cookies/local storage written and page reloaded after move | Passed | Passed |
| Alex's removal leaves Bob's alias, protection, folder, original deadline and browser unchanged | Passed | Control profile remained intact |
| Normally close the hidden profile, then read cloud status inactive (`0`) | Passed | Passed |
| Owner clears password after normal close | HTTP 200 | HTTP 200 |
| Guest starts the now-private, unprotected profile | Rejected: HTTP 400 `profiles.start_failed` | Rejected: HTTP 400 `profiles.start_failed` |

Both browsers remained open until both expiry and post-move browser checks completed. Only then did the test issue the two normal-close requests for fixture cleanup. Audit confirmed **zero force-stop calls**, two normal closes, and mutations to Alex/Bob only. Final independent readback confirmed both fixtures stopped, unprotected, with all original metadata restored; `g-folder` was empty and Guest permissions remained restricted.

This proves API removal of a **running** profile from the Guest-visible folder and deferred password clearing after normal close. The operation was a move into a known private folder, not deletion of a folder/profile and not a test of `folder: null`. The Guest desktop list's visual refresh was not tested. Cloud status, metadata, browser continuity, and post-close launch denial were checked through real APIs. Independent-device cloud persistence and arbitrary random-password archive rotation remain unverified.

Proposed production flow: a durable expiry job moves the profile private and records `awaiting_normal_close`; it retains the current profile password while the browser runs. After normal closure/synchronization, an owner-side job clears the password. Do not force-stop merely to finish password cleanup. Another profile can be granted immediately; the same profile cannot be treated as available for a second concurrent normal launch while the original session remains active. This experiment does not implement that production worker.

Evidence: ignored `logs/octo-access-test/deferred-folder-45s-f99d1ba1-cef3-4998-8f53-09a8558f2d20/events.jsonl` and `diagnostic.jsonl`. No production client data, Console/Render implementation, deployment, or PR was changed.

## Action Log connectivity and stop events: 2026-10-12

To assess automatic password cleanup after a later client close, a read-only probe connected to the documented owner WebSocket `wss://app.octobrowser.net/api/v2/automation/ws/action_log` with the existing API token and `from_timestamp` for the preceding two hours. **The real connection succeeded** and returned a historical event page. The sanitized result includes `profiles.started` and normal `profiles.stopped` events for both fixtures from the fresh folder-removal retest, plus distinct `profiles.force_stopped` events from the earlier experiments.

This verifies availability of Action Log on the current account and receipt of genuine previous fixture events. No new browser launch/close or password mutation was performed during the probe. It does not yet test a deployed Render listener, automatic password clearing triggered by an event, replay with `after_uuid`, or the timing of `profiles.stopped` relative to completion of archive synchronization. The probe intentionally ends after 15 seconds; its recorded WebSocket close code `1006` follows local `terminate()` and is not a failed authentication/handshake.

The production proposal is an owner-side background listener: after expiry has moved a profile private, persist `awaiting_normal_close`; a matching normal-stop event schedules reconciliation of that same grant, checks current profile state, and clears the recorded password when permitted. Force-stop events must not be accepted as normal closure. Use a durable cursor and per-profile/grant coordination so old/replayed events cannot clear a newer grant's password. Periodic checks of waiting profiles cover disconnected listeners and the documented 24-hour event retention. The listener is not implemented by this probe.

Evidence: ignored `logs/octo-access-test/action-log-probe-latest.json`; runner `logs/octo-access-test/action-log-probe.mts`. Only fixture event IDs, actions, timestamps, and fixture names were retained; no raw event payloads, actor emails, proxy information, or API tokens were saved. References: [Octo Action Log](https://blog.octobrowser.net/action-log-api-how-clients-use-profile-events-in-their-own-workflows), [API contract](https://github.com/octobrowser/documentation/blob/main/api/action-log.md).

## Persistence and interrupted requests

State is saved under ignored `storage/octo-access-test/state.json`. It contains the exact test IDs, ownership marker, active grant, timestamp and current step. It never stores the owner token. Repeating setup after success reuses this state and does not create profiles again.

Each external operation is journaled before it is sent. Any failed/uncertain handoff or interrupted operation blocks further mutations, with the exact last step available from `/status`. No retry, rollback, force-stop, or cleanup is automatic. A setup timeout can mean Octo created a resource even if its ID was not returned: retain the state file and inspect Octo before trying again. Never delete state to bypass this protection.

A process lock prevents two servers from controlling the same state. Ctrl+C releases it after in-flight requests finish. After a crash, check the PID in `state.json.lock`; remove that lock only after confirming the old process has exited. Keep `state.json`: a `working` or `blocked` phase requires manual reconciliation even after the lock is cleared.

There is deliberately no cleanup/delete endpoint. Close and sync the test profiles before removing them manually, using the UUIDs recorded in state. Do not remove unrelated profiles or folders.

## Modules and validation

`contract.mts` defines inputs/errors and the Octo adapter boundary. `workflow.mts` owns grants and the guarantee. `octo-api.mts` translates documented cloud/local requests without retries. `store.mts` handles atomic state writes and the process lock. `http.mts` exposes the local terminal API; `index.mts` assembles dependencies.

`npm run octo:test` uses mocked Octo responses and temporary state files. It never reads `.env`, contacts Octo, starts browsers, or modifies live resources. It covers minimum duration, restart persistence, no idle mutation, duplicate prevention, partial/uncertain writes, concurrency, ownership checks, password forwarding, and API token isolation.

References checked 2026-10-12: [Profiles API](https://github.com/octobrowser/documentation/blob/main/api/profiles.md), [Folders API](https://github.com/octobrowser/documentation/blob/main/api/folders.md), [Local API](https://github.com/octobrowser/documentation/blob/main/api/local-client.md).
