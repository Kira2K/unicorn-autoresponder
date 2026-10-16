import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { clientLifecycleStore } from "./postgres-store.mts";
const port = Number(process.env.CLIENTS_LOCAL_TEST_PORT);
test(
  "real local PostgreSQL: reload, durable claims, 48h guard, status guard and unchanged business rows",
  { skip: !port },
  async () => {
    assert(port >= 1024 && port <= 65535);
    assert.equal(process.env.CLIENTS_LOCAL_TEST_HOST, "127.0.0.1");
    const { Pool } = createRequire(import.meta.url)("pg");
    const pool = new Pool({
      host: "127.0.0.1",
      port,
      user: "postgres",
      database: "unicorn_noco_copy_restore",
      max: 2,
    });
    const store = clientLifecycleStore(pool, "unicorn_noco_copy_restore");
    try {
      const before = (
        await pool.query(
          "SELECT id,client_name,client_status FROM noco.clients ORDER BY id",
        )
      ).rows;
      assert.equal(await store.activation(), null);
      await pool.query(
        "INSERT INTO noco.client_notification_state VALUES(true,'2026-10-01T00:00:00Z',0)",
      );
      assert.equal((await store.activation())!.statusCursor, "0");
      const rows = await store.clients();
      assert.equal(rows.length, 5);
      const en = rows.find((r) => r.client.id === 2)!;
      assert.equal(en.client.market, "en");
      assert.equal(en.client.indicators.linkedin, "заполнен");
      assert(en.client.missingPersonal.includes("Образование"));
      assert.equal((await store.changes("0"))[0].newStatus, "onboarding");
      const now = new Date("2026-10-14T16:00:00Z");
      const claims = await Promise.all([
        store.delivery.claim(
          "reminder:2:1:day",
          2,
          "reminder",
          ["email"],
          now,
          "onboarding",
        ),
        store.delivery.claim(
          "reminder:2:1:day",
          2,
          "reminder",
          ["email"],
          now,
          "onboarding",
        ),
      ]);
      assert.equal(claims.filter(Boolean).length, 1);
      await store.delivery.finish("reminder:2:1:day", {
        outcome: "uncertain",
        code: "lost_response",
      });
      assert.equal(
        await clientLifecycleStore(
          pool,
          "unicorn_noco_copy_restore",
        ).delivery.claim(
          "reminder:2:1:day",
          2,
          "reminder",
          [],
          now,
          "onboarding",
        ),
        false,
      );
      assert.equal(
        await store.delivery.claim(
          "different-key",
          2,
          "reminder",
          [],
          new Date(now.getTime() + 47 * 3600000),
          "onboarding",
        ),
        false,
      );
      assert.equal(
        await store.delivery.claim(
          "different-key",
          2,
          "reminder",
          [],
          new Date(now.getTime() + 48 * 3600000),
          "onboarding",
        ),
        false,
      );
      assert.equal(
        await store.delivery.claim(
          "wrong-status",
          2,
          "hh_ru process",
          [],
          now,
          "hh_ru process",
        ),
        "stale",
      );
      await store.advanceCursor("1");
      await store.advanceCursor("0");
      assert.equal((await store.activation())!.statusCursor, "1");
      const after = (
        await pool.query(
          "SELECT id,client_name,client_status FROM noco.clients ORDER BY id",
        )
      ).rows;
      assert.deepEqual(after, before);
    } finally {
      await pool.end();
    }
  },
);
