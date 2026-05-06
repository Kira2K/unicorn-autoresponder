# TODO: full testing plan

## Goal

Build a repeatable test process for the auto-response flow, so every important HH/Dolphin/Sheets/Telegram case can be checked before long production runs.

## Test profiles

- Keep at least one dedicated HH profile for each auth state:
  - logged in
  - logged out
  - expired session
  - captcha / suspicious login state, if HH shows it
- Keep at least one dedicated Dolphin profile for each market:
  - Ru
  - En
- Keep test clients in Google Sheets with clearly marked names, for example `TEST Auth Logged Out`, so production clients are not touched during checks.

## Authorization checks

- Before starting the auto-responder, verify HH authorization using stable selectors.
- Test logged-in state:
  - profile/resume navigation is visible
  - negotiations/responses navigation is visible
  - login button is absent
- Test logged-out state:
  - login button is visible
  - create resume button is visible
  - profile/resume navigation is absent
- If logged out, stop the run with a clear reason and send it to logs.
- Future feature: implement login form filling.
- Future tests for login:
  - login form opens
  - phone/email field is detected
  - password/code step is detected
  - wrong credentials are reported
  - successful login resumes the original scenario

## Sheets mapping

- Test reading from all required sheets:
  - personal/client data
  - Dolphin main
  - stacks/scenarios
- Validate required fields before launch:
  - client name
  - market
  - stack/scenario
  - Dolphin Profile Id for the selected market
  - common chat id
  - response flags, for example Ru/En enabled
  - cover letter for selected market
- If a required field is missing, skip that client and report it in summary logs.
- Test case-insensitive stack matching.
- Test market filter:
  - Ru-only default
  - explicit En run
  - mixed clients with both markets configured

## Multiple scenarios per client

- Support several scenarios for one person, for example:
  - Frontend Ru
  - Frontend En
  - Full-stack Ru
  - Full-stack En
- Test that each scenario opens the correct HH URL.
- Test that scenario-specific excluded keywords are applied.
- Test that one failed scenario does not block other scenarios for the same client unless the failure is profile-level, for example auth failure.

## Multiple resumes per client

- Future feature: choose the correct resume for each scenario.
- Example:
  - client has 2 frontend resumes and 2 full-stack resumes
  - frontend scenario must apply only with frontend resume
  - full-stack scenario must apply only with full-stack resume
- Required future mapping:
  - client
  - market
  - stack/scenario
  - resume identifier
  - resume display name
  - priority/order
- Test cases:
  - correct resume is selected in response modal
  - wrong resume is not selected
  - missing resume stops only that scenario
  - repeated response modal is handled without double-submit
  - "respond with another resume" modal is handled correctly

## HH parser corner cases

- Daily response limit:
  - detect `[data-qa-popup-error-code="negotiations-limit-exceeded"]`
  - stop profile normally
  - mark result as OK/limit, not as error
- Manual response/questions page:
  - direct redirect to `/applicant/vacancy_response`
  - redirect after vacancy page
  - redirect after submit click
  - save vacancy to manual list
  - return to search list
  - continue next vacancies
- Resume visibility warning:
  - detect text warning about resume visibility
  - mark vacancy as processed
  - return to list
  - continue next vacancies
- No modal / no confirmation:
  - verify recent URLs are captured
  - verify last parser logs are sent only when the stop is not normal
  - avoid sending noisy logs for normal completion
- Repeated response:
  - modal says the user already responded
  - no duplicate submit unless we intentionally support re-applying
  - current behavior should be documented per scenario

## Telegram reporting

- Client chat report:
  - sent once per finished profile/scenario
  - contains green/red status in the title
  - manual vacancies are links, not raw URLs
  - manual list contains only useful fields
- Logs chat:
  - receives errors and parser diagnostic logs
  - receives auth status when needed
  - includes recent URLs for failures
  - limits parser logs to the latest useful entries
- Summary logs chat:
  - receives only short human-readable run summary
  - includes all profiles/scenarios from the run
  - clearly separates OK, HH limit, and needs-check states

## Dolphin lifecycle

- Before run:
  - fail if too many profiles are already open
  - verify intended profiles are not already busy
- During run:
  - add automation tag/status before opening profile
  - stagger starts with default delay
  - run profiles in parallel after their stagger delay
- After run:
  - stop Dolphin profile
  - remove automation tag/status
  - restore previous status
  - report cleanup failures separately
- Test external interruption:
  - stop Node process manually
  - verify orphan detection
  - verify tags/statuses can be cleaned afterward

## Timing and reliability

- Keep default formula documented:
  - external timeout = `(watchMs + staggerMs + 60000ms * profileCount) * 1.1`
- Test short runs:
  - 1 minute smoke test
  - 2 minute parser behavior test
  - 15+ minute production-like test
- Compare headless and headful behavior:
  - response count
  - manual count
  - parser errors
  - recent URLs on failure

## Suggested test stages

1. Static checks:
   - `node --check index.js`
   - `tsc --noEmit`
2. Dry data mapping:
   - read sheets
   - print selected clients/scenarios/resumes
   - do not open Dolphin
3. Single-profile smoke:
   - one known logged-in profile
   - one short run
   - verify Telegram messages
4. Auth negative test:
   - deliberately log out one test profile
   - run it
   - verify auth failure is detected and reported
5. Corner-case test:
   - use known vacancies that trigger manual questions, daily limit, visibility warning, and repeated response
6. Parallel test:
   - two profiles
   - verify stagger and independent completion
7. Production-like test:
   - all selected profiles
   - normal duration
   - verify cleanup and final summary

## Future automation ideas

- Add a `--dry-run` mode for mapping and validation.
- Add a `--test-client` mode that only runs dedicated test rows from Sheets.
- Add fixtures for known HH URLs that trigger specific parser branches.
- Save structured run artifacts:
  - selected clients
  - selected scenarios
  - selected resume ids
  - final status per scenario
  - parser stop reason
  - recent URLs
- Add a small local test harness for pure functions:
  - sheet mapping
  - Telegram formatting
  - stop reason classification
  - resume/scenario matching
