import { createRequire } from 'node:module';
import type { MonitorJob } from '../comment-monitor/types.ts';
import type { FeatureSql, FeatureWrites } from './contracts.mts';
import { createFeatureRows } from './rows.mts';
import {retainMonitorEvidence} from '../comment-monitor/retention-policy.ts';
const require = createRequire(import.meta.url);
const { monitorJobFromRow, monitorJobRow } = require('../comment-monitor/job-row.ts') as typeof import('../comment-monitor/job-row.ts');
const { LINKEDIN_COMMENT_MONITOR_COLUMNS } = require('../../../integrations/noco/linkedin-comment-monitor-schema/columns.ts') as
  typeof import('../../../integrations/noco/linkedin-comment-monitor-schema/columns.ts');
export function createSqlCommentStore(db: FeatureSql, grant?: FeatureWrites) {
  const rows = createFeatureRows(db, 'linkedin_comment_monitor_jobs', LINKEDIN_COMMENT_MONITOR_COLUMNS, grant);
  async function get(id: string) { const row = (await rows.list('job_id', [id]))[0]; return row && monitorJobFromRow(row); }
  const list = async () => (await rows.list()).map(monitorJobFromRow)
    .sort((a,b) => Number(b.createdAt === '') - Number(a.createdAt === '') || b.createdAt.localeCompare(a.createdAt));
  return { get, list,
    async create(job: MonitorJob) { await rows.insert(monitorJobRow(job)); },
    async update(job: MonitorJob) {
      const current = await get(job.jobId);
      if (!current?.recordId) throw Object.assign(Error('Comment monitor job not found.'), { code: 'comment_monitor_job_not_found' });
      await rows.patch(current.recordId, monitorJobRow(job));
    },
    async purge(before: string) {
      const cutoff = Date.parse(before);
      if (!Number.isFinite(cutoff)) return;
      for (const job of await list()) if (job.recordId && !retainMonitorEvidence(job) && Date.parse(job.createdAt) < cutoff) await rows.remove(job.recordId);
    }
  };
}
