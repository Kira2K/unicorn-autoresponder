import { messageText } from "./templates.ts";
import type { Client, MessagePlan } from "./policy.ts";
import type { ClientMessageConfig } from "./message-config.mts";
export type Delivery =
  | { outcome: "sent"; messageId: number }
  | { outcome: "failed"; code: string; retryAfterSeconds?: number }
  | { outcome: "uncertain"; code: string };
export type Store = {
  /** Atomic claim; only an explicit failed delivery may retry when due. */
  claim(
    key: string,
    clientId: number,
    kind: string,
    points: readonly string[],
    at: Date,
    expectedStatus: string,
    expectedClient?: Client,
  ): Promise<boolean | "stale" | "deferred">;
  finish(key: string, delivery: Delivery): Promise<void>;
};
/** External sends occur only after a durable claim. A missing SQL response never sends. */
export async function deliverPlan(input: {
  client: Client;
  plan: MessagePlan;
  now: Date;
  enabled: boolean;
  store: Store;
  supportChatId: string;
  messageConfig: ClientMessageConfig;
  send: (chatId: string, text: string) => Promise<Delivery>;
}) {
  if (!input.enabled || input.plan.kind === "skip") return { state: "skipped" };
  const plan = input.plan;
  const isError = plan.kind === "error";
  const chatId = isError ? input.supportChatId : plan.chatId;
  if (!/^-?\d+$/.test(chatId)) throw new Error("support_chat_required");
  const points = isError ? plan.fields : plan.missing ?? [];
  // A support alert must not consume the student's event key.
  const key = isError ? `error:${plan.key}` : plan.key;
  // Format before claiming: a configuration/formatting failure must not consume a delivery.
  const text = isError
    ? `Clients: не отправлено сообщение для ${input.client.name} (ID ${input.client.id}). Не заполнено: ${plan.fields.join(", ")}.`
    : messageText(input.client, plan, input.messageConfig);
  const claim = await input.store.claim(
    key,
    input.client.id,
    isError ? "support_error" : plan.stage,
    points,
    input.now,
    input.client.status,
    input.client,
  );
  if (claim !== true)
    return { state: claim === false ? "already_claimed" : claim };
  let delivery: Delivery;
  try {
    delivery = await input.send(
      chatId,
      text,
    );
  } catch {
    // An injected sender may throw after delivery. Never blindly repeat.
    delivery = { outcome: "uncertain", code: "send_result_unknown" };
  }
  // If this write fails, the durable claim stays. The next run does not send again.
  await input.store.finish(key, delivery);
  return { state: delivery.outcome };
}
