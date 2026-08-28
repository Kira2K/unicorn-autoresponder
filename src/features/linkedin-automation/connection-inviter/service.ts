import { resolveContext } from './account.mts'
import { executeConnectionRun } from './execution.ts'
import { dateParts } from './limits.ts'
import { createConnectionLogger, logged } from './logger.ts'
import { createConnectionInviterStore } from './noco-store.mts'
import { createConnectionUnipileAdapter } from './unipile-adapter.ts'
import { makeRun, publicHistory, publicRun } from './run-model.ts'
import type { ConnectionRuntime } from './runtime.ts'
import type { ConnectionRun } from './types.ts'

export function createConnectionInviterService(options: any = {}) {
  const repository = options.repository
  if (!repository) throw new Error('Connection Inviter requires a LinkedIn repository.')
  const logger = options.logger ?? createConnectionLogger()
  let adapter: any
  const runtime: ConnectionRuntime = {
    store: options.store ?? createConnectionInviterStore(), repository,
    adapter: () => adapter ??= options.adapter ?? createConnectionUnipileAdapter({ logger }),
    gate: options.gate, now: options.now ?? (() => new Date()),
    timeZone: options.timeZone ?? process.env.LINKEDIN_CONNECTION_TIME_ZONE ?? 'Europe/Moscow',
    random: options.random ?? Math.random,
    sleep: options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))),
    logger
  }
  const running = new Set<string>()
  async function save(run: ConnectionRun) {
    run.updatedAt = runtime.now().toISOString(); await runtime.store.updateRun(run)
    logger.event('run_state_persist', 'succeeded', { runId: run.runId,
      platformAccountId: run.platformAccountId, runStatus: run.status, runStage: run.stage })
  }
  const execute = (run: ConnectionRun) => executeConnectionRun(runtime, run, running, save)
  return {
    async list() { return logged(logger, 'runs_list', {}, async () =>
      (await runtime.store.listRuns(100)).map(publicRun)) },
    async get(runId: string) {
      return logged(logger, 'run_read', { runId }, async () => {
        const run = await runtime.store.getRun(runId); return run && publicRun(run)
      })
    },
    async history(platformAccountId: number) {
      return logged(logger, 'history_list', { platformAccountId }, async () =>
        (await runtime.store.listHistory(platformAccountId, 100)).map(publicHistory))
    },
    async stacks() { return logged(logger, 'stacks_list', {}, () => repository.listStacks()) },
    async readiness(platformAccountId: number) {
      return logged(logger, 'readiness', { platformAccountId }, async () => {
        const context = await resolveContext(runtime, platformAccountId)
        const latest = (await runtime.store.listRuns(100)).find((run: ConnectionRun) =>
          run.platformAccountId === platformAccountId)
        return { platformAccountId, clientId: context.clientId, clientName: context.clientName,
          stackId: context.stackId, stack: context.stack, ready: Boolean(context.stack),
          safeRecruiterOnlyAvailable: !context.stack, latest: latest ? publicRun(latest) : undefined }
      })
    },
    async saveStack(platformAccountId: number, stackId: number) {
      return logged(logger, 'stack_save', { platformAccountId }, async () => {
        const context = await resolveContext(runtime, platformAccountId)
        const stack = await repository.updatePrimaryStack(context.clientId, stackId)
        return { platformAccountId, clientId: context.clientId, stackId: stack.id, stack: stack.name,
          ready: true, safeRecruiterOnlyAvailable: false }
      })
    },
    async start(platformAccountId: number, input: { safeRecruiterOnly?: boolean } = {}) {
      return logged(logger, 'run_start', { platformAccountId,
        safeRecruiterOnly: input.safeRecruiterOnly === true }, async () => {
        const date = dateParts(runtime.now(), runtime.timeZone)
        const existing = await runtime.store.getRunByKey(`${platformAccountId}:${date.localDate}`)
        const context = await resolveContext(runtime, platformAccountId)
        if (existing) {
          if (existing.status === 'paused' && (context.stack || input.safeRecruiterOnly)) {
            existing.stackId = context.stackId; existing.stack = context.stack
            existing.safeRecruiterOnly = !context.stack && input.safeRecruiterOnly === true
            existing.status = 'running'; existing.stage = 'queued'; existing.errorCode = undefined
            existing.finishedAt = undefined; await save(existing); void execute(existing)
          }
          return publicRun(existing)
        }
        const run = makeRun(context, runtime.now(), runtime.timeZone, input.safeRecruiterOnly === true)
        const created = await runtime.store.createRun(run)
        logger.event('run_create', 'succeeded', { runId: created.run.runId, platformAccountId,
          created: created.created, runStatus: created.run.status, runStage: created.run.stage })
        if (created.created && run.status === 'running') void execute(run)
        return publicRun(created.run)
      })
    },
    stop() {}
  }
}
