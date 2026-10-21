import type { clientLifecycleStore } from "./postgres-store.mts";
import { isReminderWindow, planReminder, planStatusMessage } from "./policy.ts";
import { deliverPlan, type Delivery } from "./worker.ts";
import type { ClientMessageConfig } from "./message-config.mts";

export type LifecycleStore = ReturnType<typeof clientLifecycleStore>;
export type Sender = (chatId: string, text: string) => Promise<Delivery>;

/** Per-event receipts prevent loss and starvation; daily checks are durable. */
export async function runLifecyclePass(input: {
  store: LifecycleStore;
  send: Sender;
  supportChatId: string;
  messageConfig: ClientMessageConfig;
  now: Date;
  apply: boolean;
  statuses: boolean;
  reminders: boolean;
  reminderAt?: Date;
}) {
  const counts = {
    send: 0, error: 0, skip: 0, sent: 0, failed: 0, uncertain: 0,
    already_claimed: 0, stale: 0, deferred: 0, errors: 0,
  };
  const activation = await input.store.activation();
  if (!activation) return { state: "not_activated", counts };
  const requested = input.reminderAt ?? input.now;
  if (input.apply && input.reminders && isReminderWindow(requested) && requested <= input.now) {
    const scheduledAt = new Date(requested);
    scheduledAt.setUTCHours(16, 0, 0, 0);
    await input.store.beginDay(scheduledAt);
  }
  const scheduledAt = input.apply
    ? await input.store.pendingDay()
    : input.reminders && isReminderWindow(requested) ? requested : null;
  const changes = input.statuses
    ? await input.store.changes(activation.statusCursor, input.now) : [];
  if (!changes.length && !scheduledAt) return { state: "idle", counts };
  const clients = await input.store.clients();
  const byId = new Map(clients.map(row => [row.client.id, row]));
  const deliver = async (row: typeof clients[number], plan: ReturnType<typeof planReminder>) => {
    counts[plan.kind]++;
    if (!input.apply) return { state: "skipped" };
    const result = await deliverPlan({
      client: row.client, plan, now: input.now, enabled: true,
      store: input.store.delivery, supportChatId: input.supportChatId, send: input.send,
      messageConfig: input.messageConfig,
    });
    if (result.state !== "skipped")
      counts[result.state as "sent" | "failed" | "uncertain" | "already_claimed" | "stale" | "deferred"]++;
    return result;
  };
  // A busy status queue cannot postpone the daily check past its scheduled time.
  if (scheduledAt) {
    let complete = true;
    for (const row of clients) {
      try {
        const result = await deliver(row, planReminder(row.client, {
          now: input.now, scheduledAt, activatedAt: activation.activatedAt, ...row,
        }));
        if (["failed", "stale", "deferred"].includes(result.state)) complete = false;
      } catch {
        complete = false;
        counts.errors++;
      }
    }
    if (input.apply && complete) await input.store.finishDay(scheduledAt);
  }
  let cursor = activation.statusCursor;
  for (const change of changes) {
    try {
      const row = byId.get(change.clientId);
      const plan = row
        ? planStatusMessage(row.client, change, activation.activatedAt)
        : { kind: "skip" as const, reason: "deleted_client" };
      const result = row ? await deliver(row, plan) : { state: "skipped" };
      if (!row) counts.skip++;
      if (input.apply) {
        const done = plan.kind !== "error" && !["failed", "stale", "deferred"].includes(result.state);
        await input.store.recordChange(
          // Pacing is checked by SQL on the next pass, not the error backoff.
          change.id, done, done || result.state === "deferred" ? null : new Date(input.now.getTime() + 60000),
        );
      }
      if (BigInt(change.id) > BigInt(cursor)) cursor = change.id;
    } catch {
      counts.errors++;
      // Quarantine only this event briefly; healthy later pages remain available.
      if (input.apply)
        await input.store.recordChange(
          change.id, false, new Date(input.now.getTime() + 60000),
        ).catch(() => {});
    }
  }
  // Informational progress only; selection never relies on sequence commit order.
  if (input.apply && cursor !== activation.statusCursor) await input.store.advanceCursor(cursor);
  return { state: input.apply ? "send" : "dry-run", counts };
}
