# Automatic Telegram notification pacing

Shared contract for automatic Clients and CRM LinkLab notifications sent by
`@veu_support_bot`. No new service or Telegram client.

- `noco.telegram_notification_try_claim()` has no arguments and returns a boolean.
- `true`: the caller reserved the next automatic send attempt. The SQL deadline
  is advanced by a fixed 5 seconds using the database clock, without randomness.
- `false`: do not send or consume the notification; try on a later worker pass.
- SQL failure: do not send. A lost reservation response may waste a slot, not
  cause a blind retry or lose the queued notification.
- Successful, uncertain and rejected deliveries retain their existing handling.
  Explicit Telegram 429 keeps the individual notification pending for at least
  `retry_after`; another eligible notification may use a later shared slot.

The Clients claim and pacing reservation commit together. CRM reserves before
taking its delivery locks and sends outside transactions. There is no sleep in
either worker, no global 429 circuit breaker and no change to interactive bot
replies, CV transitions or the general `sendMany` facade. Worker scheduling may
make the effective interval longer than 5 seconds.

## Installation and rollback

Apply `001-pacing.up.sql` explicitly to the shared Unicorn database before
installing these consumers. It creates only a one-row internal pacing table
and a SECURITY DEFINER function with a fixed search path. PUBLIC has no access;
existing `unicorn_sql_app` and `crm_unicorn_app` roles receive EXECUTE only.
If these roles are provisioned later, rerun the migration as the schema owner.
Reapplication preserves the saved deadline. Startup does not migrate SQL.

This migration does not enable Clients mailings, create outbox events, change
recipients or modify student data. Missing installation fails closed.
For rollback restore the previous consumer code and retain the table, function
and deadline; deleting them is unnecessary and would break a remaining new
consumer. Never restore the business database over current data for this rollback.

## Isolated checks

Run `node --test src/integrations/postgres/notification-pacing/pacing.sql.test.mts`
with `NOTIFICATION_PACING_TEST_CONFIG` pointing to a fresh loopback-only test
PostgreSQL JSON: host, port, user, database=`unicorn_noco_copy_restore`,
local_proof=true. It creates artificial tables, roles and notifications;
without the config it skips and does not count as SQL validation.
The test roles/database must be disposable. No real Telegram requests are made.
