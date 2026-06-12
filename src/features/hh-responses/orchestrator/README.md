# Orchestrator

The orchestrator runs HH auto-responses for selected clients. It should stay thin:
load client data, control Dolphin, open HH, inject `index.js`, collect browser
state, report, and clean up.

## Runtime Flow

1. Load enabled clients from `createAppDb()`.
2. Attach runtime-only data, such as mocked/future `blockedCompanies`.
3. For each client, apply the Dolphin automation lock tag/status.
4. Start the Dolphin profile and connect Playwright over CDP.
5. Run saved/manual vacancies cleanup before normal responses.
6. Open the HH scenario URL and validate HH auth.
7. Inject `index.js` and start the browser-side auto-responder.
8. Wait until the auto-responder finishes or the orchestrator watch timer ends.
9. Read normalized browser storage: stop reason, parser logs/errors, recent URLs,
   manual vacancies, response count.
10. Classify the run through `orchestrator/scraper-state.ts`.
11. Send Telegram/local reports.
12. Stop Dolphin, remove the automation tag, and restore the previous status.

## Important Boundaries

- `orchestrator/types.ts` is the public type surface for run state and scraper
  outcomes.
- `orchestrator/scraper-state.ts` owns normalization/classification of unstable
  browser-side data.
- `auto-responder/*` is the browser-control facade used by the orchestrator.
- `index.js` is the injected browser-side worker; storage written there must stay
  backward-compatible with the orchestrator readers.
- `src/platform/db` is the only data entrance. The orchestrator must not read
  Google Sheets or NocoDB directly.

## Expected Success Semantics

These are normal successful finishes:

- `targets_processed`
- `no_new_targets`
- `limit_reached`
- `manual_targets_only`
- `hh_response_daily_limit_exceeded`
- `user_stop`
- healthy `orchestrator_stop_after_watch`

Stop-list skips are processed skips, not failures. Auth loss, captcha, browser
disconnect, selector breakage, and unknown parser failures should become typed
failure states instead of loops or silent success.
