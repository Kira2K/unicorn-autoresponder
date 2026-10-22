import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createLifecycleRuntime } from "./runtime.mts";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the existing backend starts the daily check when a pass crosses 19 MSK", async () => {
  let clock = new Date("2026-10-14T15:59:59Z"), calls = 0, reminders = 0;
  const runtime = createLifecycleRuntime({ enabled: true,
    intervalMs: 1, now: () => clock, report: () => {},
    pass: async options => {
      calls++; reminders += Number(options.reminders);
      clock = new Date("2026-10-14T16:00:01Z");
      return { counts: { errors: 0 } };
    } });
  try { await runtime.start(); await delay(10); } finally { await runtime.stop(); }
  assert.ok(calls > 1); assert.equal(reminders, 1);
});
test("disabled worker owns no timer and invokes nothing", async () => {
  let calls = 0;
  const r = createLifecycleRuntime({
    enabled: false,
    pass: async () => {
      calls++;
      return { counts: { errors: 0 } };
    },
    report: () => {},
  });
  await r.start();
  await delay(10);
  await r.stop();
  assert.equal(calls, 0);
});
test("polls statuses without overlap, reminds once per day, and stop drains the current pass", async () => {
  let active = 0,
    overlap = false,
    calls = 0,
    reminders = 0;
  const r = createLifecycleRuntime({
    enabled: true,
    intervalMs: 2,
    now: () => new Date("2026-10-14T16:00Z"),
    pass: async (options) => {
      calls++;
      reminders += Number(options.reminders);
      active++;
      overlap ||= active > 1;
      await delay(5);
      active--;
      return { counts: { errors: 0 } };
    },
    report: () => {},
  });
  await r.start();
  await r.start();
  await delay(25);
  await r.stop();
  const stopped = calls;
  await delay(10);
  assert.equal(calls, stopped);
  assert.equal(active, 0);
  assert.equal(overlap, false);
  assert.equal(reminders, 1);
  assert.ok(calls > 1);
});
test("failed pass is reported without private error text and retried on next tick", async () => {
  let calls = 0;
  const events: Record<string, unknown>[] = [];
  const r = createLifecycleRuntime({
    enabled: true,
    intervalMs: 2,
    pass: async () => {
      if (++calls === 1) throw Error("private data");
      return { counts: { errors: 0 } };
    },
    report: (event) => events.push(event),
  });
  await r.start();
  await delay(15);
  await r.stop();
  assert.ok(calls > 1);
  assert.equal(events[0].code, "pass_failed");
  assert.doesNotMatch(JSON.stringify(events), /private data/);
});

test("a daily opportunity survives a failed SQL pass crossing 20:00", async () => {
  let clock=new Date("2026-10-14T16:59:59Z"),attempts=0,successes=0;
  const r=createLifecycleRuntime({enabled:true,intervalMs:1,now:()=>clock,report:()=>{},
    pass:async ({reminders,reminderAt})=>{
      if (reminders) {
        assert.equal(reminderAt!.toISOString(),"2026-10-14T16:00:00.000Z");
        if (++attempts===1) {clock=new Date("2026-10-14T17:00:01Z");throw Error("SQL unavailable")}
        successes++;
      }
      return {state:"send",counts:{errors:0}};
    }});
  try {await r.start();await delay(15)} finally {await r.stop()}
  assert.equal(successes,1);
});

test("fresh startup outside the scheduled window does not invent a daily send", async () => {
  let reminders=0;
  const r=createLifecycleRuntime({enabled:true,intervalMs:1,now:()=>new Date("2026-10-14T17:01Z"),report:()=>{},
    pass:async options=>{reminders+=Number(options.reminders);return {counts:{errors:0}}}});
  try {await r.start();await delay(10)} finally {await r.stop()}
  assert.equal(reminders,0);
});

test("throwing reporter cannot stop scheduling or leak a timer", async () => {
  let calls=0;
  const r=createLifecycleRuntime({enabled:true,intervalMs:1,report:()=>{throw Error("logger failed")},
    pass:async()=>{calls++;return {counts:{errors:0}}}});
  await r.start();await delay(10);await r.stop();const stopped=calls;
  await delay(10);assert.equal(calls,stopped);assert(calls>1);
});

async function advance(t: TestContext, milliseconds: number) {
  t.mock.timers.tick(milliseconds);
  // Drain the async pass and its scheduling continuation, without real sleeping.
  await new Promise<void>(resolve => setImmediate(resolve));
}

for (let day = 19; day <= 25; day++) {
  test(`week schedule on October ${day}: only Monday/Wednesday start reminders`, async t => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(`2026-10-${day}T15:59:59Z`) });
    let calls = 0, reminders = 0;
    const r = createLifecycleRuntime({ enabled: true, report: () => {},
      pass: async options => {
        calls++; reminders += Number(options.reminders);
        return { counts: { errors: 0 } };
      } });
    try {
      await r.start();
      await advance(t, 1000);
      await advance(t, 1);
      await advance(t, 5 * 60000);
      assert.equal(reminders, day === 19 || day === 21 ? 1 : 0);
      assert.ok(calls >= 2, "status polling continues on all days");
      assert.ok(calls <= 3, "an off-day crossing must not create an immediate polling loop");
    } finally { await r.stop(); }
  });
}

test("a slow status pass crossing Thursday 19 MSK does not create a reminder", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-10-22T15:59:59Z") });
  let calls = 0, reminders = 0;
  const r = createLifecycleRuntime({ enabled: true, report: () => {},
    pass: async options => {
      calls++; reminders += Number(options.reminders);
      if (calls === 1) t.mock.timers.tick(2000);
      return { counts: { errors: 0 } };
    } });
  try {
    await r.start();
    await advance(t, 1); assert.equal(calls, 1);
    await advance(t, 299999); assert.equal(calls, 2);
    assert.equal(reminders, 0);
  } finally { await r.stop(); }
});

test("empty queue polls every five minutes, not every five seconds", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-10-21T15:00Z") });
  let calls = 0;
  const r = createLifecycleRuntime({ enabled: true, report: () => {},
    pass: async () => { calls++; return { state: "idle", counts: { errors: 0 } }; } });
  try {
    await r.start();
    assert.equal(calls, 1, "startup still reads persisted work immediately");
    await advance(t, 299999); assert.equal(calls, 1);
    await advance(t, 1); assert.equal(calls, 2);
  } finally { await r.stop(); }
});

for (const activity of ["sent", "deferred", "failed", "stale", "errors"] as const) {
  test(`${activity} work retries after five seconds, then returns to idle polling`, async t => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-10-21T15:00Z") });
    let calls = 0;
    const r = createLifecycleRuntime({ enabled: true, report: () => {},
      pass: async () => ({ counts: { errors: 0, ...(calls++ === 0 ? { [activity]: 1 } : {}) } }) });
    try {
      await r.start();
      await advance(t, 4999); assert.equal(calls, 1);
      await advance(t, 1); assert.equal(calls, 2);
      await advance(t, 299999); assert.equal(calls, 2);
      await advance(t, 1); assert.equal(calls, 3);
    } finally { await r.stop(); }
  });
}

test("idle five-minute timer wakes exactly at 19 MSK and checks the day only once", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-10-21T15:58:13Z") });
  const reminders: string[] = [];
  let calls = 0;
  const r = createLifecycleRuntime({ enabled: true, report: () => {},
    pass: async options => {
      calls++;
      if (options.reminders) reminders.push(options.now.toISOString());
      return { state: "send", counts: { errors: 0 } };
    } });
  try {
    await r.start();
    await advance(t, 106999); assert.equal(calls, 1);
    await advance(t, 1);
    assert.deepEqual(reminders, ["2026-10-21T16:00:00.000Z"]);
    await advance(t, 300000); assert.equal(calls, 3); assert.equal(reminders.length, 1);
  } finally { await r.stop(); }
});

test("pending daily batch drains every five seconds, without a five-minute pause", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-10-21T16:00Z") });
  const checks: boolean[] = [];
  const r = createLifecycleRuntime({ enabled: true, report: () => {},
    pass: async options => {
      checks.push(options.reminders);
      return { state: "send", counts: { errors: 0, deferred: checks.length < 3 ? 1 : 0 } };
    } });
  try {
    await r.start();
    await advance(t, 5000); await advance(t, 5000);
    assert.deepEqual(checks, [true, true, true]);
    await advance(t, 299999); assert.equal(checks.length, 3);
    await advance(t, 1); assert.deepEqual(checks, [true, true, true, false]);
  } finally { await r.stop(); }
});

test("a slow in-flight pass crossing 19 MSK schedules the daily check immediately", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-10-21T15:59:59Z") });
  let calls = 0, reminders = 0;
  const r = createLifecycleRuntime({ enabled: true, report: () => {},
    pass: async options => {
      calls++; reminders += Number(options.reminders);
      if (calls === 1) t.mock.timers.tick(2000);
      return { counts: { errors: 0 } };
    } });
  try {
    await r.start(); assert.equal(reminders, 0);
    await advance(t, 1); assert.equal(calls, 2); assert.equal(reminders, 1);
  } finally { await r.stop(); }
});

test("disabled daily reminders do not shorten the idle timer near 19 MSK", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-10-21T15:59Z") });
  let calls = 0;
  const r = createLifecycleRuntime({ enabled: true, remindersEnabled: false, report: () => {},
    pass: async options => { calls++; assert.equal(options.reminders, false); return { counts: { errors: 0 } }; } });
  try {
    await r.start(); await advance(t, 60000); assert.equal(calls, 1);
    await advance(t, 240000); assert.equal(calls, 2);
  } finally { await r.stop(); }
});

test("unknown SQL outcome keeps the five-second retry rather than assuming an empty queue", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-10-21T15:00Z") });
  let calls = 0;
  const r = createLifecycleRuntime({ enabled: true, report: () => {},
    pass: async () => { if (++calls === 1) throw Error("synthetic SQL outage"); return { counts: { errors: 0 } }; } });
  try {
    await r.start(); await advance(t, 5000); assert.equal(calls, 2);
  } finally { await r.stop(); }
});
