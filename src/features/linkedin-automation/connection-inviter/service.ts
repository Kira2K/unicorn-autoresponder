import { resolveContext } from './account.mts'
import { connectionAccountScope } from './account-scope.ts'
import { executeConnectionRun, connectionSteps } from './execution.ts'
import type { ExecutionStep } from '../execution-step.ts'
import { dateParts } from './limits.ts'
import { createConnectionLogger, logged, withConnectionRequestTrace } from './logger.ts'
import { createConnectionUnipileAdapter } from './unipile-adapter.ts'
import { makeRun, publicHistory, publicRun } from './run-model.ts'
import { requestRunStop, waitOrStop } from './run-control.ts'
import { completedRunCanTopUp, failedRunCanRetry, prepareRunRetry,
  prepareRunTopUp, transientRunCanResume } from './retry-policy.ts'
import { connectionError, connectionErrorCode, normalizeConnectionProviderError,
  transientConnectionError } from './errors.ts'
import { connectionRetryDelay, makeRetryState, retryAfterMilliseconds } from './retry-state.ts'
import { closeConnectionRunDay } from './day-window.ts'
import { createConnectionRunEvents, type ConnectionRunEvent } from './run-events.ts'
import { reconcileInvitations } from './pending.ts'
import { expireInvitationRecovery } from './invitation-verification.ts'
import { ACTION_SKIPPED, skippedActions } from '../action-recovery.ts'
import { synchronizeConfirmedProgress } from './daily-progress.ts'
import { withConnectionRetry } from './retry-state.ts'
import { acquireConnectionWriterLock } from './writer-lock.ts'
import type { ConnectionRunEventType, ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun, ConnectionRunStage } from './types.ts'
import { composeInvitationWithdrawal } from '../invitation-withdrawal/compose.ts'

type ServiceOptions = Partial<Omit<ConnectionRuntime, 'adapter' | 'emit' | 'stopRequested'>> & {
  repository?: ConnectionRuntime['repository']
  adapter?: ReturnType<ConnectionRuntime['adapter']>
  autoRecover?: boolean
  enforceWriterSingleton?: boolean
  writerLockPath?: string
  allowedAccounts?: readonly number[]
  withdrawal?: Parameters<typeof composeInvitationWithdrawal>[2]
}

const activeRunStatus = (run: ConnectionRun) => run.status === 'running' ||
  ['waiting_retry', 'recovering', 'resolving_uncertain', 'stop_requested'].includes(run.stage)

export const CONNECTION_WRITER_LEASE_MS = 5 * 60_000
export const CONNECTION_WRITER_HEARTBEAT_MS = 120_000

export function connectionWriterLeaseAvailable(run: ConnectionRun, writerId: string, now: number) {
  if (!run.executorId || run.executorId === writerId) return true
  const protectedAt = Math.max(...[run.heartbeatAt, run.nextActionAt,
    run.searchProgress?.searchReservedUntil].map(value => Date.parse(value ?? ''))
    .filter(Number.isFinite))
  return !Number.isFinite(protectedAt) || now - protectedAt > CONNECTION_WRITER_LEASE_MS
}

export const connectionWriterHeartbeatDue = (lastPersistedAt: number, now: number) =>
  now - lastPersistedAt >= CONNECTION_WRITER_HEARTBEAT_MS

export function createConnectionInviterService(options: ServiceOptions = {}) {
  const scope = connectionAccountScope(options.allowedAccounts)
  const repository = options.repository
  if (!repository) throw new Error('Connection Inviter requires a LinkedIn repository.')
  if (!options.store) throw connectionError('connection_store_required',
    'Connection Inviter requires an explicitly configured storage adapter.')
  const logger = options.logger ?? createConnectionLogger()
  const events = createConnectionRunEvents()
  const stopRequests = new Set<string>()
  const activeRuns = new Map<string, ConnectionRun>()
  const running = new Set<string>()
  const managed = new Map<string, { run: ConnectionRun; steps: AsyncGenerator<ExecutionStep>;
    control: { cooperate?: ConnectionRuntime['cooperate'] } }>()
  const stepping = new Set<string>()
  const resumeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const persistQueues = new Map<string, Promise<void>>()
  const lastPersistedAt = new Map<string, number>()
  const persistedStoppedRuns = new Set<string>()
  // Search progress is served from the active in-memory run and SSE. Storage keeps a durable,
  // coarse checkpoint; invitation safety remains durable in the history table per mutation.
  const checkpointIntervalMs = CONNECTION_WRITER_HEARTBEAT_MS
  let adapter: ReturnType<ConnectionRuntime['adapter']> | undefined
  const writerEnabled = options.writerEnabled ??
    String(process.env.LINKEDIN_CONNECTION_WRITER_ENABLED ?? '').toLowerCase() === 'true'
  const configuredWriterId = String(options.writerId ??
    process.env.LINKEDIN_CONNECTION_WRITER_ID ?? '').trim()
  if (writerEnabled && !configuredWriterId) {
    throw connectionError('connection_writer_id_missing',
      'LINKEDIN_CONNECTION_WRITER_ID is required when Connection Inviter writes are enabled.')
  }
  const writerId = configuredWriterId || 'read-only'
  const enforceWriterSingleton = options.enforceWriterSingleton ?? options.writerEnabled === undefined
  const writerLock = writerEnabled && enforceWriterSingleton
    ? acquireConnectionWriterLock(writerId, options.writerLockPath) : undefined
  let disposed = false
  let releaseWriterWhenIdle = false
  let recoveryCoordinator: Promise<void> | undefined
  function releaseWriterIfIdle() {
    if (!releaseWriterWhenIdle || activeRuns.size > 0 || running.size > 0 || recoveryCoordinator || withdrawals?.busy()) return
    writerLock?.release(); releaseWriterWhenIdle = false
  }
  const runtime: ConnectionRuntime = {
    store: options.store, repository,
    adapter: () => adapter ??= options.adapter ?? createConnectionUnipileAdapter({ logger }),
    gate: options.gate, now: options.now ?? (() => new Date()),
    timeZone: options.timeZone ?? process.env.LINKEDIN_CONNECTION_TIME_ZONE ?? 'Europe/Moscow',
    random: options.random ?? Math.random,
    sleep: options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))),
    stopRequested: runId => stopRequests.has(runId), emit: events.emit,
    logger, writerEnabled, writerId,
    assertWriterOwnership() {
      if (disposed) throw connectionError('connection_writer_service_stopped',
        'Connection Inviter writer service has been stopped.')
      writerLock?.assertOwned()
      options.assertWriterOwnership?.()
    }
  }

  // Injected provider environments must opt in explicitly: never fall back from mocks to live Unipile.
  const withdrawals = !options.adapter || options.withdrawal
    ? composeInvitationWithdrawal(runtime, scope.assert, options.withdrawal) : undefined

  async function persistRunSnapshot(run: ConnectionRun) {
    const previous = persistQueues.get(run.runId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() =>
      runtime.store.updateRun(structuredClone(run)))
    persistQueues.set(run.runId, next)
    try { await next; lastPersistedAt.set(run.runId, runtime.now().getTime()) }
    finally { if (persistQueues.get(run.runId) === next) persistQueues.delete(run.runId) }
  }

  const save: SaveRun = async (run, event = 'progress', mode = 'checkpoint') => {
    const now = runtime.now().getTime()
    run.updatedAt = new Date(now).toISOString()
    const elapsed = now - (lastPersistedAt.get(run.runId) ?? 0)
    if (mode !== 'critical' && elapsed < checkpointIntervalMs) {
      runtime.emit(run, event)
      return
    }
    const resumeStage = run.stage
    const outerRetry = run.retryState?.provider === 'unipile' ? structuredClone(run.retryState) : undefined
    const outerTimer = outerRetry && run.timerState ? structuredClone(run.timerState) : undefined
    const outerNextActionAt = outerRetry ? run.nextActionAt : undefined
    const outerPausedAt = outerRetry ? run.pausedAt : undefined
    const outerErrorCode = outerRetry ? run.errorCode : undefined
    let storageRetried = false
    while (true) {
      run.updatedAt = runtime.now().toISOString()
      if (run.status === 'running') {
        run.executorId = runtime.writerId; run.heartbeatAt = run.updatedAt
      }
      try {
        await persistRunSnapshot(run)
        if (run.status === 'stopped') persistedStoppedRuns.add(run.runId)
        if (storageRetried) {
          storageRetried = false; run.retryState = outerRetry; run.timerState = outerTimer
          run.nextActionAt = outerNextActionAt; run.pausedAt = outerPausedAt
          run.errorCode = outerErrorCode
          run.stage = resumeStage; runtime.emit(run, 'retry_succeeded')
          continue
        }
        logger.event('run_state_persist', 'succeeded', { runId: run.runId,
          platformAccountId: run.platformAccountId, runStatus: run.status, runStage: run.stage })
        runtime.emit(run, event)
        return
      } catch (caught) {
        const error = normalizeConnectionProviderError('storage', caught)
        // The coordinator owns rescheduling. Never park its step inside a storage retry loop.
        if (run.searchProgress.automationId) throw error
        if (!transientConnectionError(error)) throw error
        storageRetried = true
        runtime.store.recordRetry?.()
        run.retryState = makeRetryState(runtime, run, 'storage', 'update_run', error)
        run.stage = 'waiting_retry'; run.errorCode = run.retryState.errorCode
        run.pausedAt = runtime.now().toISOString(); run.nextActionAt = run.retryState.nextRetryAt
        run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
          nextActionAt: run.retryState.nextRetryAt }
        logger.event('retry', 'failed', { runId: run.runId,
          platformAccountId: run.platformAccountId, provider: 'storage', operation: 'update_run',
          attempt: run.retryState.attempt, errorCode: run.retryState.errorCode,
          delayMs: run.retryState.delayMs, nextRetryAt: run.retryState.nextRetryAt })
        runtime.emit(run, 'retry_scheduled')
        const durableStopWrite = resumeStage === 'stop_requested' || run.status === 'stopped'
        if (durableStopWrite) {
          // Never persist a transient `waiting_retry` stage over a durable Stop intent.
          run.stage = resumeStage
          let remainingMs = run.retryState.delayMs
          while (remainingMs > 0) {
            const sliceMs = Math.min(1_000, remainingMs)
            await runtime.sleep(sliceMs); remainingMs -= sliceMs
          }
        } else if (!await waitOrStop(runtime, run.runId, run.retryState.delayMs)) {
          throw connectionError('connection_stop_requested', 'Connection run stop was requested.')
        }
      }
    }
  }

  const ownsWriterLease = (run: ConnectionRun) => {
    if (!runtime.writerEnabled) return false
    return connectionWriterLeaseAvailable(run, runtime.writerId, runtime.now().getTime())
  }

  const execute = async (run: ConnectionRun, initialOpenHistory?: ConnectionHistoryItem[]) => {
    if (disposed) return
    runtime.assertWriterOwnership?.()
    const scheduled = resumeTimers.get(run.runId)
    if (scheduled) { clearTimeout(scheduled); resumeTimers.delete(run.runId) }
    if (activeRuns.has(run.runId) || running.has(run.runId)) return
    if (!ownsWriterLease(run)) {
      logger.event('writer_lease', 'failed', { runId: run.runId,
        platformAccountId: run.platformAccountId, errorCode: 'connection_writer_active' })
      return
    }
    run.executorId = runtime.writerId; run.heartbeatAt = runtime.now().toISOString()
    activeRuns.set(run.runId, run)
    try { await executeConnectionRun(runtime, run, running, save, initialOpenHistory) }
    catch (error) {
      logger.event('run_executor', 'failed', { runId: run.runId,
        platformAccountId: run.platformAccountId, errorCode: connectionErrorCode(error) })
    }
    finally {
      activeRuns.delete(run.runId)
      const scheduledRecovery = run.status === 'running' &&
        (run.stage === 'resolving_uncertain' ||
          (run.stage === 'stop_requested' && stopRequests.has(run.runId)))
      if (scheduledRecovery) {
        const dueAt = Date.parse(run.nextActionAt ?? '')
        const delayMs = Number.isFinite(dueAt) ? Math.max(1_000, dueAt - runtime.now().getTime()) : 90_000
        const timer = setTimeout(() => {
          resumeTimers.delete(run.runId)
          void execute(run).catch(error => logger.event('run_recovery', 'failed', {
            runId: run.runId, platformAccountId: run.platformAccountId,
            errorCode: connectionErrorCode(error) }))
        }, delayMs)
        timer.unref?.(); resumeTimers.set(run.runId, timer)
      } else if (run.status !== 'stopped' || persistedStoppedRuns.has(run.runId)) {
        stopRequests.delete(run.runId)
      }
      releaseWriterIfIdle()
    }
  }

  async function recoverPass() {
    const assertRecoveryOwner = () => {
      if (disposed) throw connectionError('connection_writer_service_stopped',
        'Connection Inviter writer service has been stopped.')
      runtime.assertWriterOwnership?.()
    }
    assertRecoveryOwner()
    const today = dateParts(runtime.now(), runtime.timeZone).localDate
    const runs = (await runtime.store.listRuns(100)).filter(run => scope.includes(run.platformAccountId) && !run.searchProgress.automationId)
    assertRecoveryOwner()
    const blockedAccounts = new Set<number>()
    const stale = runs.filter(run => run.localDate !== today && activeRunStatus(run) &&
      ownsWriterLease(run) && !activeRuns.has(run.runId) && !running.has(run.runId))
    for (const run of stale) {
      assertRecoveryOwner()
      const durableStop = run.stage === 'stop_requested'
      if (durableStop) stopRequests.add(run.runId)
      const unsafe = (await runtime.store.listOpenHistory(run.platformAccountId, 1000))
        .filter(item => item.reasonCode !== ACTION_SKIPPED && ['sending', 'uncertain'].includes(item.status))
      assertRecoveryOwner()
      if (unsafe.length) {
        blockedAccounts.add(run.platformAccountId)
        run.status = 'running'; run.stage = durableStop ? 'stop_requested' : 'recovering'
        run.finishedAt = undefined
        await save(run, 'stage_changed', 'critical')
        assertRecoveryOwner()
        void execute(run).then(async () => {
          if (disposed) return
          runtime.assertWriterOwnership?.()
          const current = await runtime.store.getRunByKey(`${run.platformAccountId}:${today}`)
          if (disposed) return
          runtime.assertWriterOwnership?.()
          if (current && activeRunStatus(current) && ownsWriterLease(current)) {
            current.status = 'running'; current.stage = 'recovering'; current.finishedAt = undefined
            await save(current, 'stage_changed', 'critical')
            if (disposed) return
            runtime.assertWriterOwnership?.(); await execute(current)
          }
        }).catch(error => logger.event('run_recovery', 'failed', {
          platformAccountId: run.platformAccountId, errorCode: connectionErrorCode(error) }))
      } else {
        if (durableStop) {
          run.status = 'running'; run.finishedAt = undefined
          await save(run, 'stage_changed', 'critical'); assertRecoveryOwner(); await execute(run)
        } else {
          const closingHistory = await withConnectionRetry(runtime, run, save, 'storage',
            'day_close_history_readback', () => runtime.store.listRunHistory(run.runId, 1000),
            { allowAfterDayClose: true })
          assertRecoveryOwner()
          await closeConnectionRunDay(runtime, run, save, closingHistory)
        }
      }
    }
    const recoverable = runs.filter(run => run.localDate === today && activeRunStatus(run) &&
      ownsWriterLease(run) && !blockedAccounts.has(run.platformAccountId) &&
      !activeRuns.has(run.runId) && !running.has(run.runId))
    for (const run of recoverable) {
      assertRecoveryOwner()
      const durableStop = run.stage === 'stop_requested'
      if (durableStop) stopRequests.add(run.runId)
      run.status = 'running'; run.stage = durableStop ? 'stop_requested' : 'recovering'
      run.finishedAt = undefined
      await save(run, 'stage_changed', 'critical'); assertRecoveryOwner(); void execute(run)
    }
  }

  async function runRecoveryCoordinator() {
    if (!runtime.writerEnabled) return
    let attempt = 0
    while (!disposed) {
      try {
        runtime.assertWriterOwnership?.()
        await recoverPass()
        if (attempt > 0) logger.event('run_recovery_retry', 'succeeded', { attempt })
        return
      } catch (error) {
        const errorCode = connectionErrorCode(error)
        logger.event('run_recovery', 'failed', { errorCode })
        if (!transientConnectionError(error)) return
        attempt += 1; runtime.store.recordRetry?.()
        const delayMs = connectionRetryDelay(attempt, runtime.random,
          retryAfterMilliseconds(error))
        const nextRetryAt = new Date(runtime.now().getTime() + delayMs).toISOString()
        logger.event('run_recovery_retry', 'failed', { attempt, errorCode, delayMs, nextRetryAt })
        let remainingMs = delayMs
        while (!disposed && remainingMs > 0) {
          const sliceMs = Math.min(1_000, remainingMs)
          await runtime.sleep(sliceMs)
          remainingMs -= sliceMs
        }
      }
    }
  }

  function recover() {
    if (!runtime.writerEnabled || disposed) return Promise.resolve()
    if (recoveryCoordinator) return recoveryCoordinator
    const tracked = runRecoveryCoordinator().finally(() => {
      if (recoveryCoordinator === tracked) recoveryCoordinator = undefined
      releaseWriterIfIdle()
    })
    recoveryCoordinator = tracked
    return tracked
  }

  const service = {
    withdrawals,
    async list() { return logged(logger, 'runs_list', {}, async () =>
      (await runtime.store.listRuns(100)).map(publicRun)) },
    async get(runId: string) {
      return logged(logger, 'run_read', { runId }, async () => {
        const active = activeRuns.get(runId)
        if (active) return publicRun(active)
        const run = await runtime.store.getRun(runId); return run && publicRun(run)
      })
    },
    subscribe(runId: string, listener: (event: ConnectionRunEvent) => void) {
      return events.subscribe(runId, listener)
    },
    async history(platformAccountId: number) {
      return logged(logger, 'history_list', { platformAccountId }, async () =>
        (await runtime.store.listHistory(platformAccountId, 100)).map(publicHistory))
    },
    settings() { return { writerEnabled: runtime.writerEnabled } },
    async stacks() { return logged(logger, 'stacks_list', {}, () => repository.listStacks()) },
    async readiness(platformAccountId: number) {
      return logged(logger, 'readiness', { platformAccountId }, async () => {
        const context = await resolveContext(runtime, platformAccountId)
        const accountRuns = await runtime.store.listRunsForAccount(platformAccountId, 100)
        const accountHistory = await runtime.store.listHistory(platformAccountId, 1000)
        const latest = accountRuns[0]
        if (latest) synchronizeConfirmedProgress(latest, accountHistory, latest.audienceQuota)
        const sevenDayStart = runtime.now().getTime() - 7 * 86_400_000
        const sevenDaySent = accountHistory.filter(item => ['sent', 'accepted'].includes(item.status) &&
          Date.parse(item.verifiedAt ?? item.sentAt ?? item.updatedAt) >= sevenDayStart).length
        return { platformAccountId, clientId: context.clientId, clientName: context.clientName,
          stackId: context.stackId, stack: context.stack, ready: Boolean(context.stack),
          writerEnabled: runtime.writerEnabled, writerId: runtime.writerId, sevenDaySent,
          safeRecruiterOnlyAvailable: !context.stack, latest: latest ? publicRun(latest) : undefined }
      })
    },
    async saveStack(platformAccountId: number, stackId: number) {
      scope.assert(platformAccountId)
      if (!runtime.writerEnabled) throw connectionError('connection_writer_disabled',
        'Connection Inviter is read-only on this backend.')
      runtime.assertWriterOwnership?.()
      return logged(logger, 'stack_save', { platformAccountId }, async () => {
        const context = await resolveContext(runtime, platformAccountId)
        const stack = await repository.updatePrimaryStack(context.clientId, stackId)
        return { platformAccountId, clientId: context.clientId, stackId: stack.id, stack: stack.name,
          ready: true, writerEnabled: runtime.writerEnabled, safeRecruiterOnlyAvailable: false }
      })
    },
    async start(platformAccountId: number, input: { safeRecruiterOnly?: boolean } = {}, automationId?: string) {
      scope.assert(platformAccountId)
      if (disposed) throw connectionError('connection_writer_service_stopped',
        'Connection Inviter writer service has been stopped.')
      runtime.assertWriterOwnership?.()
      if (!runtime.writerEnabled) throw connectionError('connection_writer_disabled',
        'Connection Inviter is read-only on this backend.')
      return logged(logger, 'run_start', { platformAccountId,
        safeRecruiterOnly: input.safeRecruiterOnly === true }, async () => {
        const date = dateParts(runtime.now(), runtime.timeZone)
        const existing = await runtime.store.getRunByKey(`${platformAccountId}:${date.localDate}`)
        if (automationId && existing && activeRuns.has(existing.runId)) throw connectionError('linkedin_operation_active', 'Manual run is active.')
        if (automationId && existing) {
          existing.searchProgress.automationId = automationId
          await save(existing, 'progress', 'critical')
        }
        const launch = (value: ConnectionRun, history?: ConnectionHistoryItem[]) => {
          if (!value.searchProgress.automationId) void execute(value, history)
        }
        const context = await resolveContext(runtime, platformAccountId)
        const openHistory = await runtime.store.listOpenHistory(platformAccountId, 1000)
        const unresolvedWrites = openHistory.filter(item => ['sending', 'uncertain'].includes(item.status) &&
          (item.reasonCode !== ACTION_SKIPPED || item.accountId !== context.accountId))
        if (unresolvedWrites.length && (!automationId || unresolvedWrites.some(item => item.accountId !== context.accountId))) {
          throw connectionError('connection_invitation_result_pending',
            'A previous invitation result must be reconciled before a new daily run can start.')
        }
        if (existing) {
          if (activeRunStatus(existing)) {
            // `stop_requested` is durable state, not just a process-local flag. A manual
            // start racing recovery must never clear the operator's Stop intent.
            if (existing.stage === 'stop_requested') stopRequests.add(existing.runId)
            if (ownsWriterLease(existing) && !activeRuns.has(existing.runId)) launch(existing)
            return publicRun(existing)
          }
          const ready = Boolean(context.stack || input.safeRecruiterOnly)
          const history = await runtime.store.listRunHistory(existing.runId, 1000)
          synchronizeConfirmedProgress(existing, history, existing.audienceQuota)
          const retry = ready && (failedRunCanRetry(existing, history) ||
            (existing.status === 'stopped' && existing.dailyQuota === undefined &&
              history.every(h => !h.sentAt && !h.requestId && !['sending', 'uncertain'].includes(h.status))))
          const topUp = ready && completedRunCanTopUp(existing, context)
          const resume = ready && transientRunCanResume(existing)
          const stackResume = existing.status === 'paused' && existing.stage === 'stack_required' && ready
          if (stackResume || retry || topUp || resume) {
            if (topUp || resume) {
              prepareRunTopUp(existing, context, input.safeRecruiterOnly === true)
              if (topUp) runtime.store.resetNocoBudget?.(existing.runId)
            }
            else prepareRunRetry(existing, context, input.safeRecruiterOnly === true)
            await save(existing, 'stage_changed', 'critical')
            stopRequests.delete(existing.runId); launch(existing)
          }
          if (existing.status === 'failed' && !retry) {
            throw connectionError('connection_run_retry_blocked',
              'This failed run may have reached an invitation write and requires review.')
          }
          return publicRun(existing)
        }
        const run = makeRun(context, runtime.now(), runtime.timeZone, input.safeRecruiterOnly === true)
        if (automationId) run.searchProgress.automationId = automationId
        run.executorId = runtime.writerId; run.heartbeatAt = runtime.now().toISOString()
        const created = await runtime.store.createRun(run)
        lastPersistedAt.set(created.run.runId, runtime.now().getTime())
        logger.event('run_create', 'succeeded', { runId: created.run.runId, platformAccountId,
          created: created.created, runStatus: created.run.status, runStage: created.run.stage })
        runtime.emit(created.run, 'snapshot')
        if (created.created && run.status === 'running') launch(run, openHistory)
        return publicRun(created.run)
      })
    },
    async resumeManaged(runId: string) {
      let run = await runtime.store.getRun(runId)
      if (!run?.searchProgress.automationId || run.localDate !== dateParts(runtime.now(), runtime.timeZone).localDate)
          throw connectionError('connection_resume_invalid', 'Нельзя возобновить этот дневной прогон.')
      if (run.status === 'running' && run.stage === 'stop_requested') {
        const result = await service.stepManaged(runId, true)
        if (result.status !== 'stopped') throw connectionError('connection_invitation_result_pending',
          'Сначала нужно завершить проверку остановленного прогона.')
        run = (await runtime.store.getRun(runId))!
      }
      if (run.status === 'stopped') {
        runtime.assertWriterOwnership?.(); scope.assert(run.platformAccountId)
        if (!runtime.writerEnabled) throw connectionError('connection_writer_disabled', 'Writer is disabled.')
        run.status = 'running'; run.stage = 'recovering'; run.finishedAt = undefined
        if (run.searchProgress.invitationVerification?.nextCheckAt === run.nextActionAt && !run.retryState)
          run.errorCode = 'connection_invitation_result_pending'
        await save(run, 'stage_changed', 'critical'); stopRequests.delete(runId)
        return
      }
      const resumed = await service.start(run.platformAccountId, {}, run.searchProgress.automationId)
      if (resumed.runId !== runId) throw connectionError('connection_resume_invalid', 'Изменился прогон.')
    },
    async stepManaged(runId: string, stop = false, cooperate?: ConnectionRuntime['cooperate']): Promise<ExecutionStep> {
      runtime.assertWriterOwnership?.()
      if (stepping.has(runId) || activeRuns.has(runId)) throw connectionError('linkedin_operation_active', 'Run is active.')
      stepping.add(runId)
      try {
        let current = managed.get(runId)
        if (current) current.control.cooperate = cooperate
        const run = current?.run ?? await runtime.store.getRun(runId)
        if (!run?.searchProgress.automationId) throw connectionError('connection_managed_run_missing', 'Automatic run was not found.')
        if (stop || run.status === 'stopped') {
          const firstStop = run.status !== 'stopped'
          stopRequests.add(runId)
          if (current) { await current.steps.return(undefined); managed.delete(runId) }
            const history = await runtime.store.listRunHistory(runId, 1000)
            await expireInvitationRecovery(runtime, run, save, history)
            const pending = history.filter(item => item.reasonCode !== ACTION_SKIPPED && ['sending', 'uncertain'].includes(item.status))
          run.status = 'stopped'; run.stage = 'stopped_by_admin'
          synchronizeConfirmedProgress(run, history, run.audienceQuota)
          const until = Math.max(Date.parse(run.nextActionAt ?? '') || 0,
            Date.parse(run.searchProgress.invitationVerification?.nextCheckAt ?? '') || 0,
            Date.parse(run.searchProgress.invitationVerification?.blockedUntil ?? '') || 0,
            firstStop ? runtime.now().getTime() + 60_000 : 0)
          if (!pending.length || until > runtime.now().getTime()) {
            if (pending.length) run.nextActionAt = new Date(until).toISOString()
            await save(run, 'stopped', 'critical')
            return pending.length ? { status: 'verifying', nextActionAt: run.nextActionAt,
              reason: 'connection_invitation_result_pending' } : { status: 'stopped' }
          }
          const release = runtime.gate?.acquire('connection_inviter', runId, String(run.platformAccountId))
          try {
            const result = await withConnectionRequestTrace(run, runtime.logger, () =>
              reconcileInvitations(runtime, run, save, { singlePass: true, runOnly: true,
              ignoreStopRequested: true, openHistory: pending }))
            synchronizeConfirmedProgress(run, await runtime.store.listRunHistory(runId, 1000), run.audienceQuota)
            run.status = 'stopped'; run.stage = 'stopped_by_admin'; await save(run, 'stopped', 'critical')
            return result.unresolved ? { status: 'verifying', nextActionAt: run.nextActionAt,
              reason: 'connection_invitation_result_pending' } : { status: 'stopped' }
          } finally { release?.() }
        }
          if (!current && ['succeeded', 'partial', 'failed', 'paused'].includes(run.status))
            return { status: run.status === 'succeeded' ? 'completed' : 'needs_attention', reason: run.errorCode,
              skippedActions: skippedActions(run.searchProgress.actionRecovery), summary: { completed: run.counters.sent,
                skipped: run.counters.skipped, unconfirmed: Object.keys(run.searchProgress.reservedInvitations ?? {}).length } }
        if (!current) {
          const control = { cooperate }
          current = { run, control, steps: connectionSteps({ ...runtime, cooperative: true,
            cooperate: cooperate ? (action, until, verifying) => control.cooperate!(action, until, verifying) : undefined }, run, running,
            (r, event) => save(r, event, 'critical')) }
          managed.set(runId, current)
        }
          let result: IteratorResult<ExecutionStep>
          try { result = await withConnectionRequestTrace(run, runtime.logger, () => current!.steps.next()) }
          catch (error) {
            // A throwing async iterator is closed. Recreate it from the saved
            // checkpoint next time instead of interpreting done as a failed run.
            managed.delete(runId); throw error
          }
        const step = result.value ?? { status: run.status === 'succeeded' ? 'completed' :
          (run.status as string) === 'stopped' ? 'stopped' : 'needs_attention', reason: run.errorCode }
        // A retry may drain the current iterator. The next invocation restores the same run.
        if (result.done || ['completed', 'stopped', 'needs_attention', 'verifying'].includes(step.status) ||
          (step.status === 'waiting' && !running.has(runId))) {
          await current.steps.return(undefined); managed.delete(runId)
        }
        return step
      } finally { stepping.delete(runId) }
    },
    async stopRun(runId: string) {
      if (!runtime.writerEnabled) throw connectionError('connection_writer_disabled',
        'Connection Inviter is read-only on this backend.')
      runtime.assertWriterOwnership?.()
      if (options.allowedAccounts) {
        const run = activeRuns.get(runId) ?? await runtime.store.getRun(runId)
        if (run) scope.assert(run.platformAccountId)
      }
      const row = managed.get(runId)?.run ?? await runtime.store.getRun(runId)
      if (row?.searchProgress.automationId) {
        stopRequests.add(runId); row.stage = 'stop_requested'; await save(row, 'stage_changed', 'critical')
        return publicRun(row)
      }
      return requestRunStop(runtime, activeRuns, stopRequests, runId, save, execute)
    },
    async recover() {
      if (disposed) return
      runtime.assertWriterOwnership?.()
      await recover()
    },
    stop() {
      disposed = true
      void withdrawals?.close().finally(releaseWriterIfIdle)
      for (const timer of resumeTimers.values()) clearTimeout(timer)
      resumeTimers.clear(); events.clear()
      for (const runId of activeRuns.keys()) stopRequests.add(runId)
      for (const value of managed.values()) void value.steps.return(undefined).catch(() => undefined)
      releaseWriterWhenIdle = true; releaseWriterIfIdle()
    }
  }

  if (options.autoRecover !== false) queueMicrotask(() => void recover())
  return service
}
