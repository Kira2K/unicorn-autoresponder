import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

/** Run the actual factory with SDK/storage/input adapters; no real session or network. */
function fixture(authorized = true, session = 'fixture-session') {
  const calls = { connect: 0, start: 0, save: 0, disconnect: 0, input: 0 };
  let sdkOptions: Record<string, unknown> = {};
  class Client {
    session = { save() { calls.save++; return 'fixture'; } };
    constructor(_session: unknown, _id: unknown, _hash: unknown, options: Record<string, unknown>) { sdkOptions = options; }
    setLogLevel() {}
    async connect() { calls.connect++; }
    async isUserAuthorized() { return authorized; }
    async start() { calls.start++; }
    async disconnect() { calls.disconnect++; }
  }
  const modules: Record<string, unknown> = {
    telegram: { TelegramClient: Client },
    'telegram/extensions/Logger': { Logger: class {}, LogLevel: { NONE: 0 } },
    'telegram/sessions': { StringSession: class {} },
    'node:fs': { existsSync: () => false }, 'node:path': path,
    dotenv: { config() {} }, input: { text() { calls.input++; throw Error('interactive login forbidden'); } }
  };
  const module = { exports: {} as any };
  const source = new URL('../../integrations/telegram/messenger.ts', import.meta.url);
  runInNewContext(stripTypeScriptTypes(readFileSync(source, 'utf8')), {
    module, require: (id: string) => { assert.ok(id in modules, 'declared dependency'); return modules[id]; },
    __dirname: path.dirname(fileURLToPath(source)), console,
    process: { env: { main_messenger_telegram_session: session } }, setTimeout, clearTimeout
  });
  return { create: module.exports.createTelegramClient, calls, options: () => sdkOptions };
}

test('noninteractive factory reuses authorization, never prompts/saves and exposes flood waits to the runtime', async () => {
  const f = fixture();
  await f.create({ interactive: false });
  assert.deepEqual(f.calls, { connect: 1, start: 0, save: 0, disconnect: 0, input: 0 });
  assert.equal(f.options().floodSleepThreshold, 0); assert.equal(f.options().requestRetries, 1);
  for (const missing of [fixture(false), fixture(true, '')]) {
    await assert.rejects(missing.create({ interactive: false }), { code: 'telegram_session_required' });
    assert.equal(missing.calls.disconnect, 1); assert.equal(missing.calls.input, 0); assert.equal(missing.calls.save, 0);
  }
});

test('existing callers retain interactive login and SDK defaults', async () => {
  const f = fixture(); await f.create({ saveSession: false });
  assert.equal(f.calls.start, 1); assert.equal(f.calls.connect, 0);
  assert.equal(f.options().connectionRetries, 5); assert.equal(f.options().floodSleepThreshold, undefined);
});
