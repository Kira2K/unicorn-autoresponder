import assert from 'node:assert/strict';
import { test } from 'node:test';
import { featureFixture } from './fixture.mts';
import { createSqlPostStore } from './post-store.mts';
import { fixture } from '../post-writer/tests/helpers.ts';
import { defaults } from '../post-writer/types.ts';
import { PostError } from '../post-writer/errors.ts';

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

test('one-off likes persist in SQL and restart without changing settings or republishing', async () => {
  const sql = featureFixture(), f = fixture(), grant = { ...sql.grant, accountIds: new Set([203]) };
  f.deps.store = createSqlPostStore(sql.db, grant); f.restart();
  try {
    const post = { date: '2026-09-09', text: 'Ready post with a meme and separately started likes.' };
    await f.service.update(203, { ...defaults(203), contentMode: 'prepared', preparedPosts: [post] });
    const run = await f.service.startPrepared(203, post);
    await f.step(); await f.step(6000);
    await f.service.action(run.id, 'start-likes'); await f.step(6000);
    f.deps.store = createSqlPostStore(sql.db, grant); f.restart();
    await f.service.action(run.id, 'start-likes');
    for (let i = 0; i < 20; i++) await f.step(90_001);
    assert.equal(f.counts.publish, 1); assert.equal(f.counts.like, 6);
    assert.equal((await f.run()).engagement.status, 'completed');
    assert.equal((await f.run()).engagement.requestedManually, true);
    const { settings } = await f.service.get(203);
    assert.equal(settings.likes, false); assert.equal(settings.scheduled, false);
  } finally { await f.service.close() }
});

test('SQL preserves skipped account and reason; restart sends only remaining reactions', async () => {
  const sql = featureFixture(), f = fixture(), grant = { ...sql.grant, accountIds: new Set([203]) };
  f.deps.store = createSqlPostStore(sql.db, grant); f.restart();
  try {
    await f.service.start(203, 'automatic', 'sql-likes-skip'); await f.untilPublished();
    f.deps.adapter.identity = async account => {
      if (account.platformAccountId === 902) throw new PostError('post_account_not_ready');
    };
    await f.service.action((await f.run()).id, 'start-likes');
    await f.step(); await f.step(5000); await f.step(5000); await f.step(5000);
    const before = await f.run();
    assert.equal(before.engagement.items[0].status, 'sent');
    assert.equal(before.engagement.items[1].errorCode, 'post_account_not_ready');
    f.deps.store = createSqlPostStore(sql.db, grant); f.restart();
    assert.deepEqual((await f.run()).engagement, before.engagement);
    for (let i = 0; i < 20; i++) await f.step(90_001);
    const after = await f.run();
    assert.equal(after.engagement.status, 'partial'); assert.equal(f.counts.like, 5);
    assert.equal(after.engagement.items[1].status, 'failed');
    assert.equal(after.engagement.items[1].attemptedAt, undefined); assert.equal(f.counts.publish, 1);
  } finally { await f.service.close() }
});
