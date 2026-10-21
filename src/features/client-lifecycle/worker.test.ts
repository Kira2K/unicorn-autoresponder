import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_KINDS, planStatusMessage, type Client } from "./policy.ts";
import { deliverPlan, type Delivery, type Store } from "./worker.ts";
import { messageText, testMessageConfig } from "./message-config.test-helper.mts";
const now = new Date("2026-10-14T16:00:00Z");
const client: Client = {
  id: 1,
  name: "Искусственный ученик",
  status: "onboarding",
  role: "ученик",
  market: "en",
  tag: "@test_student",
  chatId: "-10012345",
  hardMentor: "@hard_mentor",
  googleFolder: "https://example.invalid/drive",
  indicators: Object.fromEntries(
    ACCOUNT_KINDS.map((k) => [k, "заполнен"]),
  ) as Client["indicators"],
  missingPersonal: [],
  missingStopList: false,
};
const plan = planStatusMessage(
  client,
  { id: "7", oldStatus: null, newStatus: "onboarding", at: now },
  new Date("2026-10-01"),
);
function fixture() {
  const claimed = new Set<string>(),
    results: Delivery[] = [];
  let sends = 0;
  const store: Store = {
    async claim(key) {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    async finish(_key, result) {
      results.push(result);
    },
  };
  return {
    store,
    results,
    send: async () => {
      sends++;
      return { outcome: "sent", messageId: 10 } as Delivery;
    },
    count: () => sends,
  };
}
test("disabled default does not read or write the store and does not send", async () => {
  const f = fixture();
  await deliverPlan({
    client,
    plan,
    now,
    enabled: false,
    store: f.store,
    messageConfig: testMessageConfig, supportChatId: "12345",
    send: f.send,
  });
  assert.equal(f.count(), 0);
});

test('sender receives destination context separately from the unchanged message',async()=>{
  const f=fixture();
  assert.ok(plan.kind==='send');
  const sendPlan=plan;
  let context:unknown;
  await deliverPlan({client,plan,now,enabled:true,store:f.store,messageConfig:testMessageConfig,supportChatId:'12345',
    send:async(chat,text,metadata)=>{
      assert.equal(chat,client.chatId);
      assert.equal(text,messageText(client,sendPlan));
      context=metadata;
      return {outcome:'sent',messageId:1};
    }});
  assert.deepEqual(context,{clientId:client.id,clientName:client.name,chatPurpose:'Общий чат ученика'});
});
test("double click, duplicate worker and restart use one durable claim", async () => {
  const f = fixture();
  const input = {
    client,
    plan,
    now,
    enabled: true,
    store: f.store,
    messageConfig: testMessageConfig, supportChatId: "12345",
    send: f.send,
  };
  await Promise.all([deliverPlan(input), deliverPlan(input)]);
  await deliverPlan({ ...input });
  assert.equal(f.count(), 1);
  assert.equal(f.results.length, 1);
});
test("lost SQL claim response cannot cause a send", async () => {
  const f = fixture();
  f.store.claim = async () => {
    throw new Error("connection lost");
  };
  await assert.rejects(
    deliverPlan({
      client,
      plan,
      now,
      enabled: true,
      store: f.store,
      messageConfig: testMessageConfig, supportChatId: "12345",
      send: f.send,
    }),
  );
  assert.equal(f.count(), 0);
});
test("uncertain send is logged and never repeated", async () => {
  const f = fixture();
  let attempts = 0;
  const input = {
    client,
    plan,
    now,
    enabled: true,
    store: f.store,
    messageConfig: testMessageConfig, supportChatId: "12345",
    send: async () => {
      attempts++;
      throw new Error("lost reply");
    },
  };
  await deliverPlan(input);
  await deliverPlan(input);
  assert.equal(attempts, 1);
  assert.equal(f.results[0].outcome, "uncertain");
});
test("lost result persistence keeps the claim and prevents a second delivery", async () => {
  const f = fixture();
  f.store.finish = async () => {
    throw new Error("connection lost");
  };
  const input = {
    client,
    plan,
    now,
    enabled: true,
    store: f.store,
    messageConfig: testMessageConfig, supportChatId: "12345",
    send: f.send,
  };
  await assert.rejects(deliverPlan(input));
  await deliverPlan(input);
  assert.equal(f.count(), 1);
});
test("missing data report goes exclusively to the supplied support chat", async () => {
  const f = fixture();
  const broken = { ...client, hardMentor: "" };
  const p = planStatusMessage(
    broken,
    { id: "9", oldStatus: null, newStatus: "onboarding", at: now },
    new Date("2026-10-01"),
  );
  const chats: string[] = [];
  await deliverPlan({
    client: broken,
    plan: p,
    now,
    enabled: true,
    store: f.store,
    messageConfig: testMessageConfig, supportChatId: "999",
    send: async (chat) => {
      chats.push(chat);
      return { outcome: "sent", messageId: 1 };
    },
  });
  assert.deepEqual(chats, ["999"]);
});
test("fixed greeting includes hard mentor only for the student role", () => {
  assert.equal(plan.kind, "send");
  if (plan.kind !== "send") return;
  const text = messageText(client, plan);
  assert.match(text, /@hard_mentor будет твоим ментором по хардам\./);
  assert.match(
    text,
    /Твоя папка на Гугл-диске: https:\/\/example.invalid\/drive/,
  );
  assert.doesNotMatch(
    messageText({ ...client, role: "клиент" }, plan),
    /будет твоим ментором/,
  );
});

test("a formatting/configuration failure happens before any durable claim or send", async () => {
  let claims=0, sends=0;
  await assert.rejects(deliverPlan({client,plan,now,enabled:true,
    messageConfig:undefined as unknown as typeof testMessageConfig,supportChatId:'999',
    store:{claim:async()=>{claims++;return true},finish:async()=>{}},
    send:async()=>{sends++;return {outcome:'sent',messageId:1}}}));
  assert.equal(claims,0);assert.equal(sends,0);
});
