import { messageText as render } from "./templates.ts";
import type { ClientMessageConfig } from "./message-config.mts";

export const testMessageConfig: ClientMessageConfig = {
  instructionsUrl: "https://example.invalid/instructions",
  hhInstructionsUrl: "https://example.invalid/hh-instructions",
  cabinetUrl: "https://example.invalid/cabinet/",
  cabinetPassword: "synthetic-cabinet-password",
  supportTag: "@synthetic_test_support",
};
export const messageText = (client: Parameters<typeof render>[0], plan: Parameters<typeof render>[1]) =>
  render(client, plan, testMessageConfig);
