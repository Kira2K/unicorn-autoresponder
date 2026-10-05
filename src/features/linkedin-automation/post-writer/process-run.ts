import { generate } from './generation.ts'
import { publish, reconcilePost, publicationCheckAt } from './publication.ts'
import { engage } from './engagement.ts'
import { errorCode, retryDelay } from './errors.ts'
import { unlock, type Execution } from './execution-types.ts'
import type { PostRun } from './types.ts'
import { policyCurrent } from './run-policy.ts'
import type { ExecutionStep } from '../execution-step.ts'
import { recordFailure, recoveryExpired, recoveryWakeAt, skipRecovery, ACTION_SKIPPED, skippedActions, recoveryDeadline } from '../action-recovery.ts'
import * as requestControl from '../../../integrations/unipile/request-control.ts'
const { withRequestContext } = (requestControl as any).default ?? requestControl

export async function processRun(run: PostRun, e: Execution, singleStep = false): Promise<ExecutionStep> {
  try { await withRequestContext({ actionId: `post:${run.id}` }, () => processRunStep(run, e, singleStep)) }
  finally {
    // A returned request is no longer in flight. Durable intents protect against
    // duplicates; a timer or an unresolved read-back must not reserve the account.
    for (const [account, held] of e.release) if (held.id === run.id) unlock(e, account)
  }
  const nextActionAt = run.nextActionAt ? new Date(run.nextActionAt).toISOString() : undefined
  if (run.recovery?.skippedAt !== undefined) return { status: 'completed', reason: ACTION_SKIPPED,
    skippedActions: skippedActions({ [`post:${run.id}`]: run.recovery }),
    summary: { completed: 0, skipped: run.attemptedAt ? 0 : 1, unconfirmed: run.attemptedAt ? 1 : 0 } }
  if (run.status === 'uncertain' || run.engagement.status === 'uncertain')
    return { status: 'verifying', nextActionAt, reason: run.errorCode, recoveryDeadlineAt: run.recovery ? recoveryDeadline({ post: run.recovery }) : undefined }
  if (run.status === 'stopped') return { status: 'stopped' }
  if (['blocked', 'awaiting_approval'].includes(run.status)) return { status: 'needs_attention', reason: run.errorCode }
  return { status: nextActionAt ? 'waiting' : run.status === 'published' ? 'completed' : 'ready', nextActionAt,
    ...(run.status === 'published' ? { summary: { completed: 1, skipped: 0, unconfirmed: 0 } } : {}),
    recoveryDeadlineAt: run.recovery ? recoveryDeadline({ post: run.recovery }) : undefined }
}

async function processRunStep(run: PostRun, e: Execution, singleStep: boolean) {
  if (!e.writable) return
  if (run.status !== 'published' && recoveryExpired(run.recovery, e.now())) {
    skipRecovery(run.recovery!, e.now()); run.errorCode = ACTION_SKIPPED; run.nextActionAt = undefined
    // Keep a dispatched publication uncertain and its history claim intact.
    run.status = run.attemptedAt ? 'uncertain' : 'blocked'
    await e.save(run); e.log('action_skipped', { runId: run.id, code: ACTION_SKIPPED,
      unconfirmed: Boolean(run.attemptedAt) }); return
  }
  if (!e.writable || (run.nextActionAt && run.nextActionAt > e.now())) return
  try {
    if (['publishing', 'verifying', 'uncertain'].includes(run.status)) {
      await reconcilePost(run, e)
      if (run.status === 'published') { run.recovery = undefined; await e.save(run) }
      else if (run.nextActionAt) { run.nextActionAt = recoveryWakeAt(run.recovery, run.nextActionAt); await e.save(run) }
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
    if (run.status === 'queued' || run.status === 'generating') {
      await generate(run, e)
      if (singleStep) return
    }
    if (!run.stop && run.status === 'ready') await publish(run, e)
    if (run.stop && !run.attemptedAt) { run.status = 'stopped'; await e.save(run) }
  } catch (error) {
    const code = errorCode(error)
    e.log('run_error', { runId: run.id, code })
    if (code === 'post_persistence_unavailable' || code.startsWith('automation_')) throw error
    if (run.status !== 'published') run.recovery = recordFailure(run.recovery, error, e.now())
    run.errorCode = code
    const delay = retryDelay(error, e.now())
    if (run.attemptedAt && run.status !== 'published') {
      run.status = 'uncertain'
      run.nextActionAt = publicationCheckAt(run, e.now(), delay)
    } else if (delay || code === 'linkedin_operation_active') {
      run.nextActionAt = e.now() + (delay ?? 15_000)
    } else if (run.status === 'published') {
      run.engagement.status = 'partial'
    } else { run.status = 'blocked' }
    if (run.nextActionAt) run.nextActionAt = recoveryWakeAt(run.recovery, run.nextActionAt)
    await e.save(run)
  }
}
