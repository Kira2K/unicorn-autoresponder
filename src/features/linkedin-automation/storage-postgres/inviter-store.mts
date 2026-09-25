import { runFromRow, runRow, historyFromRow, historyRow } from '../connection-inviter/store-rows.ts';
import { CONNECTION_CATALOG_COLUMNS, CONNECTION_RUN_COLUMNS, CONNECTION_HISTORY_COLUMNS } from
  '../../../integrations/noco/linkedin-connection-inviter-schema/columns.ts';
import type { ConnectionInviterStore, ConnectionHistoryItem } from '../connection-inviter/types.ts';
import type { FeatureSql, FeatureRow, FeatureWrites } from './contracts.mts';
import { createFeatureRows } from './rows.mts';
const newest = (rows: FeatureRow[], field: string) => rows.sort((a,b) => Number(b[field] == null) - Number(a[field] == null) ||
  String(b[field] ?? '').localeCompare(String(a[field] ?? '')));
export function createSqlInviterStore(db: FeatureSql, grant?: FeatureWrites): ConnectionInviterStore {
  const runs = createFeatureRows(db, 'linkedin_connection_runs', CONNECTION_RUN_COLUMNS, grant);
  const history = createFeatureRows(db, 'linkedin_connection_history', CONNECTION_HISTORY_COLUMNS, grant);
  const catalog = createFeatureRows(db, 'linkedin_connection_search_catalog', CONNECTION_CATALOG_COLUMNS);
  const getRun = async (field: string, key: string) => { const row = (await runs.list(field, [key]))[0]; return row && runFromRow(row); };
  const historyList = async (field: string, keys: string[]) => newest(await history.list(field, keys), 'discovered_at').map(historyFromRow);
  const findHistory = async (account: string, person: string) => (await historyList('history_key', [`${account}:${person}`]))[0];
  return {
    async listCatalog() {
      return (await catalog.list()).filter(row => Boolean(row.enabled)).sort((a,b) => Number(a.priority) - Number(b.priority))
        .map(row => ({ sourceKey: String(row.source_key), audience: row.audience as 'recruiter' | 'technical',
          city: String(row.city), keywordTemplate: String(row.keyword_template), priority: Number(row.priority), enabled: true }));
    },
    listRuns: async () => newest(await runs.list(), 'created_at').map(runFromRow),
    listRunsForAccount: async id => newest(await runs.list('platform_account_id', [String(id)]), 'created_at').map(runFromRow),
    getRun: id => getRun('run_id', id), getRunByKey: key => getRun('run_key', key),
    async createRun(run) {
      return runs.atomic(run.runKey, async tx => {
        const existing = (await tx.list('run_key', [run.runKey]))[0];
        if (existing) return { run: runFromRow(existing), created: false };
        const created = await tx.insert(runRow(run)); run.recordId = created.Id;
        return { run, created: true };
      });
    },
    async updateRun(run) {
      const existing = await getRun('run_id', run.runId);
      if (!existing?.recordId) throw Object.assign(Error('Connection run not found.'), { code: 'connection_run_not_found' });
      await runs.patch(existing.recordId, runRow(run)); run.recordId = existing.recordId;
    },
    findHistory,
    async findHistoryBatch(account, people) {
      const result: ConnectionHistoryItem[] = [], unique = [...new Set(people.filter(Boolean))];
      for (let i=0; i<unique.length; i+=500) result.push(...await historyList('history_key', unique.slice(i,i+500).map(p => `${account}:${p}`)));
      return result;
    },
    async claimHistory(item) {
      return history.atomic(item.historyKey, async tx => {
        if ((await tx.list('history_key', [item.historyKey])).length) return false;
        const row = await tx.insert(historyRow(item));
        const verified = (await tx.list('history_key', [item.historyKey]))[0];
        if (!verified || verified.Id !== row.Id || verified.status !== 'sending' || verified.run_id !== item.runId ||
          verified.unipile_account_id !== item.accountId || verified.person_id !== item.personId || verified.sent_at || verified.request_id)
          throw Error('connection_claim_unconfirmed');
        item.recordId = row.Id; return true;
      });
    },
    async updateHistory(item) {
      const existing = await findHistory(item.accountId, item.personId);
      if (!existing?.recordId) throw Object.assign(Error('Connection history item not found.'), { code: 'connection_history_not_found' });
      await history.patch(existing.recordId, historyRow(item)); item.recordId = existing.recordId;
    },
    listHistory: id => historyList('platform_account_id', [String(id)]),
    listRunHistory: id => historyList('run_id', [id]),
    listOpenHistory: async id => (await historyList('platform_account_id', [String(id)]))
      .filter(row => ['sending','deferred','sent','uncertain'].includes(row.status))
  };
}
