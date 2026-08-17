# LinkedIn Automation Agent Rules

These rules apply to `src/features/linkedin-automation/**`. Work affecting
`src/integrations/unipile/**` or the LinkedIn integration surfaces inside
`src/features/web-console/**` must follow the same safety rules.

## Required context

- Read `ARCHITECTURE.md` before changing this feature.
- For Profile Filler work, also read `profile-filler/ARCHITECTURE.md`.
- Treat the current authentication choice as unresolved.

## Isolation

- Work only on the local branch `feature/linkedin-profile-filler-web`.
- Allowed write scope: `src/features/linkedin-automation/**`,
  `src/integrations/unipile/**`, and minimal LinkedIn-specific integration
  points inside `src/features/web-console/**`.
- Treat every other existing repository file as read-only.
- Do not modify `package.json`, root configuration, canonical docs, NocoDB, HH,
  Dolphin, Telegram, CV flows, or unrelated Web Console behavior.
- Do not commit, push, create a PR, publish, or deploy without explicit user
  approval.
- If later integration requires changing an existing file, stop and show the
  exact file and minimal diff first.

## Authentication decision gate

- The two candidate blocks are `Tampermonkey` and `Own authentication + 2FA`.
- Do not choose one on the user's behalf.
- Do not implement auth endpoints, credential forms, persistent password/TOTP
  storage, checkpoint automation, or reconnect logic until the user approves a
  design.
- Profile Filler backend code may receive current LinkedIn session credentials
  when connection or account resolution requires them. Keep credential use at
  the backend boundary; planners, previews, reports, and browser responses use
  `ConnectedAccount` and redacted data.
- Never log, persist, return, or commit LinkedIn cookies, passwords, Unipile API
  keys, or proxy credentials.
- A dedicated future auth frontend may accept or display a TOTP secret and
  one-time 2FA codes. Keep them out of logs, URLs, analytics, browser storage,
  reports, and fixtures; clear component memory after submission or expiry.

## Profile Filler V1

V1 supports only Headline, About, Experience, Education, Skills, and Open to
Work. Names, profile location/postal code, photos, cover, and all other profile
sections are out of scope.

Required neutral flow:

1. Resolve or receive a verified `ConnectedAccount`; backend-only session
   credentials may be used during this step.
2. Display the exact LinkedIn identity and require confirmation.
3. Receive and validate `profile.json`.
4. Read only required current profile sections.
5. Show warnings, normalizations, skips, and exact diff.
6. Require a separate final confirmation.
7. Execute one mutation at a time with a new server-side delay.
8. Read back every mutation.
9. Stop after the first failed or unverified mutation.
10. Show a redacted report.

Preview is read-only. Bind job start to a short-lived server plan ID/hash and
never trust a client-supplied payload after preview.

Use two job types:

- `read_only`: identity reads, current-profile reads, validation and preview;
- `mutation`: confirmed writes followed by mandatory read-back.

Only one mutation job may own a given `account_id` at a time. Do not globally
block independent accounts. A read-only job for an account must wait while that
account has an active mutation job.

## Mutation safety

- Bind every plan to one verified `account_id`.
- Never reuse IDs, URNs, or search-parameter IDs across profiles.
- Use standard Unipile V2 only; raw/Magic Route requires separate approval.
- Set `notify_network=false` for Experience and Education.
- Do not create records while a required section is throttled or incomplete.
- Do not delete Skills, Experience, or Education.
- Do not disable Open to Work.
- Skills are add-only, target 100, accepted final range 95–103, maximum batch 10.
- HTTP 2xx is not success without matching read-back.
- Never automatically repeat an uncertain create.

## Timing and limits

Generate each wait on the backend with `crypto.randomInt(min, max + 1)`. Do not
accept timing ranges from uploaded files or frontend requests.

- first write: 10–30 seconds;
- ordinary writes: 45–120 seconds;
- first read-back: 7–20 seconds;
- repeated read-backs: 15–45 seconds;
- Skills batches: 60–150 seconds.

For `api/too_many_requests`, obey `Retry-After`, observe `x-ratelimit-*`, and add
our fresh 5–20 second safety cushion. For `provider/too_many_requests`, stop for
manual review because Unipile cannot provide a reliable retry time. After an
uncertain write, read back before considering any retry. If an API 429 has no
usable `Retry-After`, stop instead of inventing a retry time.

## Tests and public access

Tests are fake/local by default and must not call live LinkedIn. Live mutation
requires explicit approval naming the account, fields, and cleanup.

Bind development servers to localhost. Public exposure requires separate
approval plus administrator authentication, server-side authorization, HTTPS,
secure cookies, CSRF protection, upload limits, rate limiting, session expiry,
and tested secret redaction.
