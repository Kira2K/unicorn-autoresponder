import { createRequire } from 'node:module';
import type { ProfileJob } from '../profile-filler/job-types.ts';
import type { FeatureSql, FeatureWrites } from './contracts.mts';
import { createFeatureRows } from './rows.mts';
const require = createRequire(import.meta.url);
const { fromRow, profileJobRow, profileJobPatch } = require('../profile-filler/job-row.ts') as typeof import('../profile-filler/job-row.ts');
const { LINKEDIN_PROFILE_JOB_COLUMNS } = require('../../../integrations/noco/linkedin-profile-jobs-schema/columns.ts') as
  typeof import('../../../integrations/noco/linkedin-profile-jobs-schema/columns.ts');
const active = new Set(['waiting_retry', 'running', 'verifying', 'validating', 'previewing', 'retrying']);
export function createSqlProfileStore(db: FeatureSql, grant?: FeatureWrites) {
  const rows = createFeatureRows(db, 'linkedin_profile_jobs', LINKEDIN_PROFILE_JOB_COLUMNS, grant);
  const newest = (jobs: ProfileJob[]) => jobs.sort((a,b) => Number(b.createdAt === '') - Number(a.createdAt === '') || b.createdAt.localeCompare(a.createdAt));
  async function get(id: string) { const row = (await rows.list('job_id', [id]))[0]; return row && fromRow(row); }
  async function list(id?: number, onlyActive = false) {
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) throw new RangeError('Invalid account ID');
    const values = await rows.list(id === undefined ? undefined : 'platform_account_id', id === undefined ? [] : [String(id)]);
    return newest(values.map(fromRow).filter(job => !onlyActive || active.has(job.status)));
  }
  return { get, list, listActive: (id: number) => list(id, true),
    async listPendingVerification() {
      return (await rows.list('status', ['running','verifying'])).map(fromRow).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
    },
    async create(job: ProfileJob) { await rows.insert(profileJobRow(job)); },
    async update(id: string, patch: Partial<ProfileJob>) {
      const current = await get(id);
      if (!current?.recordId) throw Object.assign(Error('Profile job not found.'), { code: 'profile_job_not_found' });
      const data = profileJobPatch(patch);
      if (Object.keys(data).length) await rows.patch(current.recordId, data);
    }
  };
}
