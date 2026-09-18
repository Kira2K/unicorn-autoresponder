import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedInFixture } from './linkedin-fixture.mts';
import { createSqlTestConsole } from './test-app.mts';
import { serveTestApp } from './workflow-http.mts';
test('isolated LinkedIn API preserves auth, URL editing, history and blocks unmigrated features', async () => {
  const f = linkedInFixture(); let calls = 0, finish!: () => void;
  const linkedin = { execute: async () => { calls++; await new Promise<void>(r => { finish = r; }); return { mode: 'fake' }; } };
  let server = await serveTestApp(createSqlTestConsole(f.db, f.grant, undefined, linkedin));
  const login = async () => {
    const r = await fetch(server.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unicornveryevil@gmail.com', password: '101010' }) });
    assert.equal(r.status, 200); return { Cookie: String(r.headers.get('set-cookie')).split(';')[0], 'Content-Type': 'application/json' };
  };
  try {
    assert.equal((await fetch(server.base + '/api/admin/linkedin/accounts')).status, 401);
    const provider = await fetch(server.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Nariman', password: 'Nariman' }) });
    const providerHeaders = { Cookie: String(provider.headers.get('set-cookie')).split(';')[0] };
    assert.equal(provider.status, 200);
    assert.equal((await fetch(server.base + '/api/admin/linkedin/accounts', { headers: providerHeaders })).status, 403);
    assert.equal((await fetch(server.base + '/api/admin/linkedin/accounts/21/runs', { method: 'POST', headers: providerHeaders })).status, 403);
    let headers = await login();
    const send = (path: string, method = 'GET', body?: unknown) => fetch(server.base + path,
      { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const accounts = await send('/api/admin/linkedin/accounts');
    assert.equal((await accounts.json()).accounts[0].platformAccountId, 21); assert.equal(f.count(), 0);
    assert.equal((await send('/api/admin/linkedin/accounts/21', 'PATCH', { linkedinUrl: 'invalid' })).status, 400);
    assert.equal((await send('/api/admin/linkedin/accounts/21', 'PATCH', { linkedinUrl: 'https://linkedin.com/in/sql-edited' })).status, 200);
    assert.equal((await send('/api/admin/linkedin/accounts/21/runs', 'POST', { action: 'unknown' })).status, 400);
    const run = await (await send('/api/admin/linkedin/accounts/21/runs', 'POST', { action: 'check' })).json();
    assert.equal((await send('/api/admin/linkedin/accounts/21/runs', 'POST', { action: 'check' })).status, 409);
    finish();
    for (let i=0; i<30; i++) {
      const status = await (await send('/api/admin/linkedin/runs/' + run.runId)).json();
      if (status.status === 'succeeded') break;
      await new Promise(resolve => setImmediate(resolve));
    }
    const history = await (await send('/api/admin/linkedin/runs')).json(); assert.equal(history.runs[0].status, 'succeeded');
    for (const path of ['/api/admin/linkedin/accounts/21/profile-generations', '/api/admin/linkedin/post-runs', '/api/telegram/send', '/api/dolphin/lease/acquire'])
      assert.equal((await send(path, 'POST')).status, 403);
    await server.close(); server = await serveTestApp(createSqlTestConsole(f.db, f.grant, undefined, linkedin));
    headers = await login();
    assert.equal((await (await send('/api/admin/linkedin/runs')).json()).runs[0].runId, run.runId);
    assert.match((await (await send('/api/admin/linkedin/accounts')).json()).accounts[0].linkedinUrl, /sql-edited/);
    assert.equal(calls, 1);
  } finally { await server.close(); }
});
