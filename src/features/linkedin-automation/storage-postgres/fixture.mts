import { createRequire } from 'node:module';
import type { FeatureSql, FeatureWrites } from './contracts.mts';
import type { WorkingTable } from '../../../integrations/postgres/working-catalog.mts';
import type { CopyRecord } from '../../../integrations/postgres/contracts.mts';
import type { PostgresTransaction } from '../../../integrations/postgres/working-client.mts';
const require = createRequire(import.meta.url);
const schema = (name: string): Record<string, Array<{ title: string; uidt?: string; pk?: boolean }>> => require('../../../integrations/noco/' + name);
const inviter = schema('linkedin-connection-inviter-schema/columns.ts'), post = schema('linkedin-post-writer-schema/contract.ts').columns;
export function featureFixture() {
  const fields = {
    linkedin_profile_jobs: schema('linkedin-profile-jobs-schema/columns.ts').LINKEDIN_PROFILE_JOB_COLUMNS,
    linkedin_comment_monitor_jobs: schema('linkedin-comment-monitor-schema/columns.ts').LINKEDIN_COMMENT_MONITOR_COLUMNS,
    linkedin_connection_runs: inviter.CONNECTION_RUN_COLUMNS, linkedin_connection_history: inviter.CONNECTION_HISTORY_COLUMNS,
    linkedin_connection_search_catalog: inviter.CONNECTION_CATALOG_COLUMNS,
    linkedin_post_settings: post, linkedin_post_runs: post, linkedin_post_history: post
  };
  const tables = Object.entries(fields).map(([title, columns]) => ({ id: title, title, table_name: title,
    columns: [...new Map([{ title: 'Id', uidt: 'ID', pk: true }, ...columns].map(c => [c.title, c])).values()]
      .map(c => ({ ...c, id: title + '_' + c.title, dataKey: c.title, sqlName: c.title,
        sqlType: c.uidt === 'DateTime' ? 'timestamptz' : c.uidt === 'Number' || c.title === 'Id' ? 'bigint' : 'text' })) })) as WorkingTable[];
  const rows = new Map<string, Map<number, Record<string, unknown>>>(), calls: string[] = [];
  const set = (table: string) => { if (!rows.has(table)) rows.set(table, new Map()); return rows.get(table)!; };
  const copy = (data: Record<string, unknown>): CopyRecord => ({ key: [String(data.Id)], data: structuredClone(data), sourceJson: '{}' });
  let next = 100, fail = '', tail = Promise.resolve();
  const db: FeatureSql = {
    listTables: () => tables,
    async getRecord(id, key) { const row = set(id).get(Number(key[0])); return row ? copy(row) : null; },
    async listRecords(id) { return { records: [...set(id).values()].map(copy), nextKey: null }; },
    async findRecords(id, field, values) { return { records: [...set(id).values()]
      .filter(r => r[field] != null && values.includes(String(r[field]))).map(copy), nextKey: null }; },
    async listRelated() { return { records: [], nextKey: null }; },
    async createRecord(id, data) {
      calls.push('create'); if (fail === 'create') throw Error('create failed');
      const row = { ...structuredClone(data), Id: ++next }; set(id).set(next, row); return copy(row);
    },
    async patchRecord(id, key, data) {
      calls.push('patch'); if (fail === 'patch') throw Error('patch failed');
      const row = set(id).get(Number(key[0])); if (!row) throw Error('missing');
      Object.assign(row, structuredClone(data)); return copy(row);
    },
    async deleteRecord(id, key) { calls.push('delete'); return set(id).delete(Number(key[0])); },
    async linkRecord() { throw Error('not used'); }, async unlinkRecord() { throw Error('not used'); },
    transaction<T>(action: (tx: PostgresTransaction) => Promise<T>): Promise<T> {
      const request = tail.then(async () => {
        const before = structuredClone(rows); let value: T;
        try { value = await action({ ...db, async lockKey() { calls.push('lock'); } }); }
        catch (error) { rows.clear(); for (const [id, data] of before) rows.set(id, data); throw error; }
        if (fail === 'commit') throw Object.assign(Error('commit uncertain'), { code: 'commit_uncertain' });
        return value;
      });
      tail = request.then(() => {}, () => {}); return request;
    }
  };
  const grant: FeatureWrites = { accountIds: new Set([21]), create: (tx, table, data) => tx.createRecord(table, data) };
  return { db, grant, rows, calls, fail: (value: string) => { fail = value; },
    seed(table: string, id: number, data: Record<string, unknown>) { set(table).set(id, { ...data, Id: id }); } };
}
