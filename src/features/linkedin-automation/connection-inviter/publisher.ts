import type { SearchAudience } from './catalog.ts'
import { connectionErrorCode } from './errors.ts'
import { createInvitationSafety } from './invitation-safety.ts'
import type { PendingRead } from './pending-reader.ts'
import { requireConnectionRunDay } from './day-window.ts'
import { sendDelay } from './run-model.ts'
import { waitWithRunTimer } from './retry-state.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'

export async function createInvitationPublisher(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, seed?: PendingRead) {
  const details = { runId: run.runId, platformAccountId: run.platformAccountId }
  const safety = await createInvitationSafety(runtime, run, save, seed)

  return {
    async publish(audience: SearchAudience, candidates: ConnectionHistoryItem[], sentLimit = 1) {
      runtime.logger.event('invitation_publish', 'started', { ...details, audience, sentLimit })
      const processedPersonIds: string[] = []
      let sentCount = 0
      try {
        for (const candidate of candidates) {
          if (sentCount >= sentLimit || runtime.stopRequested(run.runId)) break
          requireConnectionRunDay(runtime, run)
          if (safety.candidateIsPending(candidate.personId)) {
            safety.countSkip(candidate, 'pending_invitation')
            processedPersonIds.push(candidate.personId)
            continue
          }
          if (run.counters.sent > 0 || run.searchProgress.invitationPacingStarted) {
            let nextSendAt = Date.parse(run.searchProgress.invitationNotBefore ?? '')
            if (!Number.isFinite(nextSendAt)) {
              nextSendAt = runtime.now().getTime() + sendDelay(runtime.random)
              run.searchProgress.invitationNotBefore = new Date(nextSendAt).toISOString()
            }
            const delayMs = Math.max(0, nextSendAt - runtime.now().getTime())
            runtime.logger.event('invitation_delay', 'succeeded', { ...details, delayMs })
            const proceed = await waitWithRunTimer(runtime, run, save, 'invitation_delay',
              'invitation_delay', delayMs, true)
            if (!proceed) break
          }
          if (runtime.stopRequested(run.runId)) break
          requireConnectionRunDay(runtime, run)

          candidate.status = 'sending'; candidate.reasonCode = 'invitation_claimed'
          candidate.updatedAt = runtime.now().toISOString()
          const item = await safety.claim(candidate)
          if (!item) {
            safety.countSkip(candidate, 'lifetime_history_block')
            processedPersonIds.push(candidate.personId)
            continue
          }
          run.counters.filterFunnel[audience].claimed += 1
          run.stage = 'sending'
          await save(run, 'stage_changed')
          runtime.logger.event('invitation_claim', 'succeeded', { ...details, audience })

          const sent = await safety.send(item)
          processedPersonIds.push(candidate.personId)
          if (sent) {
            sentCount += 1
          }
        }
        runtime.logger.event('invitation_publish', 'succeeded', {
          ...details, audience, sentCount: run.counters.sent
        })
        return { processedPersonIds, sentCount }
      } catch (error) {
        runtime.logger.event('invitation_publish', 'failed', {
          ...details, audience, errorCode: connectionErrorCode(error)
        })
        throw error
      }
    }
  }
}
