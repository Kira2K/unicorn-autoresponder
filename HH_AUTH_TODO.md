# HH Auth TODO

Goal: keep a reusable HH authorization flow for Dolphin profiles before running auto-responses.

Implementation status: the reusable auth folder exists and the orchestrator now calls it before manual vacancies cleanup and the standard HH scenario. Credentials are loaded lazily from the real Google Sheet through `getClientHHAuthCredentials(clientName)`.

## Architecture

Create a separate folder:

```text
hh-auth/
  index.ts
  make-hh-auth.ts
  validate-auth.ts
  auth-selectors.ts
  types.ts
```

`orchestrator.ts` should only call a small, clean API, for example:

```ts
const hhAuth = makeHHAuth({
  startProfile,
  stopProfile,
  connectToProfile,
  credentialsProvider,
  log
})

await hhAuth.ensureAuthorized(clientData.dolphinProfileId)
```

No login selectors, Playwright form-filling details, captcha checks, or auth state heuristics should live directly in `orchestrator.ts`.

Real data connection:

- `google-sheets-check.ts` reads HH auth labels from `ПЕРС ДАННЫЕ`.
- Supported labels are `rusPhoneNumber`, `emailHH`, `passwordEmailHH`, and `passwordHH`.
- `rusPhoneNumber` is normalized for HH login, for example `/+79775442105` -> `9775442105`.
- `makeHHAuth` accepts either temporary `credentials` for local tests or lazy `getCredentials` for production orchestration.
- The orchestrator uses `getCredentials`, so credentials are fetched only when `validateAuth` says the profile is not already logged in.

## Required Flow

1. Open the Dolphin profile in headless mode.
2. Run `validateAuth`.
3. If auth is valid, close/keep handoff as needed and continue normal orchestrator actions.
4. If auth is not valid, close the headless profile.
5. Open the same Dolphin profile in headfull mode.
6. Click the HH login entry button.
7. Fill the phone input.
8. Switch from code auth to password auth. HH requires the phone to be entered before this switch.
9. Fill the password input.
10. Submit the login form.
11. If captcha appears, fail with a clear error. Do not try to solve captcha automatically.
12. Run `validateAuth`.
13. Close the headfull profile.
14. Open the same Dolphin profile in headless mode.
15. Run `validateAuth` again.
16. If auth is valid, continue normal orchestrator actions.
17. If auth is still invalid, fail with a clear auth error.

## Files

### `hh-auth/index.ts`

Public exports only:

- `makeHHAuth`
- `validateAuth`
- auth result/type exports
- selector namespace exports if useful for tests

### `hh-auth/make-hh-auth.ts`

Main orchestration module for auth.

Responsibilities:

- Execute the exact headless -> headfull -> headless sequence.
- Own profile start/stop order.
- Call `validateAuth` after every profile open.
- Call the login form filler only in headfull mode.
- Return a structured result to the caller.
- Throw clear typed errors for captcha, invalid credentials, missing selectors, and auth validation failure.

This file coordinates auth, but should not contain selector constants.

### `hh-auth/validate-auth.ts`

Standalone callable auth validator.

Responsibilities:

- Accept an existing Playwright `page` or context/page adapter.
- Open or inspect HH pages needed for auth validation.
- Return a structured auth state:
  - `logged_in`
  - `logged_out`
  - `captcha`
  - `unknown`
- Use selector namespaces from `auth-selectors.ts`.
- Be callable independently from tests and debugging scripts.

This function must not start or stop Dolphin profiles by itself.

### `hh-auth/auth-selectors.ts`

Selector namespaces. Keep names semantic and grouped by purpose.

Suggested shape:

```ts
export const hhAuthSelectors = {
  navigation: {
    // Logged-in signal.
    resumesAndProfile: '[data-qa="profileAndResumes-button"]'
  },
  loginForm: {
    // Logged-out entry button on HH pages. Click it to open the login page/form.
    loginButton: '[data-qa="login"]',
    accountTypeCards: '[data-qa="account-type-cards"]',

    // HH phone auth starts in code mode. Fill phone first, then switch to password mode.
    phone: '[data-qa="magritte-phone-input-calling-code"]',
    switchToPassword: '[data-qa="expand-login-by-password"]',
    password: '[data-qa="applicant-login-input-password"]',
    submit: '[data-qa="submit-button"]'
  },
  captcha: {
    container: '',
    challenge: ''
  },
  authState: {
    loggedInSignals: [],
    loggedOutSignals: []
  }
} as const
```

Keep selector names semantic. Do not scatter raw selectors through implementation files.

Known selector meanings:

- Auth exists: `[data-qa="profileAndResumes-button"]`
- Auth does not exist entry button: `[data-qa="login"]`
- Account type cards before phone step: `[data-qa="account-type-cards"]`
- Phone input: `[data-qa="magritte-phone-input-calling-code"]`
- Switch from code auth to password auth: `[data-qa="expand-login-by-password"]`
- Password input: `[data-qa="applicant-login-input-password"]`
- Submit auth button: `[data-qa="submit-button"]`

### `hh-auth/types.ts`

Shared types:

- `HHAuthState`
- `HHAuthResult`
- `HHAuthErrorCode`
- `HHCredentials`
- `HHAuthLogger`
- options for `makeHHAuth`
- options for `validateAuth`

## Orchestrator Integration

Auth should run before manual vacancies cleanup and before opening the standard HH scenario.

Expected order inside client run:

1. Start/prepare Dolphin profile lock/status as today.
2. `makeHHAuth(...).ensureAuthorized(profileId)`.
3. Manual vacancies cleanup.
4. Standard scenario open.
5. Inject `index.js`.
6. Start auto-responder.

`orchestrator.ts` should receive only a concise auth result and add it to lifecycle/reporting.

## Failure Rules

- Captcha in headfull mode: fail with `captcha_detected`.
- Invalid credentials: fail with `invalid_credentials`.
- Missing selector: fail with `selector_missing`.
- Headless validation says logged out: switch to headfull login.
- Headfull login validates ok, but second headless validation fails: fail with `session_not_persisted`.
- Unknown state after retries: fail with `auth_unknown`.

## Test Plan

- `validateAuth` on logged-in profile returns `logged_in`.
- `validateAuth` on logged-out profile returns `logged_out`.
- Captcha page returns `captcha`.
- `makeHHAuth` skips login when initial headless validation is `logged_in`.
- `makeHHAuth` closes headless before opening headfull when login is needed.
- `makeHHAuth` closes headfull after successful login.
- `makeHHAuth` reopens headless and validates persisted session.
- Captcha causes a clear failure and does not continue into normal scenario.
