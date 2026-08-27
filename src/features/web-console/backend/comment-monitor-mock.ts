import type { CommentMonitorService } from './comment-monitor-types.ts'

export function createMockCommentMonitorService(): CommentMonitorService {
  const jobs = new Map<string, any>()
  return {
    async enable(platformAccountId) {
      const active = [...jobs.values()].find(job => job.platformAccountId === platformAccountId &&
        ['starting', 'waiting', 'checking', 'replying', 'paused'].includes(job.status))
      if (active) return structuredClone(active)
      const now = new Date().toISOString()
      const job = { jobId: `comments-${Date.now()}`, platformAccountId, clientName: 'Test Client',
        status: 'waiting', stage: 'waiting_next_check', createdAt: now, updatedAt: now,
        expiresAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString(), nextCheckAt: now,
        state: { posts: [{ id: 'post-1', url: 'https://linkedin.example/post-1', text: '' },
          { id: 'post-2', url: 'https://linkedin.example/post-2', text: '' }], items: [],
          knownIds: [], checks: 1, discovered: 0, published: 0, failed: 0, threadReplies: {} } }
      jobs.set(job.jobId, job); return structuredClone(job)
    },
    async disable(platformAccountId) {
      const job = [...jobs.values()].find(row => row.platformAccountId === platformAccountId)
      if (!job) return undefined
      job.status = 'disabled'; job.stage = 'disabled_by_admin'; job.finishedAt = new Date().toISOString()
      return structuredClone(job)
    },
    async resume(jobId) {
      const job = jobs.get(jobId)
      if (!job) throw Object.assign(new Error('Not found'), { code: 'comment_monitor_job_not_found' })
      job.status = 'waiting'; job.stage = 'resumed'; return structuredClone(job)
    },
    async get(jobId) { const job = jobs.get(jobId); return job && structuredClone(job) },
    async list() { return [...jobs.values()].reverse().map(job => structuredClone(job)) }
  }
}
