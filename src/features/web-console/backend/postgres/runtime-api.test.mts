import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { combinedFixture } from './combined-fixture.mts';
import { sqlAppOptions } from './app-options.mts';
import { serveTestApp } from './workflow-http.mts';
import { createConnectionInviterService } from '../../../linkedin-automation/connection-inviter/service.ts';
import { createLivePostWriter } from '../../../linkedin-automation/post-writer/runtime.ts';
import { tableIds } from './tables.mts';
const require = createRequire(import.meta.url);
const { createWebConsoleApp } = require('../app.ts');
const { createCommentMonitorService } = require('../../../linkedin-automation/comment-monitor/service.ts');
const { createLinkedInOperationGate } = require('../linkedin-operation-gate.ts');

test('normal SQL storage bundle serves actual services and authenticated routes, without Noco', async () => {
  const f = combinedFixture(), create = f.grant.create;
  const options = sqlAppOptions(f.db, { clientIds: new Set(), allClients: true, create },
    { accountIds: new Set(), allAccounts: true, create });
  const s = options.linkedinStorage, gate = createLinkedInOperationGate();
  const connectionInviter = createConnectionInviterService({ repository: s.repository, store: s.inviter, gate,
    writerEnabled: false, autoRecover: false });
  const commentMonitor = createCommentMonitorService({ repository: s.repository, store: s.comments, gate, autoStart: false,
    loggerFor: () => ({ event() {} }) });
  const postWriter = createLivePostWriter(s.repository, gate, { env: { LINKEDIN_POST_WRITER_ENABLED: 'false' }, storage: s.posts });
  const previous = process.env.APP_DB; process.env.APP_DB = 'postgres';
  let server: Awaited<ReturnType<typeof serveTestApp>> | undefined;
  try {
    const app = createWebConsoleApp({ ...options, useMockData: false, linkedinOperationGate: gate,
      connectionInviter, commentMonitor, postWriter });
    server = await serveTestApp(app);
    assert.equal((await fetch(server.base + '/api/admin/linkedin/accounts')).status, 401);
    const response = await fetch(server.base + '/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unicornveryevil@gmail.com', password: '101010' }) });
    assert.equal(response.status, 200);
    const headers = { Cookie: String(response.headers.get('set-cookie')).split(';')[0], 'Content-Type': 'application/json' };
    for (const path of ['accounts', 'runs', 'profile-jobs', 'connection-runs', 'comment-monitors', 'accounts/21/post-writer']) {
      const r: Response = await fetch(server.base + '/api/admin/linkedin/' + path, { headers });
      assert.equal(r.status, 200, path + ': ' + await r.text());
    }
    assert.equal(f.count(), 0, 'history/settings reads must not create jobs');
    const patch = await fetch(server.base + '/api/admin/linkedin/accounts/21', { method: 'PATCH', headers,
      body: JSON.stringify({ linkedinUrl: 'https://linkedin.com/in/sql-new-url' }) });
    assert.equal(patch.status, 200);
    assert.match(String(f.rows.get(tableIds.accounts)!.get('21')!.url), /sql-new-url/);
    // A student added after startup is not excluded by a cached initial allowlist.
    f.set(tableIds.clients, 8, { client_name: 'Later' });
    f.set(tableIds.accounts, 51, { clients_id: 8, platforms_id: 16, url: 'https://linkedin.com/in/later' });
    await s.repository.updateLinkedInUrl(51, 'https://linkedin.com/in/later-edit');
    assert.match(String(f.rows.get(tableIds.accounts)!.get('51')!.url), /later-edit/);
  } finally {
    await server?.close(); commentMonitor.stop(); connectionInviter.stop(); await postWriter.close();
    if (previous === undefined) delete process.env.APP_DB; else process.env.APP_DB = previous;
  }
});
