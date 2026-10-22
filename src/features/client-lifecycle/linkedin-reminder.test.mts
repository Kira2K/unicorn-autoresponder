import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ACCOUNT_KINDS, planReminder, type Client } from "./policy.ts";
import { clientLifecycleStore } from "./postgres-store.mts";
import { COPY_MARKER, type SqlPool } from "../../integrations/postgres/contracts.mts";
import { messageText } from "./message-config.test-helper.mts";

const fields = ["url", "login", "password"] as const;
const detailsByMask = ["", "ссылка на профиль", "логин", "ссылка на профиль и логин", "пароль",
  "ссылка на профиль и пароль", "логин и пароль", "ссылка на профиль, логин и пароль"];
const originalTemplate: string = JSON.parse(readFileSync(new URL("./tas-143-messages.json", import.meta.url), "utf8"))[4];
const secret = "synthetic-linkedin-password-not-for-messages";
const state = { now: new Date("2026-10-26T16:00Z"), activatedAt: new Date("2026-09-01T00:00Z"),
  statusChangedAt: null, statusChangeId: null, lastSentAt: null };

async function readClient(presence: Record<string, boolean> | null) {
  const queries: string[] = [];
  const row = { id: 1, client_name: "Synthetic", client_status: "studying", client_role: "ученик", market_id: 2,
    telegram_personal_chat_id: "@test_student", telegram_general_chat_id: "-100123456", google_folder: "https://example.invalid/drive",
    tg_hard_mentor: "@test_mentor", indicators: Object.fromEntries(ACCOUNT_KINDS.map(k => [k, "заполнен"])),
    first_name: "Synthetic", last_name: "Student", fio: "Synthetic Student", birth_date: "2000-01-01", english_levels_id: 1,
    ready_for_interview_in_english_in_2_months: "No", real_location: "City", desired_location: "Remote",
    calendar_email: "synthetic@example.invalid", no_higher_education: true, stop_list_company: "Company",
    linkedin_fields: presence, password: secret };
  const pool: SqlPool = { async end() {}, async connect() { return { release() {}, async query(sql) {
    queries.push(sql);
    if (sql.includes("current_database()")) return { rows: [{ database: "unicorn_noco_copy_restore", marker: COPY_MARKER }] };
    if (sql.includes("SELECT c.id,c.client_name")) return { rows: [row] };
    return { rows: [] };
  } }; } };
  return { client: (await clientLifecycleStore(pool, "unicorn_noco_copy_restore").clients())[0].client, queries };
}

test("LinkedIn reminders enumerate exactly the missing link/login/password, regardless of the old indicator", async () => {
  for (let mask = 0; mask < 8; mask++) {
    const { client, queries } = await readClient(Object.fromEntries(fields.map((f, i) => [f, !(mask & (1 << i))])));
    // The old common indicator only tests login/phone, not all LinkedIn fields.
    client.indicators.linkedin = mask ? "заполнен" : "не заполнен";
    const plan = planReminder(client, state);
    assert.equal(plan.kind, mask ? "send" : "skip", `mask ${mask}`);
    if (plan.kind === "send") {
      const item = `Аккаунт LinkedIn: ${detailsByMask[mask]}`;
      assert.deepEqual(plan.missing, [item]);
      assert.equal(messageText(client, plan), originalTemplate
        .replaceAll("@{тег}", "@test_student")
        .replace("{список незаполненных пунктов}", `— ${item}`),
        "only the LinkedIn list item changes; the entire approved notification remains intact");
      assert.doesNotMatch(messageText(client, plan), new RegExp(secret));
    }
    assert.doesNotMatch(JSON.stringify(client), new RegExp(secret));
    assert(queries.some(sql => sql.includes("AS linkedin_fields")), "SQL returns a presence summary, not credentials");
    assert(queries.every(sql => !/INSERT|UPDATE|DELETE/.test(sql)), "the account check is read-only");
  }
});

test("no LinkedIn account requests all three fields; RU still does not request LinkedIn", async () => {
  const { client } = await readClient(null);
  const plan = planReminder(client, state);
  assert.equal(plan.kind, "send");
  if (plan.kind === "send") assert.deepEqual(plan.missing, ["Аккаунт LinkedIn: ссылка на профиль, логин и пароль"]);
  assert.equal(planReminder({ ...client, market: "ru" }, state).kind, "skip");
});

const port = Number(process.env.CLIENTS_LOCAL_TEST_PORT);
test("real artificial SQL: LinkedIn field presence, whitespace, deleted accounts and duplicates", { skip: !port }, async () => {
  assert.equal(process.env.CLIENTS_LOCAL_TEST_HOST, "127.0.0.1");
  assert(port >= 1024 && port <= 65535);
  const { Pool } = createRequire(import.meta.url)("pg");
  const pool = new Pool({ host: "127.0.0.1", port, user: "postgres", database: "unicorn_noco_copy_restore", max: 2 });
  const store = clientLifecycleStore(pool, "unicorn_noco_copy_restore");
  try {
    const identity = (await pool.query("SELECT current_database() AS database, shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
    assert.equal(identity.database, "unicorn_noco_copy_restore"); assert.equal(identity.marker, COPY_MARKER);
    await pool.query("INSERT INTO noco.clients(id,client_name,client_status,client_role,market_id) VALUES(9001,'Synthetic LinkedIn reminder','studying','ученик',2)");
    const missing = async () => {
      const row = (await store.clients()).find(r => r.client.id === 9001)!;
      assert.doesNotMatch(JSON.stringify(row), new RegExp(secret));
      return (row.client as Client & { linkedinMissing?: string[] }).linkedinMissing;
    };
    assert.deepEqual(await missing(), [...fields]);
    await pool.query("INSERT INTO noco.platform_accounts(id,clients_id,platforms_id) VALUES(9001,9001,5)");
    for (let mask = 0; mask < 8; mask++) {
      await pool.query("UPDATE noco.platform_accounts SET url=$1,login=$2,password=$3 WHERE id=9001",
        fields.map((_, i) => mask & (1 << i) ? (i === 0 ? null : "   ") : ["https://example.invalid/profile", "synthetic-login", secret][i]));
      assert.deepEqual(await missing(), fields.filter((_, i) => mask & (1 << i)), `mask ${mask}`);
    }
    await pool.query("UPDATE noco.platform_accounts SET url='https://example.invalid/profile',login='synthetic-login',password=NULL WHERE id=9001");
    await pool.query("INSERT INTO noco.platform_accounts(id,clients_id,platforms_id,password) VALUES(9002,9001,5,$1)", [secret]);
    assert.deepEqual(await missing(), ["password"], "credentials from different accounts must not be merged");
    await pool.query("UPDATE noco.platform_accounts SET url='https://example.invalid/second',login='synthetic-second' WHERE id=9002");
    assert.deepEqual(await missing(), [], "one complete active account is sufficient");
    await pool.query("UPDATE noco.platform_accounts SET __nc_deleted=true WHERE id=9002");
    assert.deepEqual(await missing(), ["password"], "a deleted complete account must not hide missing data");
    await pool.query("UPDATE noco.platform_accounts SET platforms_id=4 WHERE id=9001");
    assert.deepEqual(await missing(), [...fields], "other platform types must not satisfy LinkedIn");
  } finally { await pool.end(); }
});
