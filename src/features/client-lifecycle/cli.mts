import { createPostgresPool } from "../../integrations/postgres/pg-pool.mts";
import { readPostgresAppDbConfig } from "../../platform/db/postgres/config.mts";
import { writeTransaction } from "../../integrations/postgres/working-session.mts";
import { clientLifecycleStore } from "./postgres-store.mts";
import { runLifecyclePass } from "./pass.mts";
import { createClientSender } from "./sender.mts";
import { loadClientNotificationSettings } from "./postgres-settings.mts";
const args = new Set(process.argv.slice(2));
if (process.env.CLIENT_LIFECYCLE_ENABLED !== "1") {
  console.log(
    JSON.stringify({ feature: "client-lifecycle", state: "disabled" }),
  );
} else {
  const config = readPostgresAppDbConfig(process.env),
    pool = createPostgresPool(config);
  const store = clientLifecycleStore(pool, config.database),
    apply = args.has("--send");
  try {
    const { messageConfig, supportChatId } = await loadClientNotificationSettings(pool, config.database);
    if (args.has("--activate")) {
      // No automatic activation at startup. Seed from current history, not its past events.
      if (!apply) throw new Error("activation_requires_send_confirmation");
      await writeTransaction(pool, config.database, async (s) => {
        await s.query(`INSERT INTO noco.client_notification_state
        (singleton,activated_at,status_cursor) SELECT true,clock_timestamp(),COALESCE(max(id),0)
        FROM noco.client_status_history ON CONFLICT(singleton) DO NOTHING`);
      });
    }
    if (args.has("--cutover")) {
      // Explicitly discard only unsent bulk-edit history, never delivery records.
      // Run with the worker stopped and status editing paused, not on every startup.
      if (!apply) throw new Error("cutover_requires_send_confirmation");
      await writeTransaction(pool, config.database, async s => {
        await s.query(`INSERT INTO noco.client_notification_state
          (singleton,activated_at,status_cursor) SELECT true,clock_timestamp(),COALESCE(max(id),0)
          FROM noco.client_status_history ON CONFLICT(singleton) DO UPDATE
          SET activated_at=EXCLUDED.activated_at,status_cursor=EXCLUDED.status_cursor`);
        await s.query("UPDATE noco.client_notification_days SET done=true WHERE NOT done");
      });
    }
    const result = await runLifecyclePass({
      store,
      messageConfig,
      supportChatId,
      send: createClientSender(supportChatId),
      now: new Date(),
      apply,
      statuses: !args.has("--reminders"),
      reminders: args.has("--reminders"),
    });
    console.log(JSON.stringify({ feature: "client-lifecycle", ...result }));
    if (apply && (result.counts.errors || result.counts.failed || result.counts.deferred || result.counts.uncertain))
      process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
