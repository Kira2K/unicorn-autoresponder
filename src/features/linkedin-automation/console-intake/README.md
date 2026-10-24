# LinkedIn intake in Console

Students with Dolphin profiles keep the Dolphin card. Without a LinkedIn URL they
can also select the Outlook preparation form; saving it does not create Octo
replacements, edit Dolphin bindings or require Octo setup prerequisites. Existing
LinkedIn users with Dolphin keep their current account-editing/opening workflow.
Without Dolphin, RU-only
students use Octo directly; EN/Both students choose existing LinkedIn or preparation
for a new account. A nonblank saved LinkedIn URL locks the card to the existing
scenario. Login-only and preparation-only rows do not count as registered profiles.
The student's stack comes from the existing client record; this form never edits it.

## Boundaries and persistence

`GET/PUT /api/client/linkedin-intake` derives ownership from the authenticated client
session, checks Octo access scope and market. Existing-account Octo saves reject
Dolphin bindings; preparation-only saves accept them. No
administrator/provider impersonation is supported. Read responses contain password
presence flags, never credentials. A blank password on update preserves its value.

Existing LinkedIn requires ready RU/EN infrastructure, an EN proxy, and the user's
self-confirmation after obtaining access through the normal Octo grant workflow.
The checkbox does not inspect LinkedIn, create Unipile bindings or set verified flags.
Changing credentials, profile identity or proxy invalidates the UI confirmation.
The generic platform account editor and automation eligibility rules are unchanged.

Preparation saves LinkedIn metadata in existing `platform_accounts` text columns:
`linkedin_first_name`, `linkedin_last_name`, `real_location`, `old_link_blocked`.
Outlook credentials use a separate account with platform name `email_outlook`.
Platforms are resolved by name; missing/ambiguous platforms or account rows reject
the write. No catalog/schema mutation or migration is performed.
New rows use the shared SQL ID allocator and encoded `_copy_id`, with source
metadata/timestamps. They never rely on the nonunique default `[]` for identity.

`old_link_blocked` contains a JSON array of optional blocked-account objects:
`fullName`, `country`, `company`, `position`, `blockedAt`, `newFullName`.
Empty cards are removed, partial cards and ordering survive. Legacy formatted text
is read as one card; unrecognized content is retained in optional `legacyText`.
Zero blocked accounts is valid. There is no date or name-difference rule.

The preparation records and durable `source: direct` Octo setup intent commit in
one client-locked SQL transaction. Retries reuse accounts and the current intent;
uncertain commits require a read before another UI submission. Existing ready
profiles and attached proxies are retained. Missing profiles are queued with the
existing locale rules and private creation/reconciliation workflow, without a pool
proxy, NodeMaven, proxy scoring or LinkedIn signup. `LinkedInRegistrationHandoff`
defines the future staff-task boundary; no staff job is dispatched yet.

Existing-account manual proxy setup accepts HTTP(S)/SOCKS4/5 fields and reuses the
existing verified proxy attachment operation. Later edits live in a collapsed
custom-proxy accordion. Access TTL, guest credentials and grant cleanup are unchanged.
The SQL Console composition disables dispatch of retired queued proxy-checker jobs;
already dispatched unknown checks are not retried or reinterpreted.

Saving existing credentials retains the LinkLab handoff inside the same transaction
when LinkLab is enabled. Preparation-only LinkedIn rows do not trigger it.

## Local verification and release

- `npm run linkedin:intake:test`: pure contracts, owner-scoped routes, SQL adapter
  mocks, blocked-history compatibility and frontend selection/checkpoint rules.
- `npm run octo:console:test`, `npm run web:sql:test`, `npm run typecheck`,
  `npm run web:build`: affected regressions and compilation.
- `npm run linkedin:intake:e2e`: mock-only browser flow; requires built frontend.

Deploy backend before frontend. Startup validates the existing intake columns when
Octo is configured. Runtime profile creation still needs the existing Octo worker,
cloud configuration and owner bridge; this code change alone does not create live
accounts or prove live login. No Octo-to-Unipile automation is introduced.
