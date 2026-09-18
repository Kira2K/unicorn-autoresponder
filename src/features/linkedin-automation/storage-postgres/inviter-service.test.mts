import assert from 'node:assert/strict';
import { test } from 'node:test';
import { featureFixture } from './fixture.mts';
import { createSqlInviterStore } from './inviter-store.mts';
import { fixture, waitRun } from '../connection-inviter/tests/fixtures.ts';
import { createConnectionInviterService } from '../connection-inviter/service.ts';
import { CONNECTION_SEARCH_CATALOG } from '../connection-inviter/catalog.ts';

function setup() {
  const f = featureFixture(), p = fixture({ stack: 'Frontend', connectionCount: 149 });
  f.grant.accountIds = new Set([7]);
  CONNECTION_SEARCH_CATALOG.forEach((c, i) => f.seed('linkedin_connection_search_catalog', i+1, {
    source_key:c.sourceKey, audience:c.audience, city:c.city, keyword_template:c.keywordTemplate,
    priority:c.priority, enabled:c.enabled }));
  const store = createSqlInviterStore(f.db, f.grant);
  const open = () => createConnectionInviterService({ ...p, store, autoRecover:false,
    now:() => new Date('2026-09-14T09:00:00Z'), sleep:async () => {} });
  return { f, p, store, open };
}
test('Inviter uses SQL history and quota after restart without another invitation', async () => {
  const {p,store,open} = setup(); let service = open();
  try {
    const run = await service.start(7), done = await waitRun(service, run.runId);
    assert.equal(done.status,'succeeded'); assert.equal(done.counters.sent,5);
    assert.equal((await store.listHistory(7)).filter(x => x.status==='sent').length,5);
    service.stop(); service=open();
    const resumed = await service.start(7); await waitRun(service,resumed.runId);
    assert.equal(p.metrics.sends,5);
  } finally { service.stop(); }
});
test('unknown SQL run COMMIT does not authorize an invitation or repeat create', async () => {
  const {f,p,store,open} = setup(); f.fail('commit'); const service=open();
  try {
    await assert.rejects(service.start(7), /commit uncertain/);
    assert.equal(p.metrics.sends,0);
    assert.equal((await store.listRuns(7)).length,1);
    assert.equal(f.calls.filter(v=>v==='create').length,1);
  } finally { service.stop(); }
});
