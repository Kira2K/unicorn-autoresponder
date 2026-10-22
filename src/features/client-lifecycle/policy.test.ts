import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCOUNT_KINDS,
  isReminderWindow,
  planReminder,
  planStatusMessage,
  type Client,
} from "./policy.ts";
const client = (patch: Partial<Client> = {}): Client => ({
  id: 1,
  name: "Тест",
  status: "studying",
  role: "ученик",
  market: "ru",
  tag: "@test_student",
  chatId: "-100123456",
  googleFolder: "https://example.invalid/drive",
  hardMentor: "@test_mentor",
  indicators: Object.fromEntries(
    ACCOUNT_KINDS.map((k) => [k, "заполнен"]),
  ) as Client["indicators"],
  missingPersonal: [],
  missingStopList: false,
  ...patch,
});
const at = (s: string) => new Date(s);
const enabled = at("2026-10-01T10:00:00Z");
const state = {
  now: at("2026-10-14T16:00:00Z"),
  activatedAt: enabled,
  statusChangedAt: at("2026-10-02T10:00:00Z"),
  lastSentAt: null,
  statusChangeId: "2",
};
test("same status and events before activation never send", () => {
  const c = client({ status: "onboarding" });
  for (const change of [
    {
      id: "1",
      oldStatus: "onboarding",
      newStatus: "onboarding",
      at: state.now,
    },
    { id: "2", oldStatus: "studying", newStatus: "onboarding", at: enabled },
  ])
    assert.equal(planStatusMessage(c, change, enabled).kind, "skip");
});
test("each supported transition gets the immutable history ID as its deduplication key", () => {
  for (const status of [
    "onboarding",
    "hh_ru process",
    "hh_both process",
    "hh_en process",
  ]) {
    const result = planStatusMessage(
      client({ status }),
      { id: "99", oldStatus: "studying", newStatus: status, at: state.now },
      enabled,
    );
    assert.equal(result.kind, "send");
    if (result.kind === "send") assert.equal(result.key, "status:99");
  }
});
test("missing role/chat/tag/Drive/hard mentor produces an error, not a partial greeting", () => {
  for (const patch of [
    { role: "" },
    { chatId: "" },
    { tag: "" },
    { googleFolder: "" },
    { hardMentor: "" },
  ])
    assert.equal(
      planStatusMessage(
        client({ status: "onboarding", ...patch }),
        { id: "9", oldStatus: null, newStatus: "onboarding", at: state.now },
        enabled,
      ).kind,
      "error",
    );
  assert.equal(
    planStatusMessage(
      client({ status: "onboarding", role: "клиент", hardMentor: "" }),
      { id: "9", oldStatus: null, newStatus: "onboarding", at: state.now },
      enabled,
    ).kind,
    "send",
  );
});
test("referral/fake/blank roles do not get student reminders", () => {
  for (const role of ["реферал", "фейк", "клиент", ""])
    assert.equal(
      planReminder(client({ role, missingStopList: true }), state).kind,
      "skip",
    );
});
test("all inactive and unknown statuses are excluded", () => {
  for (const status of [
    "paused",
    "graduated",
    "blacklisted",
    "left",
    "unknown",
    "test",
    "",
  ])
    assert.equal(
      planReminder(client({ status, missingStopList: true }), state).kind,
      "skip",
    );
});
test("no missing fields means no reminder", () =>
  assert.equal(planReminder(client(), state).kind, "skip"));
test("48h cooldown is measured from the last sent reminder, not activation", () => {
  const c = client({ missingStopList: true });
  assert.equal(
    planReminder(c, {
      ...state,
      lastSentAt: new Date(state.now.getTime() - 48 * 3600000 + 1),
    }).kind,
    "skip",
  );
  assert.equal(
    planReminder(c, {
      ...state,
      lastSentAt: new Date(state.now.getTime() - 48 * 3600000),
    }).kind,
    "send",
  );
  assert.equal(
    planReminder(c, { ...state, activatedAt: state.now }).kind,
    "send",
  );
});
test("HH transition restarts the 48h clock", () =>
  assert.equal(
    planReminder(client({ status: "hh_ru process", missingStopList: true }), {
      ...state,
      statusChangedAt: new Date(state.now.getTime() - 47 * 3600000),
    }).kind,
    "skip",
  ));
test("onboarding waits seven complete days and never invents a missing historical date", () => {
  const c = client({ status: "onboarding", missingStopList: true });
  assert.equal(
    planReminder(c, {
      ...state,
      statusChangedAt: new Date(state.now.getTime() - 7 * 86400000 + 1),
    }).kind,
    "skip",
  );
  assert.equal(
    planReminder(c, {
      ...state,
      statusChangedAt: new Date(state.now.getTime() - 7 * 86400000),
    }).kind,
    "send",
  );
  assert.equal(
    planReminder(c, { ...state, statusChangedAt: null }).kind,
    "error",
  );
});
test("only the 19h Moscow window sends; midnight and other times skip", () => {
  for (const hour of [0, 15, 17, 23])
    assert.equal(
      planReminder(client({ missingStopList: true }), {
        ...state,
        now: at(`2026-10-14T${String(hour).padStart(2, "0")}:00:00Z`),
      }).kind,
      "skip",
    );
});

test("reminders are scheduled only on Monday and Wednesday, 19:00–19:59 Moscow", () => {
  for (let day = 19; day <= 25; day++) {
    const expected = day === 19 || day === 21;
    for (const time of ["16:00:00.000", "16:59:59.999"]) {
      const now = at(`2026-10-${day}T${time}Z`);
      assert.equal(isReminderWindow(now), expected, now.toISOString());
      assert.equal(planReminder(client({ missingStopList: true }), { ...state, now }).kind,
        expected ? "send" : "skip", now.toISOString());
    }
    for (const time of ["15:59:59.999", "17:00:00.000"])
      assert.equal(isReminderWindow(at(`2026-10-${day}T${time}Z`)), false);
  }
  assert.equal(isReminderWindow(at("2026-10-19T12:00:00-04:00")), true);
  assert.equal(isReminderWindow(at("2026-10-18T21:00:00Z")), false);
  assert.equal(isReminderWindow(at("invalid")), false);
});
test("matrix follows status and market; RU ignores foreign accounts and HH comes later", () => {
  const indicators = Object.fromEntries(
    ACCOUNT_KINDS.map((k) => [k, "не заполнен"]),
  ) as Client["indicators"];
  const expect = [
    ["studying", "ru", 3],
    ["studying", "en", 7],
    ["hh_ru process", "ru", 4],
    ["hh_both process", "both", 8],
    ["hh_en process", "en", 9],
    ["on en market", "both", 9],
  ] as const;
  for (const [status, market, count] of expect) {
    const result = planReminder(client({ status, market, indicators }), state);
    assert.equal(result.kind, "send");
    if (result.kind === "send") assert.equal(result.missing!.length, count);
  }
});
test("missing market or impossible RU state goes to support, never to the student", () => {
  assert.equal(
    planReminder(client({ market: null, missingStopList: true }), state).kind,
    "error",
  );
  assert.equal(
    planReminder(
      client({ market: "ru", status: "hh_en process", missingStopList: true }),
      state,
    ).kind,
    "error",
  );
});
test("personal data, stop list, then accounts in the exact message order", () => {
  const c = client({
    missingPersonal: ["Имя", "Образование"],
    missingStopList: true,
  });
  c.indicators.email_ru = "не заполнен";
  const result = planReminder(c, state);
  assert.equal(result.kind, "send");
  if (result.kind === "send")
    assert.deepEqual(result.missing, [
      "Имя",
      "Образование",
      "Стоп-лист компаний",
      "Почта для российского рынка",
    ]);
});

test("invalid history and incomplete indicators never appear complete or send a greeting", () => {
  assert.equal(
    planStatusMessage(
      client({ status: "onboarding" }),
      {
        id: "1",
        oldStatus: null,
        newStatus: "onboarding",
        at: new Date("invalid"),
      },
      enabled,
    ).kind,
    "error",
  );
  assert.equal(
    planReminder(client(), { ...state, lastSentAt: new Date("invalid") })
      .kind,
    "error",
  );
  assert.equal(
    planReminder(client({ indicators: {} as Client["indicators"] }), state)
      .kind,
    "error",
  );
});
