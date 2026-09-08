import { generate } from './generation.ts'
import { publish, reconcilePost } from './publication.ts'
import { engage } from './engagement.ts'
import { errorCode, retryDelay } from './errors.ts'
import { unlock, type Execution } from './execution-types.ts'
import type { PostRun } from './types.ts'
import { policyCurrent } from './run-policy.ts'

export async function processRun(run: PostRun, e: Execution) {
  if (!e.writable || (run.nextActionAt && run.nextActionAt > e.now())) return
  try {
    if (['publishing', 'verifying', 'uncertain'].includes(run.status)) {
      await reconcilePost(run, e)
      return
    }
    if (run.status === 'published') { await engage(run, e); return }
    if (run.stop) {
      run.status = 'stopped'
      await e.save(run)
      unlock(e, run.account)
      return
    }
    if (['ready', 'awaiting_approval'].includes(run.status) && !policyCurrent(run, e)) {
      run.status = 'generating'
      run.approvedHash = undefined
      await e.save(run)
    }
    if (run.status === 'queued' || run.status === 'generating') await generate(run, e)
    if (!run.stop && run.status === 'ready') await publish(run, e)
    if (run.stop && !run.attemptedAt) { run.status = 'stopped'; await e.save(run) }
  } catch (error) {
    const code = errorCode(error)
    e.log('run_error', { runId: run.id, code })
    if (code === 'post_persistence_unavailable') throw error
    run.errorCode = code
    const pendingLike = run.engagement.items.find(item => ['sending', 'uncertain'].includes(item.status))
    const delay = retryDelay(error)
    if (pendingLike) {
      pendingLike.status = 'uncertain'
      run.engagement.status = 'uncertain'
      run.nextActionAt = e.now() + (delay ?? 300_000)
    } else if (run.attemptedAt && run.status !== 'published') {
      run.status = 'uncertain'
      run.nextActionAt = e.now() + (delay ?? 300_000)
    } else if (delay || code === 'linkedin_operation_active') {
      run.nextActionAt = e.now() + (delay ?? 15_000)
    } else if (run.status === 'published') {
      run.engagement.status = 'partial'
    } else { run.status = 'blocked' }
    await e.save(run)
    if (!pendingLike && !['publishing', 'verifying', 'uncertain'].includes(run.status)) {
      for (const [account, held] of e.release) if (held.id === run.id) unlock(e, account)
    }
  }
}
