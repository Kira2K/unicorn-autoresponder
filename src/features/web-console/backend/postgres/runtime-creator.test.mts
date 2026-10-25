import test from 'node:test';
import assert from 'node:assert/strict';
import { openSqlConsole } from './runtime.mts';
import { runtimeFixture } from './runtime-fixture.mts';

function fixture(missingTasks = false) {
  const f = runtimeFixture(), connect = f.pool.connect;
  f.pool.connect = async () => {
    const session = await connect(), query = session.query;
    session.query = async (sql, values) => {
      const result = await query(sql, values);
      if (sql.includes('noco.linkedin_creation_task') && missingTasks) throw Error('missing task schema');
      if (sql.includes('AS ready')) return { rows: [{ ready: true }] };
      if (sql.includes('copy_meta.inventory')) return { rows: [...result.rows, {
        definition: { sqlOnlyFor: 'm4thvbutfyb15qz', columns: [{ name: 'browser', sqlType: 'text' }] }
      }] };
      if (sql.includes('FROM noco.octo_stream')) return { rows: [{ cursor: 0, coverage_since: 0 }] };
      return result;
    };
    return session;
  };
  return { ...f, env: { ...f.env, OCTO_ENABLED: '1', OCTO_ACCESS_SCOPE: 'all', OCTO_API_TOKEN: 'fake',
    OCTO_HOME_FOLDER_UUID: 'a'.repeat(32), OCTO_GUEST_FOLDER_UUID: 'b'.repeat(32), OCTO_GUEST_PASSWORD: 'fake',
    LINKEDIN_CREATOR_LOGIN: 'expert-fixture', LINKEDIN_CREATOR_PASSWORD: 'fixture-password' } };
}

test('Octo SQL console always provides expert tasks, including with an obsolete disabled flag', async () => {
  for (const obsolete of [undefined, '0']) {
    const f = fixture();
    const runtime = await openSqlConsole({ ...f.env, LINKEDIN_CREATION_TASKS_ENABLED: obsolete }, () => f.pool);
    try {
      assert.ok(runtime.options.linkedinCreator);
      assert.ok(runtime.options.linkedinIntake);
      assert.deepEqual(runtime.options.linkedinCreatorAuth, { login: 'expert-fixture', password: 'fixture-password' });
      assert.deepEqual(await runtime.options.linkedinCreator.list(), []);
      assert.ok(f.calls.some(sql => sql.includes('proxy_saved_at,source,version FROM noco.linkedin_creation_task LIMIT 0')));
      assert.ok(!f.calls.some(sql => /^\s*(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\b/.test(sql)));
    } finally { await runtime.close(); }
    assert.equal(f.state.ends, 2);
  }
});

test('always-on expert tasks require the existing schema; startup closes pools without migrations', async () => {
  const f = fixture(true);
  await assert.rejects(openSqlConsole(f.env, () => f.pool), { code: 'postgres_read_failed' });
  assert.equal(f.state.ends, 2);
  assert.ok(!f.calls.some(sql => /^\s*(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\b/.test(sql)));
});
