import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
test("disabled CLI opens neither PostgreSQL nor Telegram even with --send", () => {
  const result = spawnSync(
    process.execPath,
    ["src/features/client-lifecycle/cli.mts", "--send", "--activate"],
    {
      env: {
        ...process.env,
        CLIENT_LIFECYCLE_ENABLED: "0",
        APP_DB: "postgres",
        POSTGRES_HOST: "invalid.invalid",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    feature: "client-lifecycle",
    state: "disabled",
  });
});
