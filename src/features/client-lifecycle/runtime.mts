import { isReminderWindow } from "./policy.ts";

/** One owned loop; generations invalidate schedules left by overlapping lifecycle calls. */
export function createLifecycleRuntime(input: {
  enabled: boolean;
  /** The existing backend starts each Moscow day; SQL retains unfinished checks. */
  remindersEnabled?: boolean;
  pass: (options: { now: Date; reminders: boolean; reminderAt?: Date }) => Promise<{
    state?: string;
    counts: { errors: number; sent?: number; failed?: number; stale?: number; deferred?: number };
  }>;
  report: (event: Record<string, unknown>) => void;
  now?: () => Date;
  /** Optional fixed interval for tests/embedding; otherwise idle 5m, active 5s. */
  intervalMs?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let started = false, generation = 0;
  let reminderDay: string | undefined, previous: Date | undefined;
  let pendingReminder: Date | undefined;
  let retrySoon = false;
  const report = (event: Record<string, unknown>) => {
    try { input.report(event); } catch { /* Logging must not stop the loop. */ }
  };
  const tick = () => running ??= Promise.resolve().then(async () => {
    const now = input.now?.() ?? new Date(), day = now.toISOString().slice(0, 10);
    const due = new Date(now);
    due.setUTCHours(16, 0, 0, 0);
    // Complete an opportunity crossed by an in-flight pass, not a new unscheduled off-hour check.
    const crossed = previous != null && previous < due && now >= due;
    if (input.remindersEnabled !== false && !pendingReminder && day !== reminderDay && (isReminderWindow(now) || crossed))
      pendingReminder = due;
    const reminders = pendingReminder != null;
    previous = now;
    const result = await input.pass({
      now, reminders, ...(pendingReminder ? { reminderAt: pendingReminder } : {}),
    });
    retrySoon = !!(result.counts.sent || result.counts.failed || result.counts.stale ||
      result.counts.deferred || result.counts.errors);
    if (reminders && result.state !== "not_activated" && !result.counts.errors &&
        !result.counts.failed && !result.counts.stale && !result.counts.deferred) {
      reminderDay = pendingReminder!.toISOString().slice(0, 10);
      pendingReminder = undefined;
    }
    report({ feature: "client-lifecycle", result });
  }).catch(() => {
    retrySoon = true; // A failed read does not prove the durable queue is empty.
    report({ feature: "client-lifecycle", code: "pass_failed" });
  })
    .finally(() => { running = undefined; });
  const schedule = (owner: number) => {
    if (!started || owner !== generation || timer) return;
    let wait = input.intervalMs ?? (retrySoon || pendingReminder ? 5000 : 5 * 60000);
    if (input.remindersEnabled !== false && !pendingReminder) {
      const now = input.now?.() ?? new Date(), due = new Date(now);
      due.setUTCHours(16, 0, 0, 0);
      // One timer: shorten idle sleep at 19 MSK, including a pass crossing it.
      const crossed = previous != null && previous < due && now >= due;
      if (reminderDay !== now.toISOString().slice(0, 10) && (isReminderWindow(now) || crossed))
        wait = 1;
      else {
        if (due <= now) due.setUTCDate(due.getUTCDate() + 1);
        wait = Math.min(wait, due.getTime() - now.getTime());
      }
    }
    timer = setTimeout(async () => {
      timer = undefined;
      if (!started || owner !== generation) return;
      await tick();
      schedule(owner);
    }, wait);
    timer.unref();
  };
  return {
    async start() {
      if (!input.enabled || started) return;
      started = true;
      const owner = ++generation;
      await tick();
      schedule(owner);
    },
    async stop() {
      started = false;
      ++generation;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await running;
    },
  };
}
