import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { featureFixture } from './fixture.mts';
import { createSqlProfileStore } from './profile-store.mts';
import { createSqlCommentStore } from './comment-store.mts';
import { createSqlInviterStore } from './inviter-store.mts';
import { createSqlPostStore } from './post-store.mts';
import { createConnectionInviterStore } from '../connection-inviter/noco-store.mts';
import { createPostNocoStore } from '../post-writer/noco-store.ts';
import { defaults } from '../post-writer/types.ts';
const require = createRequire(import.meta.url);
const { createProfileJobStore } = require('../profile-filler/noco-job-store.ts');
const { createCommentMonitorStore } = require('../comment-monitor/noco-store.ts');
test('independent Noco read oracle: values, defaults, complete JSON, errors and order match SQL', async () => {
  const f = featureFixture(), tables = f.db.listTables();
  const source = new Map<string, Record<string, unknown>[]>();
  const seed = (table: string, rows: Record<string, unknown>[]) => {
    source.set(table, structuredClone(rows)); for (const row of rows) f.seed(table, Number(row.Id), row);
  };
  seed('linkedin_profile_jobs', [{ Id: 1, job_id: 'job-1', platform_account_id: 21, status: 'verifying',
    created_at: '2026-09-13 00:00:00Z', preview_json: '{"planHash":"abc","disabledFields":["education"]}',
    progress_json: '{"nextCheckAt":"2026-09-13T10:00:00Z"}', result_json: '', input_json: '{"skills":[]}' }]);
  seed('linkedin_comment_monitor_jobs', [{ Id: 2, job_id: 'monitor-1', platform_account_id: 21,
    state_json: 'invalid legacy JSON', author_headline: '', author_about: null, created_at: '2026-09-13 00:00:00Z' }]);
  seed('linkedin_connection_runs', [{ Id: 3, run_id: 'run-1', run_key: '21:2026-09-13', platform_account_id: 21,
    search_progress_json: '{}', created_at: '2026-09-13 00:00:00Z' }]);
  seed('linkedin_connection_history', [{ Id: 4, platform_account_id: 21, history_key: 'fake:person',
    unipile_account_id: 'fake', person_id: 'person', status: 'uncertain', request_id: null }]);
  seed('linkedin_connection_search_catalog', [{ Id: 5, source_key: 'x', enabled: true, priority: 1, audience: 'technical',
    city: 'Paris', keyword_template: '{stack} Engineer' }]);
  seed('linkedin_post_settings', [{ Id: 6, record_key: '21', platform_account_id: 21,
    state_json: JSON.stringify({ ...defaults(21), forbiddenTopics: ['No invented experience'], context: { role: 'Go' } }) }]);
  // This transport reads a separate raw fixture. It never calls SQL or SQL filter/hydration helpers.
  const raw = async (id: string) => structuredClone(source.get(id) ?? []);
  const metadata = async () => tables;
  const port = { config: { baseId: 'fixture' }, request: metadata, fetchTableMeta: async (id: string) => tables.find(t => t.id === id),
    fetchRecords: raw };
  const oldProfile = createProfileJobStore(port), oldComment = createCommentMonitorStore(port);
  const oldInviter = createConnectionInviterStore(port);
  const oldPost = createPostNocoStore({ baseId: 'fixture', records: raw,
    request: async (_method, path) => path.includes('/meta/tables/') ? tables.find(t => path.endsWith('/' + t.id))! : tables });
  const profile = createSqlProfileStore(f.db), comments = createSqlCommentStore(f.db);
  const inviter = createSqlInviterStore(f.db), posts = createSqlPostStore(f.db);
  assert.deepEqual(await profile.list(), await oldProfile.list());
  assert.deepEqual(await profile.get('job-1'), await oldProfile.get('job-1'));
  assert.deepEqual(await comments.list(), await oldComment.list());
  assert.deepEqual(await inviter.listRuns(), await oldInviter.listRuns());
  assert.deepEqual(await inviter.listHistory(21), await oldInviter.listHistory(21));
  assert.deepEqual(await inviter.listCatalog(), await oldInviter.listCatalog());
  assert.deepEqual(await posts.list('settings'), await oldPost.list('settings'));
  const duplicate = { ...source.get('linkedin_post_settings')![0], Id: 9 };
  source.get('linkedin_post_settings')!.push(duplicate); f.seed('linkedin_post_settings', 9, duplicate);
  for (const store of [posts, oldPost]) await assert.rejects(store.get('settings', '21'), /post_duplicate_rows/);
});
