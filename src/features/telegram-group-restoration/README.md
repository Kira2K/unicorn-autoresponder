# Telegram restoration v2

See the shared [group creation architecture](../../../docs/telegram-group-creation-architecture.md)
for module boundaries, current limits, private external prerequisites and recovery
contracts. The operation notes below include historical cohorts and pilot gates;
they are not a current live-status report.

`market-handoff.cjs --prepare` freezes the explicitly approved 49 new-group
ownership transfers and the current market memberships in ignored
`storage/group-handoff-20261019`. Running without `--prepare` resumes those
receipts. Only a matching nonblank secured ID and restoration journal authorize
a target; original chat IDs are never used as a destination. All database access
is SELECT-only. Sessions stay local and the runner uses WSS in memory.
Memberships run first, then a masked local prompt requests the current owner's
2FA password. Transfers and joins are sequential with persistent 60-second
intervals. Explicit ownership rejections stop for review; uncertain results
require ownership reconciliation, never another blind transfer. Market groups
retain @very_evil_unicorn as an ordinary member after verified ownership transfer;
@veu_support keeps her rights. No account leaves groups and no messages are sent.
The older fixed-source transfer contract remains the default; a new source is
accepted only with the handoff runner's exact authorized scope.

`local-extra-auth.cjs --support` authenticates only @veu_support into the separate
external `runtime/support-account` directory. `support-self-join.cjs` then uses
that single local session to join all created verified-invitation groups itself.
The first verified membership/history check gates the rest. Import attempts are
at least 60 seconds apart with persistent per-account cooldown and per-group
receipts. FLOOD_WAIT is honored; bare FLOOD stops the queue. Uncertain joins are
reconciled by membership without repeating an import. No administrator rights,
direct participant additions, SQL updates or restoration-journal changes occur.

The explicitly authorized Timur ownership task is
`node src/features/telegram-group-restoration/transfer-timur.cjs`.
It is fixed to client 143 / group -1003721937418, from 343610488 to 8805256389.
The local watcher waits for completed restoration, a 24-hour-old owner session,
and an idle runner, then holds the same batch lock while requesting local 2FA.
It performs one ownership RPC only. Telegram rejections stop the task with the
reported wait; uncertain outcomes reconcile ownership without blind retries.
History, pins, visibility, avatar, invitation and SQL are checked before/after.
Transfer receipts are separate from historical sender/owner journals; no SQL
updates or password/SRP persistence occur. A failed post-check leaves an intent
for a future read-only reconciliation. Ownership is not changed on other groups.

With user-approved `parallelAfterSendSmoke`, the local account runs up to 8
jobs after the existing pilot's bot receipts and service self-join are verified.
Each new group gets one verified invitation after initial setup; unicorn_service
joins itself before replay begins. The early check reads the restored prefix;
the final join stage reads and verifies the full history. SQL binding still waits
for full group verification. The service is never directly added to groups.

An optional `creatorKey: "local"` uses the separately authenticated local account.
Its GramJS session and identity live only under
`C:/Users/kiras/TelegramArchives/VEU/runtime/local-extra-account`, outside the
repository and Render configuration; the loader refuses non-Windows execution.
This restoration path does not use or export a TDLib database. Login code and
2FA password use masked local prompts and a Windows named pipe, never SQL/logs.
For this account, unicorn_service joins each new group itself with ImportChatInvite
after verification. A shared serialized session reads back the entire history;
no InviteToChannel operation is used for unicorn_service. The bot is added as
before and remains the sender. A complete local-account pilot gates continuation.

Before every actual create attempt (also after FLOOD waits), SQL `graduated`
clients are excluded except IDs 74 and 3. Completed/created groups are retained.
Skipped journals have reason `graduated` and appear separately in reports; no
invitation or secured SQL binding is generated. All 114 archived groups must be
either verified complete or legitimately excluded before final file delivery.
Excluded source memberships are omitted from the invitation file.

Current approved account for new groups: `settings.json.creatorKey = "kira"`
(`7586552066`, @very_evil_unicorn). Existing completed groups remain untouched.
New journals bind `ownerId` permanently; resuming with another owner is refused.
Cooldowns are account-specific, with 8 workers, 2 seconds per chat and a 0.5-second
owner-send interval. The first Kira group must pass full verification plus a
temporary unicorn_service join/read/leave history test before other groups start.
The pilot client is persisted so restarting cannot silently choose another pilot.
Current sending policy: bot for every unstarted group, with explicit owner
overrides preserving groups where Kira had already sent restored messages.
Content verification accepts Telegram's removal of terminal ASCII whitespace;
the frozen archive text/hash is never modified. All other text, message IDs,
authors, order, attachments and pins remain strictly checked.

Composition: `batch.cjs`; data and journals: ignored `storage/group-restoration-v2`.
Existing source archive and creator session remain in
`C:/Users/kiras/TelegramArchives/VEU`. No credentials or archive contents belong
in Git. This is an explicitly operated local workflow, not an application timer.

Prepare frozen plans and the audience review without Telegram writes:

```powershell
node src/features/telegram-group-restoration/batch.cjs
```

Execute/resume the approved scope:

```powershell
node src/features/telegram-group-restoration/batch.cjs --run
```

There is one batch lock and one lock per client. Never remove a live lock.
The legacy Galina runner owns its own journal; v2 waits for it and audits its
completed history, pin, invitation and SQL without recreating the group. V2
only appends the approved final notice once. Its result is grandfathered rather
than replaying already delivered historical messages under the new layout.

New groups are private supergroups. Visibility is enabled before any replay.
Only the creator and support bot are added. The first completed group is checked
by Kira joining via its invitation as a new member, reading the complete replay,
and leaving. No students or mentors are added automatically. Two more complete
groups pass before the 8-worker queue starts, ordered by source message count
then client ID. Creation is serial, with at least 60 seconds between attempts;
per-chat message delay is at least 2 seconds after each response. API-specified
waits are respected. Bare FLOOD without a duration stops the affected job rather
than silently hammering Telegram. After explicit rejection, resuming reconciles
existing stages before trying anything again.

The archive cutoff is frozen from the existing pilot plan. All pinned messages
within the six-month window appear inline once. If the newest current pin is
older, that one precedes the history. A split/document pin targets its last
component. The final user-approved notice is never pinned. Technical messages,
including the support bot's existing auto-welcome, are preserved and excluded
from restored-copy counts; unexpected replay markers still fail verification.

Every accepted send has a journal receipt. An uncertain send is reconciled by
sender, text hash, and document size, never blindly repeated. SQL updates use a
row lock and compare previous secured fields. Only the two secured fields are
updated, atomically; original group IDs, usernames and roles remain untouched.
Whitespace in source IDs is normalized only for comparison, never written back.

`report.json` contains metadata for all 114 groups. Plans and receipts can contain
private invitation URLs and source text, so stay in ignored storage and never
get logged. `audience-review.json` holds local unresolved-role review. The
user-confirmed `role-decisions.json` allows the 16 confirmed staff and excludes
Azamat `1721399662` and Ivan `8858520592`. Students, bots, source/creator service
accounts, Vlada `415009258`, and Tanya `1343900712` are always excluded.

Only after all groups complete and every role is resolved, a single HTML file
is sent by Kira to chat `-1003187558078`, topic `20934`, with the approved caption.
It includes the explicit statement that stack groups are not yet created.
Delivery intent, hash and message ID prevent duplicate publication. No private
messages are sent. Confirmed group invitations are reused, not personalized.

Run the mock suite with:

```powershell
npm run tg:restoration:test
```

For unattended continuation, `node src/features/telegram-group-restoration/supervise.cjs`
waits for the existing batch rather than launching a competing account session.
After a failed batch it waits 15 minutes and resumes only explicit FLOOD rejections
or transient local file locks. Unknown external outcomes and SQL conflicts produce
`supervisor-blocked.json`; they never trigger blind retries or file publication.
The supervisor forces the original owner path (`RESTORATION_BOT_ADMIN=0`).
It does not grant administrative rights to the bot. Atomic local journal renames
retry brief Windows locks without repeating any external operation.

The user-authorized `settings.json` value `sender: "owner"` switches remaining
replay operations to the existing @unicorn_service GramJS account. Existing bot
copies remain unchanged; verification and uncertain-send reconciliation accept
either confirmed sender and still reject duplicate copies. Plain text formatting,
dates, tags, file hashes, per-chat delays, pins and SQL binding are unchanged.
Owner sends additionally serialize with a 0.5-second account interval and honor
explicit FLOOD cooldowns. Unknown send outcomes retain their intent for readback.
`creationNotBefore` pauses new creates after finishing existing groups, so a
creation restriction no longer prevents those groups from completing first.
