import assert from "node:assert/strict";
import test from "node:test";
import { readClientMessageConfig } from "./message-config.mts";
import { testMessageConfig } from "./message-config.test-helper.mts";

const settings = { ...testMessageConfig };
test("message settings preserve the approved URL including query/fragment", () => {
  const url = "https://example.invalid/instructions?source=test#section";
  assert.deepEqual(readClientMessageConfig({ ...settings, instructionsUrl: url }),
    { ...testMessageConfig, instructionsUrl: url });
});
test("each absent setting fails closed without including secret values in the error", () => {
  for (const key of Object.keys(settings)) {
    const invalid = { ...settings, [key]: " " };
    assert.throws(() => readClientMessageConfig(invalid), error => {
      assert.equal((error as Error).message, "client_message_configuration_required:" + key);
      assert.doesNotMatch((error as Error).message, /synthetic-cabinet-password/);
      return true;
    });
  }
});
test("malformed and credential-bearing instruction URLs are rejected", () => {
  for (const value of ["relative", "javascript:alert(1)", "file:///data", "https://user:password@example.invalid/", "https://example.invalid/ two"]) {
    assert.throws(() => readClientMessageConfig({ ...settings, instructionsUrl: value }),
      /client_message_configuration_invalid:instructionsUrl/);
  }
});
test("the configured support mention must be one valid tag, not arbitrary message text", () => {
  for (const value of ["not-a-tag", "@x", "@synthetic support", "@synthetic\nextra"]) {
    assert.throws(() => readClientMessageConfig({ ...settings, supportTag: value }),
      /client_message_configuration_invalid:supportTag/);
  }
});
