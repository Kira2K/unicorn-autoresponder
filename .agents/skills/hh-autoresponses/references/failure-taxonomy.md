# HH Autoresponses Failure Taxonomy

Use this reference when classifying run outcomes, deciding whether to continue, and deciding whether to call support.

## Normal Outcomes

These are expected per-client terminal states and do not require support by themselves:

- `limit_reached`
- `hh_response_daily_limit_exceeded`
- `manual_targets_only`
- `no_new_targets`
- `targets_processed`
- `user_stop`
- `orchestrator_stop_after_watch` when the user intentionally used the watch window

Report the outcome and confirm cleanup.

## Recoverable Per-Vacancy Events

These should not stop the client immediately:

- `COMPANY_STOP_LIST_SKIPPED`
- `NO_APPLY_RETURNED` for individual vacancies
- other recoverable vacancy skips reported by the parser

The responder should mark the vacancy processed or skipped, continue to the next vacancy, and include warning details in reports/logs.

For repeated `NO_APPLY_RETURNED`, stop the client only after the configured consecutive failure threshold, then classify it as `vacancy_recovery_limit_exceeded`.

## Per-Client Terminal Failures

These usually end only the affected client:

- HH captcha or anti-bot screen
- logged-out or invalid HH auth state
- missing client data or resume setup
- Dolphin/CDP disconnect for one profile
- selector breakage affecting one profile flow
- manual vacancy questions that require human action
- no terminal stop reason after watch/idle handling

Continue the market run for other clients when the orchestrator can isolate the failure.

## Process-Level Blockers

These can stop or prevent a market run:

- Dolphin local API unreachable before profiles start
- too many open Dolphin profiles before launch
- unexpected active HH orchestrator or node run before a launch or scheduled precheck
- broken or missing scheduled launch task during schedule/prelaunch verification
- unresolved required target state during an error-reporting check
- Noco unavailable or unreadable before target selection
- code/config error before any client can be selected or started
- readiness pipeline failure that prevents classifying ready versus blocked accounts
- Telegram/global report failure that prevents required prelaunch reporting

When a blocker happens before profiles start, stop the sequence and report the global blocker instead of opening profiles blindly.

## Extra Check Reporting Rules

- Extra Dolphin/client-state checks are silent in Telegram when OK.
- An error from an extra check at schedule time, one hour before launch, launch preflight, or manual status/debug time must immediately alert `summary_logs_channel_id` only.
- Reuse existing Dolphin/Noco/process checks and existing Telegram sending utilities so delivery attempts are logged consistently.
- Do not send extra Dolphin/client-state check alerts to client chats.
- Do not change existing Telegram behavior for readiness reports, run summaries, client final reports, manual-vacancy reports, or parser logs.
- Schedule-time and one-hour-before-launch Dolphin failures are prelaunch errors that warn without canceling unless the user explicitly asked to cancel on prelaunch errors.
- Launch-time Dolphin failure before profiles start is a process-level blocker.

## Support Rules

Do not call support for normal HH/user outcomes:

- no new targets
- manual-only vacancies
- daily HH response limit
- expected response limit reached
- intentional user stop

Mention or involve `@veu_support` only for actionable failures that the user or automation cannot resolve directly:

- auth validation failure or logged-out profile requiring account repair
- captcha or anti-bot state requiring human action
- broken HH UI selector or parser bug
- Dolphin profile/data setup that the user cannot fix from the run request
- repeated cleanup failure leaving profiles/tags/statuses inconsistent

If only one profile needs human action, name that client/profile exactly and keep other ready profiles running.

## No-Terminal-Stop-Reason Handling

`no_terminal_stop_reason` is a per-client diagnostic unless many clients share it at once.

Check:

- whether the browser responder actually started
- whether page URL/title changed
- whether recent URLs show vacancy response pages
- whether parser logs were present
- whether auto-reload recovery was attempted and succeeded
- whether final cleanup happened

If the client recovered and cleanup/reporting completed, classify as a client error with cleanup complete. If it repeats broadly across clients, inspect shared browser responder or watcher logic.

## Auth, Captcha, And Dolphin Issues

- Captcha is not a reason to stop every profile. Pause or finish only the affected profile and report it.
- Auth failures should be detected before start when possible and listed in readiness results.
- Dolphin/CDP disconnects after start are per-client unless the local API or profile capacity is failing globally.
- Profile lock busy means skip or wait according to existing lock policy; do not forcibly reuse a locked profile without explicit direction.

## Stop-List Proofs

For stop-list tests or proofs:

- Use real configured sources: global `Comtek`, client stop-list fields, expanded stop-company restrictions, and explicit run-only extras.
- Verify emitted logs include `COMPANY_STOP_LIST_SKIPPED`.
- Verify skipped companies do not count as fatal parser failures.
- Verify the run continues after stop-list skips.
- Do not use old mock defaults such as `Trynexis`.
