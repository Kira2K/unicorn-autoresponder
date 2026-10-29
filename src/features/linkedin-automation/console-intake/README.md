# LinkedIn intake in Console

Students with Dolphin profiles keep access to their previous Dolphin profiles during
a replacement LinkedIn registration. Every student with a registered LinkedIn has
one “Меня забанили” button in the single LinkedIn section, including Dolphin, Octo
and RU students. It records the owner-scoped `is_banned` flag and opens recovery instructions. It does
not create a replacement application. The student attests that a week of recovery
attempts has passed before opening the Outlook/identity/history form; no server timer
is enforced. Cancelling restores the saved form state. The button is hidden while
any registration request for the current account is unconfirmed (`не начата`, `блок`,
`сделана экспертом`), even if Denis already saved its credentials. It becomes available
after `выполнение подтверждено`, or for an existing account without a registration
request. The backend rejects replacement attempts during an unfinished registration too.
Without Dolphin, RU-only
students use Octo directly; EN/Both students choose existing LinkedIn or preparation
for a new account. The server's registered-account flag (URL, login or password present)
or a saved URL selects the existing scenario, so legacy URL-in-login accounts can
also report a ban without a data migration. Preparation-only rows remain unregistered.
The student's stack comes from the existing client record; this form never edits it.

## Pending registration in the student Console

An existing unconfirmed request always opens its preparation form, even if Denis already
saved a draft LinkedIn URL/login. Scenario selection and repeat-registration/ban actions
are hidden until confirmation. The existing three-day preparation message remains visible.
`не начата` and `блок` allow editing the current Outlook/identity/history data with
“Сохранить изменения”; `сделана экспертом` and `выполнение подтверждено` lock editing.
Status polling updates this lock in both directions without replacing unsaved drafts.
Outlook fields stay visible; only the instructions are collapsible. A blocked-history
checkbox reveals required cards. Archived history is read-only and shared with Denis
through the same loader, so both views show the same total.

GET adds `hadLinkedInBeforeTask` and `previousOctoProfileIds`, computed read-only from
owned current/archived registered accounts, earlier confirmed tasks and profile creation
times. A draft entered after this request began does not establish prior LinkedIn ownership.
For a returning student, only non-deleting Octo profiles created by the request's start
remain visible during preparation, with access controls but without setup/proxy editing;
previous Dolphin access remains visible too. Freshly prepared Octo profiles stay hidden.
Every pending registration, including a replacement, warns against opening Octo
while the expert works. Existing access remains available. During the first 30 days
after confirmation, each access request requires acknowledgment of the warmup warning.

Editing updates the same bound LinkedIn/Outlook rows and task (including a bound manual
request), preserves the expert's URL/login/password, and does not queue profile setup again.
The client lock and terminal-status guard apply before writes. A changed preparation still
invalidates its existing proxy receipt. This requires no schema or data migration.

## Boundaries and persistence

`GET/PUT /api/client/linkedin-intake` derives ownership from the authenticated client
session. Reads are available to all owners for the recovery section; ordinary saves
retain the existing Octo scope, market and Dolphin guards. An explicit replacement
or its pending student request may use the common Octo preparation even with Dolphin.
No
administrator/provider impersonation is supported. Read responses contain password
presence flags, never credentials. A blank password on update preserves its value.

Existing LinkedIn requires ready RU/EN infrastructure, an EN proxy, and the user's
self-confirmation after obtaining access through the normal Octo grant workflow.
The checkbox does not inspect LinkedIn, create Unipile bindings or set verified flags.
Changing credentials, profile identity or proxy invalidates the UI confirmation.
The generic platform account editor and automation eligibility rules are unchanged.

## Banned-account replacement and confirmed access

Replacement submits `scenario: new` and `replacesLinkedInAccountId` from the owner's
loaded account. Inside the existing client-locked transaction, the active account
ID is checked before any write. The old student request becomes a historical manual
request and the old LinkedIn/Outlook rows are soft-archived, retaining their credentials
and original IDs. New account rows and a new student request are created atomically.
An empty new Outlook password cannot reuse the archived mailbox's password. A stale
or repeated replacement rejects without creating more rows; uncertain commits require
a read-back and are never automatically replayed. A rollback restores the archive,
accounts, task source and Octo intent together. No schema/data migration is run.

Archived accounts are excluded from the Console/LinkedIn record feed. Historical
tasks referring to them are hidden from the Denis queue and cannot be edited there.
The read-only SQL projection exposes the existing archive flag without adding it to
the writable catalog. Only the transition to `выполнение подтверждено` can rebind LinkLab
from this student's archived account and reset the local cycle. Draft result saves do not
switch it; the explicit cycle migration and CRM fence are described in
[creation tasks](../creation-tasks/README.md#new-local-cycle-and-release-order-pr-100).

Existing Octo profiles and their passwords are reused. Each new LinkedIn requires Denis
to enter and validate a new connection for the same EN profile; RU is untouched. Missing profiles are
queued through the existing direct workflow. A recovery request also includes EN for
RU clients so Denis can work in the same EN flow; only the internal intent carries
these locales and the client's market is unchanged. Dolphin bindings are retained.
During a Dolphin replacement, the cabinet shows the Octo request while retaining access
to previous Dolphin profiles. After confirmation it uses the completed Octo profiles.
Ordinary Dolphin users do not enter this path silently.

`сделана экспертом` locks student editing while awaiting confirmation; access to previous
profiles is retained for students who had LinkedIn before the request.
`выполнение подтверждено` keeps account editing locked but restores access to the
existing Octo profiles, with setup/proxy editing hidden. Pending request state is
checked while the page is visible; confirmation restores access without a page reload
or recreating profiles. “Меня забанили” remains available for another registration.

Preparation saves LinkedIn metadata in existing `platform_accounts` text columns:
`linkedin_first_name`, `linkedin_last_name`, `real_location`, `old_link_blocked`.
Outlook credentials use a separate account with platform name `email_outlook`.
Platforms are resolved by name; missing/ambiguous platforms or account rows reject
the write. Normal intake requests never mutate the schema.
New rows use the shared SQL ID allocator and encoded `_copy_id`, with source
metadata/timestamps. They never rely on the nonunique default `[]` for identity.

`old_link_blocked` contains a JSON array of blocked-account objects:
`fullName`, `country`, `company`, `position`, `blockedAt`, `newFullName`.
New cards require full name, country, company, position and block date. Zero cards
is valid with the checkbox clear. Legacy formatted text and unchanged partial cards
remain readable without destructive rewriting; new/changed partial cards are rejected
server-side even if an older caller omits the checkbox field. Ordering is preserved.

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
when LinkLab is enabled. It queues one durable manager notification per account after
a credential change; duplicate saves do not enqueue another message. The recipient
mention is injected, default Julia; the current composition passes Kira. Preparation-only
LinkedIn rows do not trigger the existing-account notification.

## Local verification and release

The updated intake is available to all eligible EN/Both clients without Dolphin;
there is no email or client-ID rollout allowlist. The residence label is
“Город и страна проживания”, the Outlook registration date/time is required for
every new-account save, and a confirmed successful save opens the three-day
registration notice with a “Понятно” button. Failures and uncertain commits do not
open the success dialog. Existing LinkedIn saves do not require Outlook dates.
The exact `@outlook.com` domain is validated on the client and server. The Outlook
instructions include the VPN exception for users in Russia.

The redundant new-account name field is hidden in blocked-account history;
previously stored `newFullName` values remain in the data and survive subsequent
saves. Platform accounts appear before Telegram for all clients. Administrator
and provider layouts and the existing RU/Dolphin routing remain unchanged.

`outlookRegisteredAt` is a canonical UTC ISO timestamp. The browser converts the
device's local date/time to UTC and back and displays the device time zone.
The nullable `noco.platform_accounts.outlook_registered_at` (`timestamptz`) column
belongs to the `email_outlook` row. It is saved in the same transaction as the
credentials and creation intent. The storage adapter preserves an existing
timestamp if a caller omits it; the student API requires it on new-account saves.
Existing rows without dates can still be loaded; no dates are fabricated for them.

Before deploying the backend, run
`node --env-file=.env src/features/linkedin-automation/console-intake/migrate.mts` against the intended
configured database for a transaction-rolled-back migration check. Add `--apply`
to commit the column. The migration checks database identity, uses the existing
owner role, validates the column type and performs the DDL twice to check reruns.
It does not alter existing account values or publish changes to NocoDB metadata.

- `npm run linkedin:intake:test`: pure contracts, owner-scoped routes, SQL adapter
  mocks, blocked-history compatibility and frontend selection/checkpoint rules.
- `npm run octo:console:test`, `npm run web:sql:test`, `npm run typecheck`,
  `npm run web:build`: affected regressions and compilation.
- `npm run linkedin:intake:e2e`: mock-only browser flow; requires built frontend.

Apply the column migration, then deploy backend before frontend. Startup validates the intake columns when
Octo is configured. Runtime profile creation still needs the existing Octo worker,
cloud configuration and owner bridge; this code change alone does not create live
accounts or prove live login. No Octo-to-Unipile automation is introduced.

## Denis follow-up migration

Deploy this version only after explicitly applying
`creation-tasks/migrate-denis.mts --apply` against the marked copy database. Without
`--apply`, the migration is a rolled-back rehearsal. It adds ban/proxy provenance
flags and the existing-account notification outbox. Startup checks schema, never DDL.
Location prefills from the client record but editing the intake does not edit that
record. Future Outlook timestamps reject with a specific error; missing Octo client
data returns only known field IDs and labels, never provider diagnostics.
