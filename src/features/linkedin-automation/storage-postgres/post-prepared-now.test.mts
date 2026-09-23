import assert from 'node:assert/strict';
import { test } from 'node:test';
import { featureFixture } from './fixture.mts';
import { createSqlPostStore } from './post-store.mts';
import { fixture } from '../post-writer/tests/helpers.ts';
import { defaults } from '../post-writer/types.ts';

test('manual prepared run survives SQL adapter restart; later schedule and repeat request cannot repost', async () => {
  const sql = featureFixture(), f = fixture(), grant = { ...sql.grant, accountIds: new Set([203]) };
  const post = { date: '2026-09-09', text: '  Текст 🦄\n\nТочное значение и перенос.  ' };
  f.deps.store = createSqlPostStore(sql.db, grant); f.restart();
  try {
    await f.service.update(203, { ...defaults(203), contentMode: 'prepared', preparedPosts: [post] });
    const first = await f.service.startPrepared(203, post);
    await f.step(); await f.step(6000);
    assert.equal((await f.run()).status, 'published'); assert.equal(f.counts.publish, 1);
    f.deps.store = createSqlPostStore(sql.db, grant); f.restart();
    const repeated = await f.service.startPrepared(203, post);
    assert.equal(repeated.id, first.id); assert.equal(repeated.trigger, 'manual');
    assert.equal(repeated.draft!.text, post.text); assert.ok(repeated.postImageId);
    await f.service.update(203, { ...defaults(203), scheduled: true, contentMode: 'prepared', preparedPosts: [post] });
    f.setNow(Date.parse('2026-09-09T10:00:00+03:00')); await f.step(); await f.step(6000);
    const snapshot = await f.service.get(203);
    assert.equal(snapshot.runs.length, 1); assert.equal(f.counts.publish, 1);
    assert.equal(snapshot.settings.slot!.state, 'started');
    assert.deepEqual(snapshot.settings.preparedPosts, [post]);
  } finally { await f.service.close() }
});
