import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOctoApi } from './octo-api.mts';
import { createFileStore, acquireProcessLock } from './store.mts';
import type { State } from './contract.mts';

test('cloud and local adapters use documented payloads and never forward the owner token to the local client', async () => {
  const requests: { url: string; init: RequestInit; body: any }[] = [];
  const responses = [
    { success: true, data: [{ uuid: 'folder', name: 'g-folder' }] },
    { success: true, data: { uuid: 'alex' } },
    { success: true, data: '' }, { success: true, data: '' }, { msg: 'Profile password has been cleared' },
    [], { uuid: 'alex', state: 'STARTED' }
  ];
  const fetcher: typeof fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(responses.shift());
  };
  const api = createOctoApi('test-token', fetcher);
  await api.createFolder('g-folder');
  await api.createProfile({ title: 'Alex', description: 'test', folder: 'folder', start_pages: ['https://example.org'] });
  await api.setPassword('alex', 'Alex');
  await api.updateProfile('alex', { title: 'John Doe', folder: 'folder' });
  await api.clearPassword('alex', 'Alex');
  await api.activeProfiles(); await api.startProfile('alex', 'wrong');
  assert.deepEqual(requests[0].body, { folders: [{ name: 'g-folder', assignable_wo_permission: false }] });
  assert.equal(requests[1].body.password, undefined);
  assert.equal(requests[1].body.storage_options.localstorage, true);
  assert.deepEqual(requests[2].body, { profiles: ['alex'], password: 'Alex' });
  assert.equal(requests[3].init.method, 'PATCH');
  assert.deepEqual(requests[4].body, { uuid: 'alex', password: 'Alex' });
  assert.equal(requests[4].url, 'http://127.0.0.1:58888/api/profiles/password');
  assert.equal(requests[4].init.method, 'DELETE');
  assert.equal(new Headers(requests[0].init.headers).get('X-Octo-Api-Token'), 'test-token');
  for (const request of requests.slice(4)) assert.equal(new Headers(request.init.headers).get('X-Octo-Api-Token'), null);
  assert.equal(requests[6].body.password, 'wrong');
  assert.equal(requests[6].body.headless, false);
  assert.equal(requests[6].body.debug_port, false);
  assert.equal(requests.some(r => /force_stop|\/stop|\/delete/.test(r.url)), false);
});

test('API failures never include upstream messages or credentials; transport failures are not retried', async () => {
  const api = createOctoApi('secret', async () => Response.json({ success: false, msg: 'echo secret', code: 'profiles.password_error' }));
  await assert.rejects(api.setPassword('alex', 'Alex'), error => {
    assert.equal(JSON.stringify(error).includes('echo secret'), false);
    assert.equal((error as any).details.upstreamCode, 'profiles.password_error');
    return true;
  });
  let calls = 0;
  const disconnected = createOctoApi('secret', async () => { calls++; throw new Error('secret'); });
  await assert.rejects(disconnected.createFolder('g-folder'), { code: 'octo_request_outcome_unknown' });
  assert.equal(calls, 1);
});

test('deferred mode clears using the owner cloud API and exposes only a requested local debug port', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createOctoApi('owner-test', async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return Response.json(String(url).endsWith('/start') ? { uuid: 'alex', state: 'STARTED', debug_port: '9000' } : { success: true, data: {} });
  }, { passwordClear: 'cloud', debugPort: true });
  await api.clearPassword('alex', 'Alex');
  assert.equal(calls[0].url, 'https://app.octobrowser.net/api/v2/automation/profiles/alex/clear_password');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { password: 'Alex' });
  assert.equal(new Headers(calls[0].init.headers).get('X-Octo-Api-Token'), 'owner-test');
  assert.equal((await api.startProfile('alex', 'Alex')).debug_port, 9000);
  assert.equal(new Headers(calls[1].init.headers).get('X-Octo-Api-Token'), null);
  assert.ok(calls.every(call => !call.url.includes('/stop')));
});

test('state persists incomplete operations; invalid state cannot silently become a fresh setup; process locking is exclusive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'octo-test-'));
  try {
    const path = join(dir, 'state.json'), store = createFileStore(path);
    assert.equal(await store.load(), null);
    const state: State = { schema: 1, runId: 'run', phase: 'working', folders: {}, profiles: {}, active: null, grantedAt: null, step: 'create_profile:Alex' };
    await store.save(state);
    assert.deepEqual(await createFileStore(path).load(), state);
    const release = await acquireProcessLock(path);
    await assert.rejects(acquireProcessLock(path), { code: 'test_backend_lock_exists' });
    await release(); await (await acquireProcessLock(path))();
    await writeFile(path, '{"schema":1}');
    await assert.rejects(store.load(), { code: 'invalid_state_file' });
    assert.equal(await readFile(path, 'utf8'), '{"schema":1}');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cloud-only adapter rejects local operations before fetch and always clears in the cloud', async () => {
  const urls: string[] = [];
  const api = createOctoApi('test-token', async url => {
    urls.push(String(url)); return Response.json({ success: true, data: {} });
  }, { cloudOnly: true });
  await assert.rejects(api.activeProfiles(), /local_api_disabled/);
  await assert.rejects(api.startProfile('alex', 'Alex'), /local_api_disabled/);
  assert.equal(urls.length, 0);
  await api.clearPassword('alex', 'Alex');
  assert.deepEqual(urls, ['https://app.octobrowser.net/api/v2/automation/profiles/alex/clear_password']);
});
