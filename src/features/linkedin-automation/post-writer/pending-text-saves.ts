import type { TextJob, TextWorkspaceDependencies } from './text-workspace-types.ts'
export function pendingTextSaves(deps: TextWorkspaceDependencies) {
  const dirty = new Map<string, TextJob>()
  let retryAt = 0
  return {
    get: (id: string) => dirty.get(id),
    async save(job: TextJob) {
      try { await deps.files.put('text-jobs', job.id, job); dirty.delete(job.id); return true }
      catch {
        dirty.set(job.id, structuredClone(job))
        retryAt = deps.now() + 30_000
        deps.log?.('text_persistence_wait', { jobId: job.id, retryAt })
        return false
      }
    },
    async flush() {
      if (dirty.size && deps.now() < retryAt) return false
      for (const [id, job] of dirty) {
        try { await deps.files.put('text-jobs', id, job); dirty.delete(id) }
        catch { retryAt = deps.now() + 30_000; return false }
      }
      return true
    }
  }
}
