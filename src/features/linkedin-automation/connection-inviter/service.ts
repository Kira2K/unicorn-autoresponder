import { resolveContext } from './account.mts'
import { executeConnectionRun } from './execution.ts'
import { dateParts } from './limits.ts'
import { createConnectionLogger, logged } from './logger.ts'
import { createConnectionInviterStore } from './noco-store.mts'
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
import { synchronizeConfirmedProgress } from './daily-progress.ts'
import { withConnectionRetry } from './retry-state.ts'
import { acquireConnectionWriterLock } from './writer-lock.ts'
import type { ConnectionRunEventType, ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun, ConnectionRunStage } from './types.ts'

type ServiceOptions = Partial<Omit<ConnectionRuntime, 'adapter' | 'emit' | 'stopRequested'>> & {
  repository?: ConnectionRuntime['repository']
  adapter?: ReturnType<ConnectionRuntime['adapter']>
  autoRecover?: boolean
  enforceWriterSingleton?: boolean
  writerLockPath?: string
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
  const repository = options.repository
  if (!repository) throw new Error('Connection Inviter requires a LinkedIn repository.')
  const logger = options.logger ?? createConnectionLogger()
  const events = createConnectionRunEvents()
  const stopRequests = new Set<string>()
  const activeRuns = new Map<string, ConnectionRun>()
  const running = new Set<string>()
  const resumeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const persistQueues = new Map<string, Promise<void>>()
  const lastPersistedAt = new Map<string, number>()
  const persistedStoppedRuns = new Set<string>()
  // Search progress is served from the active in-memory run and SSE. Noco keeps a durable,
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
    if (!releaseWriterWhenIdle || activeRuns.size > 0 || running.size > 0 || recoveryCoordinator) return
    writerLock?.release(); releaseWriterWhenIdle = false
  }
  const runtime: ConnectionRuntime = {
    store: options.store ?? createConnectionInviterStore(), repository,
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
    }
  }

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
    const outerRetry = run.retryState?.provider !== 'noco' ? structuredClone(run.retryState) : undefined
    const outerTimer = outerRetry && run.timerState ? structuredClone(run.timerState) : undefined
    const outerNextActionAt = outerRetry ? run.nextActionAt : undefined
    const outerPausedAt = outerRetry ? run.pausedAt : undefined
    const outerErrorCode = outerRetry ? run.errorCode : undefined
    let nocoRetried = false
    while (true) {
      run.updatedAt = runtime.now().toISOString()
      if (run.status === 'running') {
        run.executorId = runtime.writerId; run.heartbeatAt = run.updatedAt
      }
      try {
        await persistRunSnapshot(run)
        if (run.status === 'stopped') persistedStoppedRuns.add(run.runId)
        if (nocoRetried) {
          nocoRetried = false; run.retryState = outerRetry; run.timerState = outerTimer
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
        const error = normalizeConnectionProviderError('noco', caught)
        if (!transientConnectionError(error)) throw error
        nocoRetried = true
        runtime.store.recordRetry?.()
        run.retryState = makeRetryState(runtime, run, 'noco', 'update_run', error)
        run.stage = 'waiting_retry'; run.errorCode = run.retryState.errorCode
        run.pausedAt = runtime.now().toISOString(); run.nextActionAt = run.retryState.nextRetryAt
        run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
          nextActionAt: run.retryState.nextRetryAt }
        logger.event('retry', 'failed', { runId: run.runId,
          platformAccountId: run.platformAccountId, provider: 'noco', operation: 'update_run',
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
    const runs = await runtime.store.listRuns(100)
    assertRecoveryOwner()
    const blockedAccounts = new Set<number>()
    const stale = runs.filter(run => run.localDate !== today && activeRunStatus(run) &&
      ownsWriterLease(run) && !activeRuns.has(run.runId) && !running.has(run.runId))
    for (const run of stale) {
      assertRecoveryOwner()
      const durableStop = run.stage === 'stop_requested'
      if (durableStop) stopRequests.add(run.runId)
      const unsafe = (await runtime.store.listOpenHistory(run.platformAccountId, 1000))
        .filter(item => ['sending', 'uncertain'].includes(item.status))
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
          const closingHistory = await withConnectionRetry(runtime, run, save, 'noco',
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
    async start(platformAccountId: number, input: { safeRecruiterOnly?: boolean } = {}) {
      if (disposed) throw connectionError('connection_writer_service_stopped',
        'Connection Inviter writer service has been stopped.')
      runtime.assertWriterOwnership?.()
      if (!runtime.writerEnabled) throw connectionError('connection_writer_disabled',
        'Connection Inviter is read-only on this backend.')
      return logged(logger, 'run_start', { platformAccountId,
        safeRecruiterOnly: input.safeRecruiterOnly === true }, async () => {
        const date = dateParts(runtime.now(), runtime.timeZone)
        const existing = await runtime.store.getRunByKey(`${platformAccountId}:${date.localDate}`)
        const context = await resolveContext(runtime, platformAccountId)
        const openHistory = await runtime.store.listOpenHistory(platformAccountId, 1000)
        const unresolvedWrites = openHistory.filter(item => ['sending', 'uncertain'].includes(item.status))
        if (unresolvedWrites.length) {
          throw connectionError('connection_invitation_result_pending',
            'A previous invitation result must be reconciled before a new daily run can start.')
        }
        if (existing) {
          if (activeRunStatus(existing)) {
            // `stop_requested` is durable state, not just a process-local flag. A manual
            // start racing recovery must never clear the operator's Stop intent.
            if (existing.stage === 'stop_requested') stopRequests.add(existing.runId)
            if (ownsWriterLease(existing) && !activeRuns.has(existing.runId)) void execute(existing)
            return publicRun(existing)
          }
          const ready = Boolean(context.stack || input.safeRecruiterOnly)
          const history = await runtime.store.listRunHistory(existing.runId, 1000)
          synchronizeConfirmedProgress(existing, history, existing.audienceQuota)
          const retry = ready && failedRunCanRetry(existing, history)
          const topUp = ready && completedRunCanTopUp(existing, context)
          const resume = ready && transientRunCanResume(existing)
          const stackResume = existing.status === 'paused' && existing.stage === 'stack_required' && ready
          if (stackResume || retry || topUp || resume) {
            if (topUp || resume) {
              prepareRunTopUp(existing, context, input.safeRecruiterOnly === true)
              if (topUp) runtime.store.resetNocoBudget(existing.runId)
            }
            else prepareRunRetry(existing, context, input.safeRecruiterOnly === true)
            await save(existing, 'stage_changed', 'critical'); void execute(existing)
          }
          if (existing.status === 'failed' && !retry) {
            throw connectionError('connection_run_retry_blocked',
              'This failed run may have reached an invitation write and requires review.')
          }
          return publicRun(existing)
        }
        const run = makeRun(context, runtime.now(), runtime.timeZone, input.safeRecruiterOnly === true)
        run.executorId = runtime.writerId; run.heartbeatAt = runtime.now().toISOString()
        const created = await runtime.store.createRun(run)
        lastPersistedAt.set(created.run.runId, runtime.now().getTime())
        logger.event('run_create', 'succeeded', { runId: created.run.runId, platformAccountId,
          created: created.created, runStatus: created.run.status, runStage: created.run.stage })
        runtime.emit(created.run, 'snapshot')
        if (created.created && run.status === 'running') void execute(run, openHistory)
        return publicRun(created.run)
      })
    },
    async stopRun(runId: string) {
      if (!runtime.writerEnabled) throw connectionError('connection_writer_disabled',
        'Connection Inviter is read-only on this backend.')
      runtime.assertWriterOwnership?.()
      return requestRunStop(runtime, activeRuns, stopRequests, runId, save, execute)
    },
    async recover() {
      if (disposed) return
      runtime.assertWriterOwnership?.()
      await recover()
    },
    stop() {
      disposed = true
      for (const timer of resumeTimers.values()) clearTimeout(timer)
      resumeTimers.clear(); events.clear()
      for (const runId of activeRuns.keys()) stopRequests.add(runId)
      releaseWriterWhenIdle = true; releaseWriterIfIdle()
    }
  }

  if (options.autoRecover !== false) queueMicrotask(() => void recover())
  return service
}
