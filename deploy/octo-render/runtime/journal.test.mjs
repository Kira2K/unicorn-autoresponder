import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRenderJournal } from './journal.mjs';
const config = { backendUrl: 'https://backend.example.com', bridgeId: 'owner', ownerEmail: 'owner@example.com' };
test('container replacement with reused PID retains the same journal/device and archives only its dead lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octo-render-journal-')), path = join(root, 'journal.json');
  let journal;
  try {
    const options = { pid: 12, stamp: async () => 'boot:namespace-new:100', now: () => 42 };
    journal = await openRenderJournal(path, config, 'service-one', options);
    const device = journal.data.deviceId;
    journal.data.entries.g1 = { uuid: 'a'.repeat(32), digest: 'b'.repeat(64), stage: 'executing' };
    await journal.save(); await journal.close(); journal = undefined;
    await writeFile(path + '.lock', JSON.stringify({ pid: 12, machine: 'service-one', processStamp: 'boot:namespace-old:100' }));
    journal = await openRenderJournal(path, config, 'service-one', options);
    assert.equal(journal.data.deviceId, device); assert.equal(journal.data.entries.g1.stage, 'executing');
    assert.ok((await readdir(root)).includes('journal.json.lock.stale-42'));
    await assert.rejects(openRenderJournal(path, config, 'service-one', options), { code: 'bridge_render_process_still_alive' });
  } finally { await journal?.close(); await rm(root, { recursive: true, force: true }); }
});
test('foreign service, missing process stamp and unreadable process identity never force recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octo-render-lock-')), path = join(root, 'journal.json');
  try {
    await writeFile(path, 'preserve-this-journal');
    for (const lock of [{ pid: 12, machine: 'another-service', processStamp: 'old' }, { pid: 12, machine: 'service-one' }]) {
      await writeFile(path + '.lock', JSON.stringify(lock));
      await assert.rejects(openRenderJournal(path, config, 'service-one', { stamp: async () => null }));
      assert.equal(await readFile(path, 'utf8'), 'preserve-this-journal');
      assert.deepEqual(JSON.parse(await readFile(path + '.lock', 'utf8')), lock);
    }
    await writeFile(path + '.lock', JSON.stringify({ pid: 12, machine: 'service-one', processStamp: 'old' }));
    await assert.rejects(openRenderJournal(path, config, 'service-one', { stamp: async () => { throw Error('denied'); } }));
    assert.equal(await readFile(path, 'utf8'), 'preserve-this-journal');
  } finally { await rm(root, { recursive: true, force: true }); }
});
