import assert from 'node:assert/strict';
import { test } from 'node:test';
import { featureFixture } from './fixture.mts';
import { createSqlPostStore } from './post-store.mts';
import { defaults } from '../post-writer/types.ts';
import type { History } from '../post-writer/types.ts';
test('settings preserve complete JSON, avoid unchanged writes and reject duplicates/foreign accounts', async () => {
  const f = featureFixture(), store = createSqlPostStore(f.db, f.grant), value = { ...defaults(21), likes: true };
  await store.put('settings', '21', value);
  assert.deepEqual(await store.get('settings', '21'), value);
  const changes = f.calls.filter(v => ['create','patch'].includes(v)).length;
  await store.put('settings', '21', value);
  assert.equal(f.calls.filter(v => ['create','patch'].includes(v)).length, changes);
  await assert.rejects(store.put('settings', '22', defaults(22)), /forbidden/);
  f.seed('linkedin_post_settings', 1, { record_key: '21', platform_account_id: 21, state_json: JSON.stringify(value) });
  await assert.rejects(store.get('settings', '21'), /post_duplicate_rows/);
});
test('concurrent claims reserve once; unknown COMMIT cannot grant a second publication after restart', async () => {
  const f = featureFixture(), first = createSqlPostStore(f.db, f.grant), second = createSqlPostStore(f.db, f.grant);
  const history: History = { id: 'reservation', account: 21, status: 'sending', runId: 'run-1',
    hash: 'hash', text: 'Post', signature: 'topic' };
  const result = await Promise.all([first.claim(history.id, history), second.claim(history.id, history)]);
  assert.equal(result.filter(r => r.created).length, 1); assert.equal(f.calls.filter(c => c === 'create').length, 1);
  f.fail('commit'); await assert.rejects(first.claim('uncertain', { ...history, id: 'uncertain' }), /commit uncertain/);
  f.fail(''); const retry = await createSqlPostStore(f.db, f.grant).claim('uncertain', { ...history, id: 'uncertain' });
  assert.equal(retry.created, false); assert.equal(f.calls.filter(c => c === 'create').length, 2);
});

test('test accounts retain global forbidden topics without permission to edit shared policy', async () => {
  const f = featureFixture(), store = createSqlPostStore(f.db, f.grant);
  const policy = { ...defaults(0), forbiddenTopics: ['politics'] };
  f.seed('linkedin_post_settings', 1, { platform_account_id: 0, record_key: '0', state_json: JSON.stringify(policy) });
  assert.deepEqual(await store.get('settings', '0'), policy);
  assert.equal((await store.list('settings')).length, 1);
  await assert.rejects(store.put('settings', '0', { ...policy, forbiddenTopics: [] }), /forbidden/);
});
