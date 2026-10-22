import { testMessageConfig } from "./message-config.test-helper.mts";
import { memoryProgress } from "./memory-progress.test-helper.mts";
import assert from "node:assert/strict";
import test from "node:test";
import { runLifecyclePass, type LifecycleStore } from "./pass.mts";
import { ACCOUNT_KINDS, type Client } from "./policy.ts";
const now = new Date("2026-10-14T16:00:00Z");
const client: Client = {
  id: 1,
  name: "Test",
  status: "onboarding",
  role: "ученик",
  market: "ru",
  tag: "@test_student",
  chatId: "-10012345",
  googleFolder: "https://example.invalid/drive",
  hardMentor: "@test_mentor",
  indicators: Object.fromEntries(
    ACCOUNT_KINDS.map((k) => [k, "заполнен"]),
  ) as Client["indicators"],
  missingPersonal: [],
  missingStopList: false,
};
function fixture() {
  let cursor = "0",
    reads = 0,
    sends = 0;
  const claimed = new Set<string>();
  const rows = [1, 2, 3].map((id) => ({
    client: { ...client, id },
    statusChangeId: String(id),
    statusChangedAt: now,
    lastSentAt: null,
    lastHHTransitionAt: null,
  }));
  const progress=memoryProgress();
  const store: LifecycleStore = {
    ...progress,
    activation: async () => ({
      activatedAt: new Date("2026-10-01"),
      statusCursor: cursor,
    }),
    clients: async () => {
      reads++;
      return rows;
    },
    changes: async (_cursor,at=now) =>
      progress.select(rows.map((r) => ({
          id: r.statusChangeId,
          clientId: r.client.id,
          oldStatus: null,
          newStatus: "onboarding",
          at: now,
        })),at),
    advanceCursor: async (value) => {
      cursor = value;
    },
    delivery: {
      claim: async (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      finish: async () => {},
    },
  };
  const send = async () => {
    sends++;
    return { outcome: "sent" as const, messageId: sends };
  };
  return {
    store,
    rows,
    claimed,
    send,
    cursor: () => cursor,
    reads: () => reads,
    sends: () => sends,
  };
}
const options = {
  now,
  apply: true,
  statuses: true,
  reminders: false,
  messageConfig: testMessageConfig, supportChatId: "999",
};
test("unactivated worker does not read clients or deliver", async () => {
  const f = fixture();
  f.store.activation = async () => null;
  assert.equal(
    (await runLifecyclePass({ ...options, ...f })).state,
    "not_activated",
  );
  assert.equal(f.reads(), 0);
  assert.equal(f.sends(), 0);
});
test("dry run neither writes cursor/claims nor sends", async () => {
  const f = fixture();
  await runLifecyclePass({ ...options, ...f, apply: false });
  assert.equal(f.cursor(), "0");
  assert.equal(f.claimed.size, 0);
  assert.equal(f.sends(), 0);
});
test("one SQL failure does not stop other clients or lose the cursor; restart does not resend", async () => {
  const f = fixture(),
    claim = f.store.delivery.claim;
  f.store.delivery.claim = async (...args) => {
    if (args[0] === "status:2") throw new Error("offline");
    return claim(...args);
  };
  const first = await runLifecyclePass({ ...options, ...f });
  assert.equal(first.counts.errors, 1);
  assert.equal(f.sends(), 2);
  assert.equal(f.cursor(), "3");
  f.store.delivery.claim = claim;
  await runLifecyclePass({ ...options, ...f, now:new Date(now.getTime()+61000) });
  assert.equal(f.sends(), 3);
  assert.equal(f.cursor(), "3");
});
test("every real transition sends once after A -> B -> A", async () => {
  const f = fixture();
  f.rows[0].statusChangeId = "3";
  f.store.changes = async () =>
    [1, 2, 3].map((id) => ({
      id: String(id),
      clientId: 1,
      oldStatus: null,
      newStatus: id === 2 ? "studying" : "onboarding",
      at: now,
    }));
  await runLifecyclePass({ ...options, ...f });
  assert.equal(f.sends(), 2);
});
test("idle polling outside reminder time does not scan all clients", async () => {
  const f = fixture();
  f.store.changes = async () => [];
  await runLifecyclePass({
    ...options,
    ...f,
    reminders: true,
    now: new Date("2026-10-14T12:00Z"),
  });
  assert.equal(f.reads(), 0);
  assert.equal(f.sends(), 0);
});

test("Thursday cannot create a reminder batch, even when requested explicitly", async () => {
  const f = fixture();
  let begins = 0;
  f.store.beginDay = async () => { begins++; };
  await runLifecyclePass({ ...options, ...f, statuses: false, reminders: true,
    now: new Date("2026-10-22T16:00Z") });
  assert.equal(begins, 0);
  assert.equal(f.reads(), 0);
  assert.equal(f.sends(), 0);
});

test("status events keep sending on Thursday outside the reminder schedule", async () => {
  const f = fixture();
  await runLifecyclePass({ ...options, ...f, reminders: true,
    now: new Date("2026-10-22T16:00Z") });
  assert.equal(f.sends(), 3);
  assert.deepEqual([...f.claimed], ["status:1", "status:2", "status:3"]);
});

test("pacing leaves status events eligible next pass, not delayed by error backoff", async () => {
  const f = fixture(), claim = f.store.delivery.claim;
  let available = true;
  f.store.delivery.claim = async (...args) => {
    if (!available) return "deferred";
    const result = await claim(...args);
    if (result === true) available = false;
    return result;
  };
  await runLifecyclePass({ ...options, ...f });
  assert.equal(f.sends(), 1);
  assert.equal((await f.store.changes("0", new Date(now.getTime() + 5000))).length, 2);
  available = true;
  await runLifecyclePass({ ...options, ...f, now: new Date(now.getTime() + 5000) });
  assert.equal(f.sends(), 2);
  available = true;
  await runLifecyclePass({ ...options, ...f, now: new Date(now.getTime() + 10000) });
  assert.equal(f.sends(), 3);
  assert.equal((await f.store.changes("0", new Date(now.getTime() + 15000))).length, 0);
});
