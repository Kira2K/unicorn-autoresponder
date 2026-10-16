import assert from "node:assert/strict";
import { test } from "node:test";
import { COPY_MARKER, type SqlPool } from "../../integrations/postgres/contracts.mts";
import { clientLifecycleStore } from "./postgres-store.mts";
import { ACCOUNT_KINDS, planReminder, planStatusMessage } from "./policy.ts";

function fixture(options: {
  encode?: (iso: string) => unknown;
  optional?: unknown;
  client?: Record<string, unknown>;
} = {}) {
  const encode = options.encode ?? ((iso: string) => new Date(iso));
  const row = {
    id: 1, client_name: "Synthetic", client_status: "studying", client_role: "ученик", market_id: 1,
    telegram_personal_chat_id: "@test_student", telegram_general_chat_id: "-100123456",
    google_folder: "https://example.invalid/drive", tg_hard_mentor: "@test_mentor",
    indicators: Object.fromEntries(ACCOUNT_KINDS.map(kind => [kind, "заполнен"])),
    change_id: "2", status_changed_at: encode("2026-10-07T16:00:00.001Z"),
    last_sent_at: encode("2026-10-12T16:00:00.001Z"),
    last_hh_transition_at: encode("2026-10-12T16:00:00.002Z"),
    ...options.client,
  };
  if ("optional" in options) {
    row.status_changed_at = options.optional;
    row.last_sent_at = options.optional;
    row.last_hh_transition_at = options.optional;
  }
  const activation = encode("2026-10-14T16:00:00.100Z");
  const change = encode("2026-10-14T16:00:00.900Z");
  const scheduled = encode("2026-10-14T16:00:00.123Z");
  const pool: SqlPool = {
    async connect() {
      return {
        async query(sql) {
          if (sql === "BEGIN READ ONLY" || sql === "ROLLBACK") return { rows: [] };
          if (sql.includes("current_database()"))
            return { rows: [{ database: "unicorn_noco_copy_restore", marker: COPY_MARKER }] };
          if (sql.includes("SELECT activated_at,status_cursor"))
            return { rows: [{ activated_at: activation, status_cursor: "0" }] };
          if (sql.includes("SELECT c.id,c.client_name")) return { rows: [row] };
          if (sql.includes("SELECT h.id,h.client_id"))
            return { rows: [{ id: "2", client_id: 1, old_status: "studying", new_status: "onboarding", changed_at: change }] };
          if (sql.includes("SELECT scheduled_at")) return { rows: [{ scheduled_at: scheduled }] };
          throw new Error("Unexpected SQL in date read test");
        },
        release() {},
      };
    },
    async end() {},
  };
  return { store: clientLifecycleStore(pool, "unicorn_noco_copy_restore"), activation };
}

for (const representation of ["Date", "ISO string"] as const) {
  test(`all six PostgreSQL timestamps preserve milliseconds from ${representation}`, async () => {
    const { store, activation } = fixture({ encode: iso => representation === "Date" ? new Date(iso) : iso });
    const state = (await store.activation())!;
    const row = (await store.clients())[0];
    assert.equal(state.activatedAt.toISOString(), "2026-10-14T16:00:00.100Z");
    assert.equal(row.statusChangedAt!.toISOString(), "2026-10-07T16:00:00.001Z");
    assert.equal(row.lastSentAt!.toISOString(), "2026-10-12T16:00:00.001Z");
    assert.equal(row.lastHHTransitionAt!.toISOString(), "2026-10-12T16:00:00.002Z");
    assert.equal((await store.changes("0"))[0].at.toISOString(), "2026-10-14T16:00:00.900Z");
    assert.equal((await store.pendingDay())!.toISOString(), "2026-10-14T16:00:00.123Z");
    if (activation instanceof Date) {
      assert.notEqual(state.activatedAt, activation, "Do not share the driver's mutable Date");
      state.activatedAt.setTime(0);
      assert.equal(activation.toISOString(), "2026-10-14T16:00:00.100Z");
    }
  });
}

test("NULL dates stay NULL and invalid dates remain detectable by policy", async () => {
  const empty = (await fixture({ optional: null }).store.clients())[0];
  assert.equal(empty.statusChangedAt, null);
  assert.equal(empty.lastSentAt, null);
  assert.equal(empty.lastHHTransitionAt, null);
  const invalid = (await fixture({ optional: new Date(NaN) }).store.clients())[0];
  assert.ok(Number.isNaN(invalid.statusChangedAt!.getTime()));
  assert.equal(planReminder(invalid.client, {
    ...invalid, now: new Date("2026-10-14T16:00Z"), activatedAt: new Date("2026-09-01T00:00Z"),
  }).kind, "error");
});

test("a new transition later in the activation second is not skipped", async () => {
  const { store } = fixture();
  const client = (await store.clients())[0].client;
  const change = (await store.changes("0"))[0];
  const { activatedAt } = (await store.activation())!;
  assert.equal(planStatusMessage(client, change, activatedAt).kind, "send");
  assert.equal(planStatusMessage(client, { ...change, at: activatedAt }, activatedAt).kind, "skip");
  assert.equal(planStatusMessage(client, { ...change, at: new Date(activatedAt.getTime() - 1) }, activatedAt).kind, "skip");
});

test("onboarding read from pg waits seven complete days, including the last millisecond", async () => {
  const row = (await fixture({ optional: null, client: { client_status: "onboarding" } }).store.clients())[0];
  // Use an actual Date-valued SQL row for the status, without optional timers.
  const changed = (await fixture().store.clients())[0].statusChangedAt!;
  const state = { ...row, statusChangedAt: changed, activatedAt: new Date("2026-09-01T00:00Z") };
  assert.equal(planReminder(row.client, { ...state, now: new Date("2026-10-14T16:00:00.000Z") }).kind, "skip");
  assert.equal(planReminder(row.client, { ...state, now: new Date("2026-10-14T16:00:00.001Z") }).kind, "send");
});

for (const timer of ["lastSentAt", "lastHHTransitionAt"] as const) {
  test(`${timer} read from pg preserves the complete 48-hour cooldown`, async () => {
    const row = (await fixture().store.clients())[0];
    const timestamp = row[timer]!;
    const state = { ...row, lastSentAt: null, lastHHTransitionAt: null, [timer]: timestamp,
      activatedAt: new Date("2026-09-01T00:00Z") };
    const due = Date.parse(timer === "lastSentAt"
      ? "2026-10-12T16:00:00.001Z" : "2026-10-12T16:00:00.002Z") + 48 * 3600000;
    assert.equal(planReminder(row.client, { ...state, now: new Date(due - 1) }).kind, "skip");
    assert.equal(planReminder(row.client, { ...state, now: new Date(due) }).kind, "send");
  });
}
