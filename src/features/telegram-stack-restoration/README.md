# Local common-stack restoration

See the shared [group creation architecture](../../../docs/telegram-group-creation-architecture.md)
for contracts reused with personal groups, private prerequisites and verification.

This explicitly operated batch is limited to Java, Go, DevOps and combined
Python/Java AQA. Source chat IDs are kept in ignored
`storage/stack-restoration-20261023/source-scope.json` as an array of
`{key, sourceChatId}` entries; no real chat binding or invitation belongs in Git.
It never writes PostgreSQL,
adds students, sends private messages, uses the bot, or operates other groups.

`node src/features/telegram-stack-restoration/archive-live.cjs` freezes the
six-calendar-month window and exports accessible primary and pre-migration
history through the existing local support TDLib session. This account is
read-only. Required media, metadata and avatars are stored in the separate
external `TelegramArchives/VEU/stack-restoration-20261023` archive. Failed
required files block the affected group; older archives are never rewritten.

`node src/features/telegram-stack-restoration/main.cjs` resumes durable receipts
in ignored `storage/stack-restoration-20261023`. The service account owns every
new private supergroup and posts its history. The smallest group is a complete
pilot, including a self-invited ordinary observer's full-history and posting
test, before the other groups run. Only that test message is deleted. Creation
is serialized at 60 seconds; publication uses the existing two-second per-chat
interval plus an account-wide gate. Explicit flood deadlines persist; a bare
FLOOD stops the account and requires review, without timed blind retries.

After restoration, eligible students receive the approved invitation text in
their confirmed individual groups. The allowed statuses are `studying`,
`onboarding`, `on ru market` and `on en market`. The current status, stack and
destination are checked immediately before sending. Confirmed secured journal
bindings take priority; other group bindings require student membership and a
successful send/delete probe. A rejected primary send may use the observer in
the same destination; an uncertain send only reconciles its original account.

The archive and registry contain invitations and conversation data and stay
local. Terminal reports contain counts, IDs and sanitized error codes only.
`report.json` covers four groups; `recipient-report.json` covers the candidate
students, including exclusions and deferred cases. Do not remove live locks or
clear an uncertain operation to force a retry.
