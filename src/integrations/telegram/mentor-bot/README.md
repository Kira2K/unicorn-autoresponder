# VEU Mentor Bot — local implementation

This directory contains the locally implemented v1 workflow. The original `cli.mts` entrypoint is
offline. `test-cli.mts` provides the local Telegram pilot; `sql-pilot-cli.mts` provides an explicit
single-student SQL pilot. Neither pilot is a production launcher.

## Safe commands

- npm run tg:mentor-bot:check — offline menu/stage check.
- npm run tg:mentor-bot — offline demonstration with synthetic clients and a mock sender.
- npm run tg:mentor-bot:test — policy, scenarios, scheduler, delivery, runtime and store contracts.
- npm run tg:mentor-bot:regression — existing related suites with dotenv, real SQL and external networking disabled.
- npm run typecheck — repository types.

The original offline CLI rejects all other arguments. MENTOR_BOT_API_KEY is not read there. The offline harness cannot fall
back to fetch or a database connection. A real adapter requires an explicitly supplied token AND
requester; the worker also requires explicitly supplied storage, membership checker and lock.
No production launcher or deployment is included. SQL pilot preparation is a separate explicit command.

## Local Telegram pilot

The pilot reads exactly the supplied env file and uses `MENTOR_BOT_API_KEY`; it never falls back
to `VEU_SUPPORT_BOT`. It verifies the bot username, resolves `MENTOR_BOT_TEST_CHAT_USERNAME`
to a numeric Telegram chat ID and requires the bot to be a group administrator.
If `MENTOR_BOT_TEST_CHAT_ID` is set, it must match that resolved group. Reports use the separate
`MENTOR_BOT_REPORT_CHAT_ID` destination.
It reads one client snapshot from PostgreSQL through a connection forced to read-only mode.
The optional SQL mentor columns and `mentor_bot` schema are not required for this pilot.
Test student, hard/soft mentor and administrator usernames come from `MENTOR_BOT_TEST_*`.

Check credentials and access without sending messages, polling or creating local state:

```powershell
npm run tg:mentor-bot:pilot -- --env-file .env --check
```

Start the worker explicitly, then send `/menu@veumentorbot` in the configured test group:

```powershell
npm run tg:mentor-bot:pilot -- --env-file .env --start
```

Only the configured student and listed administrator/mentor/support participants in that group
are handled. All listed staff share the existing staff permissions; the administrator setting
does not grant Telegram administrator rights. Other groups and participants are ignored while
the polling offset advances. Outgoing messages are limited to the test group and the explicitly
configured report chat. These may be the same group.

All confirmations, status/market/mentor edits, sessions, checkins, delivery receipts and offsets
persist only in `storage/mentor-bot/client-226.json` (the filename uses the configured client ID).
PostgreSQL and client-lifecycle automation do not receive test changes. This tests real Telegram
dialogs and the worker, not the production SQL adapter or preparation integrations.
The client snapshot remains local after the first start; later source card edits are not synchronized.
Checkins follow the real Moscow calendar and require a preparation/market status even in this pilot.

The first start skips commands queued before activation. Restarts use the saved offset and history.
Ctrl+C stops the worker and releases its state-file lock. After a crash, inspect the PID in the
`.lock` file and remove that lock only after verifying the process is gone; retain the JSON state.
To start a separate test or change the chat/participants, use a new `--state-file` path instead of
deleting old results. A binding mismatch refuses to reuse another test's state.

## Single-student SQL pilot

Use this mode to verify actual `noco.clients.client_status`, `market_id`, `tg_hard_mentor` and `tg_soft_mentor` writes against the database
configured in the project `.env`. `--client-id` is required and must match `MENTOR_BOT_TEST_CLIENT_ID`.
The current test configuration uses client **204**. Every client SELECT, row lock, status-history read
and business UPDATE is limited to that ID. Foreign learner/client/delivery bindings abort the transaction.
No existing local JSON is imported. The offline commands and local file pilot retain their behavior.

The physical database name and the explicit SQL configuration file are printed by every SQL pilot
action. Verify this name against Mathesar's connection; its display label is not a database name.
`unicorn_noco_copy` and `unicorn_noco_copy_restore` are independent sources and do not synchronize
changes made by this pilot.

The same `MENTOR_BOT_TEST_*` student, administrator, hard/soft mentor and optional support usernames
are used. The SQL pilot also admits the selected client's current hard/soft mentor usernames from SQL,
so a confirmed assignment grants the new mentor access without editing ENV or restarting the worker.
Only the configured group and these actors are handled; outgoing messages remain limited to that group
and `MENTOR_BOT_REPORT_CHAT_ID`. Numeric `MENTOR_BOT_TEST_CHAT_ID` is mandatory and is checked against
the group's username through Telegram. The canonical client's group must be empty or the test group;
a different existing group blocks preparation/start. Test student and group bindings are overlays,
never written into the canonical card. Mentor usernames are read from the canonical `tg_hard_mentor`
and `tg_soft_mentor` columns. Confirming a mentor change writes only the selected column of the
selected client, together with audit and notification jobs in one transaction. These existing columns
and UPDATE permissions are required; preflight verifies all four writable client columns. ENV mentor
usernames remain explicit test staff access in addition to current SQL assignments. The old `mentor_overrides` values remain stored for
compatibility but are no longer read or written by the SQL adapter. Previously confirmed changes are
not silently copied from that legacy state; any reconciliation must be scoped and explicitly requested.

If the working database needs another existing local SQL configuration, pass `--db-env-file` explicitly.
Only `APP_DB_POSTGRES_*` is read from that file; the bot token and all test roles still come from
`--env-file`. An incomplete SQL configuration fails instead of falling back to another database.
Neither file is rewritten. There is no implicit use of `.env original`.

For an explicitly confirmed test client whose canonical chat differs from the test group,
`--use-test-chat` enables the test group overlay without changing the canonical card's chat. The
existing incoming actor/group allowlist, outgoing destination guards and single-client SQL checks
still apply. This option is included in the persistent test binding; changing it cannot reuse another
test's state. For the current Mathesar test, use these arguments on **every** action:

```powershell
npm run tg:mentor-bot:sql-pilot -- --env-file .env --db-env-file ".env original" --client-id 204 --use-test-chat --status
npm run tg:mentor-bot:sql-pilot -- --env-file .env --db-env-file ".env original" --client-id 204 --use-test-chat --prepare
npm run tg:mentor-bot:sql-pilot -- --env-file .env --db-env-file ".env original" --client-id 204 --use-test-chat --check
npm run tg:mentor-bot:sql-pilot -- --env-file .env --db-env-file ".env original" --client-id 204 --use-test-chat --start
```

The selected SQL configuration must report `database: unicorn_noco_copy`. Stop the existing worker
before starting another worker with the same bot token. Preserve the previous database's test state.

These are operator commands; development/tests do not execute them automatically:

```powershell
# Read the real selected client's status. No Telegram requests, DDL or writes.
npm run tg:mentor-bot:sql-pilot -- --env-file .env --client-id 204 --status

# Explicit one-time SQL preparation. No client status changes or Telegram messages.
npm run tg:mentor-bot:sql-pilot -- --env-file .env --client-id 204 --prepare

# Verify credentials, chat access, SQL permissions, state binding and history trigger. No writes/messages.
npm run tg:mentor-bot:sql-pilot -- --env-file .env --client-id 204 --check

# Start only this student's pilot; Telegram confirmations write real status, market and mentor changes.
npm run tg:mentor-bot:sql-pilot -- --env-file .env --client-id 204 --start
```

Stop on any command error; do not proceed until it is resolved. `--prepare` uses the current role's
existing CREATE/TRIGGER rights, or the existing `unicorn_noco_copy_owner` role when those are insufficient,
to create `mentor_bot_pilot_204` (ID derived from the explicit setting), its grants and a narrowly bound
status-history trigger on `noco.clients`. It neither applies the shared
`mentor_bot` release artifacts nor grants new write permissions on `noco.clients`. The application role
must already have UPDATE on `client_status`, `market_id`, `tg_hard_mentor` and `tg_soft_mentor`. Preparation needs existing DDL rights or
permission to assume the migration role; it never changes role memberships. Connections verify the
allowed database name and existing copy marker.

The trigger runs only when **this client's** `client_status` actually changes. It records the before/after
status in `mentor_bot_pilot_204.status_history` in the same transaction as the real card update. This
works even when the database has no canonical `noco.client_status_history`. The trigger
function has a fixed `pg_catalog` search path, fully qualified table references and no PUBLIC execution
grant. It does not replace existing triggers. Preparation can be rerun without clearing history,
offsets, drafts or confirmed results. A different test binding is refused instead of overwriting history.

The SQL store verifies that a new matching status-history row was created before committing any status
change. A missing/disabled/broken trigger rolls back the card, market, audit and delivery jobs together.
The existing uncertain-COMMIT path reports uncertainty; operation receipts prevent replay of a committed
confirmation. The worker uses a database advisory lock, skips pre-activation commands on its first start,
and resumes saved receipts/offsets on restart. Ctrl+C stops the worker; statuses and test history remain.

For a manual RU status check, use `/market_ru@veumentorbot` as a configured staff actor and confirm,
then `/responses_started@veumentorbot` and confirm.
In a second terminal, run `--status` after each confirmation. Expected actual states:
`hh_ru process` → `on ru market`; each changed state has one pilot history row.
`/hard_done` records hard completion and deliberately does not change `client_status`.
The pilot does not start client-lifecycle/HH workers or write their configuration; independent running
consumers of canonical status/market data retain their existing behavior.

Validation: `npm run tg:mentor-bot:test` includes protocol tests for scope, rollback, duplicates and
read-only checks. Optional embedded PostgreSQL validation runs actual DDL, grants, triggers, transitions
and rollback with synthetic data and no network/ENV access. Install its isolated fixture once with:

```powershell
npm install --prefix storage/mentor-bot-validation --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
node --test src/integrations/telegram/mentor-bot/pilot-postgres.test.mts
```

The embedded fixture adapts only PostgreSQL's fixed database-name projection for the existing copy gate;
it does not validate pg driver networking, advisory-lock competition or deployment environment grants.
Without that optional package, the embedded test is explicitly skipped. The dependency is separate from
the application's package manifests.

## Contracts and responsibilities

Live pilot startup installs the common slash-command hints for its verified group: `/menu`,
`/what_my_stage` and `/ready_pitch`, each with a Russian description. Both the default language
and `ru` scopes are set through the shared Bot API client. The bot's global/default scope and
other chats are not changed. Staff actions remain in the existing role-aware inline menu;
command hints do not grant permissions or change command handling. `--check`, `--status`,
`--prepare` and module imports do not register hints. Registration failure is logged as bounded
metadata and does not stop the worker. See https://core.telegram.org/bots/api#setmycommands.

When the bot is added or re-added to a linked enrolled group, its `my_chat_member` transition from
`left`/`kicked` to `member`/`administrator` queues the approved greeting from `welcome-message.mts`
with the main-menu button. Promotion of an existing member does not greet again. The addition update
ID is saved with the delivery, so duplicate updates and restarts do not queue a second welcome.
This greeting deliberately uses the exact approved text without student-card personalization.
Sending still uses the durable queue and shared Telegram integration. Joining does not enroll a new
client, reset progress, pin a message or change administrator rights. The pilot accepts this event
only for its configured group and bot, regardless of the adding administrator's username. Other
groups remain ignored. An existing initialized pilot processes queued additions after a restart;
the first activation still skips updates queued before the pilot was initialized.

| Action | Roles | Commit | Notification |
| --- | --- | --- | --- |
| Menu / stage | Own student / non-student member | No business change | Unmapped stage: one report |
| Hard completion | Non-student member | One completion timestamp, no status change | Instruction and report |
| Pitch readiness | Both | Readiness / time / username | Yes: notice + report; first No: none; revocation: both |
| Market preparation | Non-student member | Client market and selected preparation status atomically; weekly checkin cycle activation | Existing client-lifecycle owns automation; bot adds receipt + report |
| Responses started | Non-student member | Manually confirmed transition and market merge; preserves the active checkin cycle | Notice + report |
| Mentor change | Non-student member | Selected existing mentor column | Notice + report |
| Checkin question 1 | Both | Draft only | No report or counter reset |
| Checkin question 2 | Both | Two answers + author/time + audit + counters, atomically | One combined report |
| Checkin correction | Both | Two newly confirmed answers, version checked, before next checkin | One full updated report |
| Thursday closure | Scheduler | Misses once per incomplete eligible period | One combined report |
| Monday check | Scheduler | Delivery receipt only | Report chat only |
| Pitch reminder | Scheduler | Delivery receipt only | Student reminder + report |

Reports always go to the injected reportChatId. This destination must not be guessed from generic
error-report channels. Group selection uses secured_general_chat_id, then telegram_general_chat_id.
There is no delivery fallback to the retired group. Client names and student/mentor mentions come
from current database fields. VEU support uses @veu_support.

Roles use normalized usernames, not numeric user IDs, mentor assignment or client_role.
Numeric from.id exists only in memory for getChatMember. Missing/ambiguous usernames and failed
membership/database checks fail closed. A username matching another student is denied.
Authors are stored by username only, by explicit product decision; numeric author IDs are not persisted.
A successfully checked username absent from all student records is a non-student.
An empty or invalid student username in the linked client card blocks all mutating actions for both roles.
The menu and stage remain readable. The invalid-card username warning is sent only to reportChatId
(«Ботоотчеты»), never to the student group, its menus or callback popups. Changes remain blocked.
Username changes MUST be reflected in the client data: an outdated mapping can classify a student
as a non-student. This is the explicitly accepted policy, not a guaranteed stable identity scheme.

## Organization

- types / policy / calendar / stage: small contracts and pure rules.
- service / screens / commit: dialogue transitions, ownership and confirmation boundary.
- schedule: enrollment, status events, calendar periods and chronological recovery.
- messages / delivery: durable jobs, templates, retry classification and stale-message checks.
- message-templates: pure rendering from current card fields and immutable event facts.
- error-texts: frozen approved error copy; no interpolation of names, IDs or raw external errors.
- postgres-store / postgres-lock: injected SQL pool; transaction and worker locks.
- runtime / telegram-adapter / worker: explicit composition; no top-level live behavior.
- memory-store / test-harness / sql-test-pool: isolated test adapters.
- state-contract: shared immutable-audit, complete-answer and unique-period checks before persistence.

`/start` and `/start@veumentorbot` are aliases of `/menu` in the configured group: they open the same
role-specific menu and discard only the actor's unfinished draft, preserving saved learning progress.

Each actor has a separate group message and draft. Callback data contains session ID and revision;
the server also verifies owner, chat, message and current authorization. Menu entries for stage,
pitch readiness and checkin are shared launch buttons: any currently authorized participant opens
their own dialogue. These entries also appear on staff action screens, so a student can always
reach their actions after a staff interaction. Previously delivered session-bound menu entries
allow the same three launches after validating their chat, message and revision. Answers, edits
and confirmations remain owner-only; launching from another actor's screen never copies or changes
that actor's draft. New menu cancels the actor's
old draft. A persisted result never contains just one checkin answer. Any authorized participant must reconfirm both
questions to update it. A new version won by another actor is displayed before any correction.
Current staff may launch staff actions from another actor's main menu into their own separate draft;
students still cannot use staff actions, and no actor can confirm another actor's draft. SQL pilot access
is rechecked against the current canonical mentor fields inside each business transaction. Removed mentors
lose assignment-based access unless they are also explicitly configured test staff. Foreign groups and
unrelated users remain filtered; failed dynamic lookups do not consume their pending updates.

Dialogue navigation edits the actor's existing message using editMessageText: its message ID stays
the same through choices, confirmations, results, Back, Cancel, Edit and Home. Explicit slash commands
open a fresh screen at the bottom of the chat, including repeated commands and bot-suffixed commands.
Buttons on that new screen edit it in place. Button labels, visibility and confirmation steps are unchanged.
A first entry without an actor screen creates one message; subsequent actions update it in place.
A shared launch from another actor's screen reuses the clicker's own screen when present and preserves
the source actor's draft and message. A first shared entry without a foreign active owner can use the
clicked bot message as its screen. There are no message deletions or expiry timers.
Interaction notices and instructions are folded into the same screen edit, with current card names
and mentions rendered again on delivery retries. Their original jobs remain cancelled as receipts;
reports keep their separate destination and scheduled reminders retain their existing behavior.
Undelivered result text survives a superseding edit or stale click before delivery. Edit failures
never fall back to a new message or repeat business changes. Delivery still uses the shared sender.

Student dialogue screens, stage descriptions and newly queued student notices/instructions/reminders
place the student's current normalized @username immediately after their name on the same line
at delivery time, including retry attempts. Notices without a name in their body add «Name @username»
as an inline salutation. Immediate error replies retain a username-only salutation when client
storage and the student's card name are unavailable.
Student report templates place the current normalized @username immediately after each occurrence
of the student's name, including checkin corrections, scheduled reports and retry attempts. Without
a valid username they retain the name alone; static infrastructure/invalid-username errors keep
their approved copy. Preparation-stage descriptions (`hh_ru process`,
`hh_en process`, `hh_both process`) insert the HTML hyperlink «Вот ссылка на инструкцию по созданию hh»
to https://melodic-firewall-a6d.notion.site/hh-ru immediately after the «Сейчас: Создай профиль…» task,
followed by the plain-text Notion reassurance and then the next-stage description.
Card text is escaped before adding the link.
Market screens show the current task and mentor contacts. A next step is shown for the RU stage
only when the student's market also includes EN; the EN response stage has no next-stage instruction.

The staff-only `✅ Завершить онбординг` menu button appears only at `onboarding`. It opens an
owner-only confirmation; cancelling leaves the status unchanged. Confirmation writes `studying`,
audit and a student notice atomically through the active store, preserving market and mentor assignments.
It starts the hard-skills stage by clearing any earlier `hardCompletedAt` marker in the learner state;
previous audit history remains intact. The draft preview does not change this marker. Both the preview
and the student notice name hard skills; database status remains `studying` through hard and soft learning.
Authorization and the current status are checked again on confirmation, so students, old buttons and
duplicate updates cannot repeat or bypass the transition. The SQL pilot writes the selected client's
actual `noco.clients.client_status`; no schema change is needed.

Hard completion is a manual button/command with confirmation, instruction and report; it never changes
the client status automatically. Readiness may be recorded before hard completion. Both roles can
use Edit answer after a saved readiness result, select a new answer and explicitly confirm it.
Only confirmation changes readiness, audit and notices/reports; choosing an answer alone is a draft.
Market preparation
is manually requested by a non-student member (the soft mentor by business process), with no assignment-based
permission requirement. Response startup remains a human confirmation and never launches an orchestrator.
Staff market transitions from paused, graduated or blacklisted remain allowed by explicit product decision.

The mentor workflow ends at response stages. It has no offer-acceptance action or graduation transition.
Old action callbacks are rejected, pending removed-action screens and congratulations are cancelled,
and greetings and stage descriptions no longer advertise that step. Historical audit and source status
values are preserved; an existing external `graduated` status remains excluded from checkins.

Market actions preserve existing directions: RU + EN and EN + RU become `both`; `both` never narrows.
For an empty market, the selected direction becomes the initial market. The preparation status follows
the selected button: `hh_ru process`, `hh_en process`, or `hh_both process`. Both directions are prepared
when RU+EN is selected. The confirmation screen shows the resulting market before any write.
The existing response-start button and confirmation move `hh_both process` directly to `on en market`,
keeping market `both`. Single-market preparation still moves RU to `on ru market` and EN to `on en market`.
Manual response confirmations also merge their direction into the current market. Status and market are
written in one client UPDATE, together with audit and delivery jobs in the same transaction.

Market impact: account requirements, Dolphin profile requirements and client-lifecycle derive the market
from the canonical client card, so no duplicate market copies are written. HH enable switches, existing
profiles/accounts and LinkedIn automation retain their separate controls; selecting a market does not
enable/disable jobs or provision external resources. No CV processing states, files or transitions are changed.

## Persistence

001-mentor-bot.sql is an unapplied migration artifact. 002-mentor-grants.sql prepares minimal application grants without activation. It creates separate collections for learners,
sessions, checkins, deliveries, processed operations and immutable audit history, plus runtime offset.
Typed payloads are JSONB; unique client/period and complete-answer checks additionally protect results.
Drafts and final results live in different tables. The migration neither backfills clients nor activates
anything; its environment marker starts as disabled.

The adapter verifies current_database() and the explicit environment marker on each transaction.
Business changes, audit and queued delivery commit together. Only client_status, market_id and the selected
mentor fields may change in clients.
The pre-existing status-history trigger must be present and transactional before any future rollout.
External changes are consumed from client_status_history with per-event receipts, not a lossy high-water mark.
The v1 adapter serializes short writes with one advisory lock, and business transactions lock enrolled client rows.
This favors correctness for the initial cohort; it is not intended for large-scale parallel workloads.
Cursor reads/writes use the runtime row without loading business collections. Delivery claims load at most
100 due candidates and only their learner/session/checkin/client dependencies; acknowledgements load one job.
These frequent paths do not scan audit, operation receipts or status history. Business/scheduler transactions
still load the aggregate, so large-cohort scheduling and long-term retention need separate sizing.
Both storage adapters enforce the same application invariants; database constraints additionally protect SQL.

Unknown COMMIT results are reconciled by re-reading the operation ID; the business command is never
blindly replayed. Native PostgreSQL migration/transaction execution is not covered by the SQL protocol
double. A real isolated PostgreSQL validation is a release prerequisite.

## Scheduling and delivery

Timezone: Europe/Moscow. A period describes the preceding Thursday 17:00 to Thursday 17:00;
answers are accepted until the next Thursday. At the exact activation boundary the new checkin may open.
Existing market students start at explicit enrollment, without historical penalties.
A first checkin still covers the preceding Thursday-to-Thursday period, including days before enrollment.
A complete `No/No` response counts as completion and resets both missed-checkin counters, exactly like any
other complete response. Both roles may correct both answers until the next checkin boundary; closed or
cancelled periods remain immutable through this dialogue.
A market-to-market switch does not create a second cycle.

Excluded statuses: graduated, blacklisted, paused, left, unknown.
The inclusion of unknown is explicitly approved. Pending reports, reminders and checkin screens are
cancelled on exclusion, including abandoned sends; they do not return when the student resumes.
The delivery claim also checks the current card status before rendering, even before status history
has been reconciled. New student reports are suppressed while the card has an excluded status.
An unfinished open checkin is cancelled without a penalty on exclusion. Completed history survives.
Checkins run on hh_ru process / hh_en process / hh_both process / on ru market / on en market.
Any other status, including studying, test or blank, stops the cycle and cancels queued checkin
prompts/reports without adding a penalty for the unfinished period. Other learning messages, such as
pitch preparation, retain their own rules. Existing counters are preserved. Any eligible status
reactivates the cycle, opening a period on the next Thursday and preserving the original activation
date. Transitions between eligible statuses keep the current period and cadence. Delivery claims
and manual checkin commands enforce the same five-status rule from policy.mts. A cycle retained under
the earlier policy on an ineligible status is stopped without rewriting historical counters.
Previously inactive learners already in preparation start from the next Thursday after reconciliation;
weeks disabled by the previous policy do not create retroactive penalties.

Missing status history quarantines only the affected learner. No partial history receipts, periods or
misses are committed for that learner, and business actions explain that support must check the data.
Other learners continue normally. Once complete history becomes available, chronological recovery resumes
automatically. Current reminders wait during quarantine; expired ones are cancelled. State changes emit
bounded `mentor_status_history_required` / `mentor_status_history_recovered` diagnostics after commit.

Recovery replays status history and period boundaries in order, creates the current period, accounts
for missed periods exactly once and produces a latest aggregate miss report. Monday does not close
the checkin or affect counters. Superseded pending and abandoned sending miss reports are cancelled.
Pitch reminders use the original completion date and resume only
on a future scheduled slot after readiness is revoked.

Outbox processing is independent of business commits. Transient / unknown sends retry with backoff
(up to five minutes). Native FloodWait and local rate deferrals use their full retry delay, without
capping a server retry_after. Permanent errors become blocked. A broken screen template blocks only
that job and cannot stop delivery to the following chat.
A worker crash leaves a claim recoverable after two minutes. Unknown sends MAY duplicate Telegram
messages by the user's explicit choice; confirmed sends and business operations are deduplicated.
Logging only emits bounded operation identifiers, states and attempt counts.

New dynamic jobs store a typed template and event parameters. Each claim, including retries, renders
the text from the current card: client_name, student/mentor mentions and stack. Screens also rebuild
their keyboard from the current session and card. A screen job explicitly carries its checkinId so
the narrow SQL delivery path loads the needed checkin. Event periods, answers, author, old/new mentor
assignments and action targets remain snapshots; later edits cannot rewrite an earlier report.
Mentor-change notices show the current assigned mentor; the corresponding historical report keeps
the confirmed before/after values. Old literal jobs without a template retain their original text;
there is no data migration or attempt to infer templates by replacing substrings.

The eight agreed static error phrases and a static background-failure message live in error-texts.mts
and are covered by a copy contract. Recipient mentions are added around the unchanged error copy.
Unresolved chat bindings, permission failures, temporary access failures, rolled-back saves and
uncertain commits have separate outcomes. Errors that cannot be queued (no client or unavailable
storage) use the injected shared sender directly to the incoming chat, with «🏠 Главное меню».
Failed incoming actions are explained and skipped; the worker then processes the following update.
They are not automatically replayed: the user opens the action again to check/retry it. Existing
operation receipts still protect committed actions from redelivery. Failed error feedback uses a
separate literal feedback job with no client binding; this permits delayed errors for unbound chats
and avoids repeating the business action because its reply was rate-limited. If both Telegram and
storage are unavailable, feedback is best effort. The invalid-card username phrase is report-only.
Callback queries are acknowledged without popup text before membership or business processing;
this confirms receipt only. The action result or error is delivered separately in the chat.

Permanent membership-query errors 400/403 deny that update without holding the polling offset.
Maintenance failures are reported once per incident to reportChatId and do not prevent polling.
The worker attempts delivery even when the scheduler failed. The polling offset progresses in memory
if its database checkpoint is temporarily unavailable; checkpoint writes catch up after recovery.
Loss of the worker lock, invalid credentials and polling conflicts remain fatal. Poll transport/server
errors are retried; poll FloodWait honors retry_after. Storage diagnostics expose stable internal
codes / SQLSTATE, never SQL or error text.

telegram-throttle is injected at worker assembly. Sends and edits share a conservative budget of
25 requests per second, one per chat per second and 20 per group per rolling minute. Busy destinations
are deferred in the durable queue without sleeping ahead of other chats. Native send cooldown is
shared across outgoing chats; membership, callback acknowledgement and polling each respect their
method cooldown. Server cooldown deadlines are checkpointed as four fixed operations records and
restored when a new worker starts. Checkpoint failure retains the in-memory gate and logs metadata.
There is no new migration. HTTP and native Telegram results still belong to the shared integration;
local deferrals are explicit errors, never fabricated Telegram API responses. The configured limits
follow https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this and retry_after
follows https://core.telegram.org/bots/api#responseparameters.

## Future release checklist — preparation only, do not execute now

1. Validate migration and rollback behavior on a dedicated local PostgreSQL with synthetic fixtures.
2. Review duplicate usernames / chat bindings and the report destination.
3. Review DDL, database role grants, status-history trigger and the environment marker.
4. Supply an explicit deployment assembly and secret configuration in a separately authorized task.
5. Give the bot group administrator permissions for reliable membership checks and pinning.
6. Enroll one approved pilot client, enqueue welcome via prepareWelcome, deliver and pin via pinWelcomes.
7. Observe a complete Thursday/Monday/Thursday cycle, then separately authorize expansion.

Stop/rollback: stop the worker and disable its activation. Preserve tables, final results, audit,
offset and delivery receipts. Do not run destructive down-migrations or restore old client statuses.
The existing support bot and client-lifecycle are separate and must not be stopped by this rollback.
