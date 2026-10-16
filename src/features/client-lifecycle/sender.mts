import { createRequire } from "node:module";
import type { Sender } from "./pass.mts";

/** Existing Telegram adapter; loaded only for an actual delivery. */
export function createClientSender(
  supportChatId: string, env: NodeJS.ProcessEnv = process.env,
): Sender {
  let telegram: ReturnType<typeof import("../../integrations/telegram/index.ts").telegramForReports> | undefined;
  return async (chatId, text) => {
    if (!telegram) {
      const facade = createRequire(import.meta.url)(
        "../../integrations/telegram/index.ts",
      ) as typeof import("../../integrations/telegram/index.ts");
      telegram = facade.telegramForReports(supportChatId, env);
    }
    const result = await telegram.sendOne({ chatId, text });
    if (result.kind === "client-failure")
      return {
        outcome: ["validation", "configuration"].includes(result.failure.stage) ? "failed" : "uncertain",
        code: result.failure.stage,
      };
    return result.response.ok
      ? { outcome: "sent", messageId: result.response.result.message_id }
      : {
          outcome: "failed", code: `telegram_${result.response.error_code}`,
          ...(result.response.parameters?.retry_after != null
            ? { retryAfterSeconds: result.response.parameters.retry_after } : {}),
        };
  };
}
