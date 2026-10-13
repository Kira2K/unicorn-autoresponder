# Octo pilot acceptance — 2026-10-13

The full live Console flow passed on the Windows Guest desktop with the real
PostgreSQL repository and Octo cloud API. Production backend logic used only the
cloud; the test driver alone used the desktop API to open and normally close windows.

## Scope and result

- Pilot clients: Alex (`alex.octo@example.com`, client 248) and Bob
  (`bob.octo@example.com`, client 249), both paused and without platform accounts.
- Exactly two new Ru profiles were created through Console UI: internal IDs 305
  and 306. The existing 294 profile rows were unchanged by the migration.
- Both clients signed in using the existing email/password form, then received
  overlapping grants in two complete cycles of 120 seconds each.
- Each profile opened with its own five-digit password; the other client's actual
  password was rejected. Wikipedia pages verified the Alex/Bob identities.
- At expiry, credentials disappeared from Console and both profiles returned to
  the private folder with original metadata and password protection intact.
- Both open windows remained usable. Storage written after hiding survived a
  reload and the ordinary close/reopen between cycles.
- Ordinary closure caused the cloud listener to clear protection automatically.
  The second grant used the same stored password and a new anonymous name.
- A third authenticated client could neither see the card nor call the Octo API.
  Cross-client grants and duplicate requests were also rejected/handled correctly.
- Final state: both profiles closed, private, original metadata restored, protection
  removed, grants complete. Stored passwords retained. No force-stop used.

## Additional checks

- 92 adapter, API, lifecycle, persistence, event replay, seed and affected Dolphin
  regression tests passed. These cover leading zeroes, restart/deadline recovery,
  duplicate requests/events, unavailable history, uncertain writes, no launch,
  early closure, force-stop exclusion and proxy/locale rules.
- Disposable local PostgreSQL integration passed: migration rerun, preservation,
  concurrent reservations, rollback, revisions, event cursor atomicity and leader
  connection loss.
- Mock UI E2E passed two cycles with 45-second leases.
- TypeScript and frontend production build passed.

## Reproducibility and limits

The first live attempt exposed Octo's folder-name readback, which is now normalized
to the current UUID. The next attempt exposed a string debug port in the desktop
response; the driver now reuses the existing adapter's normalization. Both fixes
have regression coverage. The successful run resumed only the exact two newly
created profiles after their previous grants had completed; it did not create
replacements or reset grant history. Sanitized run reports and masked screenshots
are under ignored `tmp/octo-console/` locally.

Live acceptance covers the Ru pilot. En proxy selection is covered by adapter and
workflow tests; no spare Ready proxy was available for a live En run. The assembly
uses real Console auth, SQL and Octo modules while isolating unrelated automation.
It was not a Render deployment. Enable the documented environment on the existing
awake backend when deploying; no separate service is required.
