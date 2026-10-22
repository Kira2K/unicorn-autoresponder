import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openLocalStore } from './test-store.mts';
import type { NewProfile } from '../contracts.mts';

const draft: NewProfile = { clientId: 901, locale: 'ru', operationId: 'operation', password: '00123',
  createdAt: 100, ownProxy: true, phase: 'queued', original: { title: 'Вася Пупкин', description: 'fixture', tags: [], start_pages: [] } };
async function temporary(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'octo-local-store-'));
  try { await run(join(directory, 'state.json')); }
  finally { assert.equal(dirname(directory), tmpdir()); await rm(directory, { recursive: true, force: true }); }
}
test('file journal preserves identity, password, pending write, event cursor and revisions across restart', async () => temporary(async path => {
  let file = await openLocalStore(path, 'identity');
  const runId = file.runId;
  const [profile] = await file.store.reserve([draft]);
  profile.uuid = 'a'.repeat(32); profile.phase = 'ready';
  profile.grant = { id: 'grant', phase: 'awaiting_close', alias: 'Fixture', createdAt: 100,
    eventsAfter: 0, pending: 'clear', attemptedAt: 200, expiresAt: 180, original: profile.original };
  const saved = await file.store.save(profile);
  await file.store.recordPage({ events: [{ id: 'event', profileId: profile.uuid, action: 'profiles.stopped', time: 1 }],
    watermark: { uuid: 'event', time: 1 } });
  await file.store.setCoverage(50);
  await file.close();
  file = await openLocalStore(path, 'identity');
  try {
    assert.equal(file.runId, runId);
    assert.deepEqual(await file.store.get(profile.id), saved);
    assert.equal((await file.store.claimClientPassword(901, '99999')).password, '00123');
    assert.equal((await file.store.events(profile.uuid))[0].seq, 1);
    assert.deepEqual(await file.store.stream(), { coverageSince: 50, cursor: { uuid: 'event', time: 1 } });
    const writes = await Promise.allSettled([file.store.save(saved), file.store.save(saved)]);
    assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(writes.filter(r => r.status === 'rejected').length, 1);
  } finally { await file.close(); }
}));
test('a second process/store cannot take the state file; changed configuration cannot reuse fixtures', async () => temporary(async path => {
  const file = await openLocalStore(path, 'identity');
  await assert.rejects(openLocalStore(path, 'identity'), { code: 'test_backend_lock_exists' });
  await file.close();
  await assert.rejects(openLocalStore(path, 'different'), { code: 'invalid_state_file' });
  const text = await readFile(path, 'utf8');
  await writeFile(path, text.replace('"schema": 1', '"schema": 99'));
  await assert.rejects(openLocalStore(path, 'identity'), { code: 'invalid_state_file' });
}));
test('an uncertain file write poisons further work and leadership instead of exposing undurable state', async () => temporary(async path => {
  const file = await openLocalStore(path, 'identity', async () => { throw Error('disk'); });
  const leader = await file.store.leader();
  await assert.rejects(file.store.reserve([draft]), { code: 'octo_local_persistence_failed' });
  await assert.rejects(file.store.list(), { code: 'octo_local_persistence_failed' });
  await assert.rejects(leader!.check(), { code: 'octo_local_persistence_failed' });
  await file.close();
  const reopened = await openLocalStore(path, 'identity');
  try { assert.deepEqual(await reopened.store.list(), []); } finally { await reopened.close(); }
}));
