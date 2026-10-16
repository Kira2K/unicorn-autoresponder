import assert from "node:assert/strict";
import test from "node:test";
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
