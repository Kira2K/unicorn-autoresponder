import type { ProfileFillerService } from './profile-filler-types.ts'

export function createMockProfileFillerService(): ProfileFillerService {
  const jobs = new Map<string, any>()
  return {
    async startGeneration(platformAccountId) {
      const now = new Date().toISOString()
      const job: any = { jobId: `generation-${Date.now()}`, platformAccountId,
        clientName: 'Test Client', status: 'generating_cv', phase: 'extracting_cv_facts',
        createdAt: now, updatedAt: now }
      jobs.set(job.jobId, job)
      setTimeout(() => {
        job.status = 'preview_ready'; job.phase = 'preview_ready'; job.planHash = 'mock-generated-hash'
        job.updatedAt = new Date().toISOString()
        job.preview = { planHash: job.planHash, issues: [], document: { schema_version: 1,
          profile: { headline: 'Generated mock profile' } }, steps: [], generation: {
          model: 'mock-model', proxyCountry: 'Poland', guideRevision: 'mock-guide',
          cvRevision: 'mock-cv', generatedAt: new Date().toISOString()
        } }
      }, 25)
      return structuredClone(job)
    },
    async searchParameters(_platformAccountId, type, keywords) {
      return { type, items: [keywords, `${keywords} Specialist`].map(name => ({ name })) }
    },
    async startPreview(platformAccountId, document) {
      const now = new Date().toISOString()
      const job = {
        jobId: `profile-${Date.now()}`, platformAccountId, clientName: 'Test Client',
        status: 'preview_ready', phase: 'preview_ready', planHash: 'mock-plan-hash',
        preview: {
          planHash: 'mock-plan-hash', identity: { displayName: 'Test Client' }, issues: [],
          document,
          steps: [{ id: 'headline', section: 'headline', action: 'update',
            summary: 'Изменить Headline', before: 'Old headline', after: 'New headline' }]
        }, createdAt: now, updatedAt: now
      }
      jobs.set(job.jobId, job)
      return structuredClone(job)
    },
    async apply(jobId, planHash) {
      const job = jobs.get(jobId)
      if (!job) throw Object.assign(new Error('Not found'), { code: 'profile_job_not_found' })
      if (planHash !== job.planHash) throw Object.assign(new Error('Hash mismatch'), {
        code: 'profile_plan_hash_mismatch'
      })
      const startedAt = new Date().toISOString()
      job.status = 'running'; job.phase = 'writing:headline'
      job.result = { status: 'running', steps: [{ stepId: 'headline', section: 'headline',
        status: 'writing', message: 'Sending change to LinkedIn.', startedAt, updatedAt: startedAt }],
        startedAt, updatedAt: startedAt }
      setTimeout(() => {
        const finishedAt = new Date().toISOString()
        job.status = 'succeeded'; job.phase = 'completed'; job.finishedAt = finishedAt
        job.rollbackAvailable = true
        job.result = { status: 'verified', steps: [{ stepId: 'headline', section: 'headline',
          status: 'verified', message: 'Verified by read-back.', startedAt, completedAt: finishedAt,
          updatedAt: finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt) }],
          startedAt, updatedAt: finishedAt, finishedAt }
      }, 25)
      return structuredClone(job)
    },
    async rollback(jobId) {
      const source = jobs.get(jobId)
      if (!source?.rollbackAvailable) throw Object.assign(new Error('Rollback unavailable'), {
        code: 'profile_rollback_not_available'
      })
      source.rollbackAvailable = false
      const job = { ...structuredClone(source), jobId: `rollback-${Date.now()}`,
        kind: 'rollback', rollbackOf: jobId, rollbackAvailable: false,
        status: 'running', phase: 'writing:headline' }
      jobs.set(job.jobId, job)
      setTimeout(() => { job.status = 'succeeded'; job.phase = 'completed' }, 25)
      return structuredClone(job)
    },
    async resume(jobId) {
      const job = jobs.get(jobId)
      if (!job) throw Object.assign(new Error('Not found'), { code: 'profile_job_not_found' })
      job.status = 'retrying'; job.phase = 'resuming_job_titles'; job.errorCode = undefined
      setTimeout(() => { job.status = 'preview_ready'; job.phase = 'preview_ready' }, 25)
      return structuredClone(job)
    },
    async get(jobId) { const job = jobs.get(jobId); return job && structuredClone(job) },
    async list() { return [...jobs.values()].reverse().map(value => structuredClone(value)) }
  }
}
