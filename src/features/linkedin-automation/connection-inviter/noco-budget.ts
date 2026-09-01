import { AsyncLocalStorage } from 'node:async_hooks'
import { connectionError } from './errors.ts'
import type { ConnectionRun } from './types.ts'

// Connection Inviter owns at most 210 feature-local physical attempts. The remaining ten
// requests in the product-wide 220 budget are reserved for the shared account-context client,
// which deliberately remains outside this feature's storage implementation.
export const CONNECTION_NOCO_PHYSICAL_LIMIT = 210
// Normal-path reserve: one history read, one open-history read and one cached terminal PATCH,
// plus one spare attempt. Transient safety reconciliation is allowed to exceed the feature
// cutoff, but is counted separately as an explicit safety overrun.
export const CONNECTION_NOCO_TERMINAL_RESERVE = 4
// A normal invitation needs exactly claim POST, claim read-back and cached history PATCH.
// Any transient failure switches to separately counted safety reconciliation.
export const CONNECTION_NOCO_INVITATION_RESERVE = 3
export const CONNECTION_NOCO_OPTIONAL_RESERVE =
  CONNECTION_NOCO_TERMINAL_RESERVE + CONNECTION_NOCO_INVITATION_RESERVE

export type ConnectionNocoBudgetSnapshot = {
  limit: number
  physicalAttempts: number
  retryAttempts: number
  safetyOverrun: number
  reserve: number
}

type RunScope = { kind: 'run'; runId: string; mode: 'mandatory' | 'optional' }
type CaptureScope = { kind: 'capture'; physicalAttempts: number; retryAttempts: number }
type BudgetScope = RunScope | CaptureScope

type RunBudget = ConnectionNocoBudgetSnapshot & { initialized: boolean }

const emptyBudget = (): RunBudget => ({
  limit: CONNECTION_NOCO_PHYSICAL_LIMIT,
  physicalAttempts: 0,
  retryAttempts: 0,
  safetyOverrun: 0,
  reserve: CONNECTION_NOCO_OPTIONAL_RESERVE,
  initialized: false
})

function persistedBudget(run: ConnectionRun): Partial<ConnectionNocoBudgetSnapshot> {
  const value = run.searchProgress.nocoBudget
  return value && typeof value === 'object' ? value : {}
}

export function createConnectionNocoBudgetController() {
  const storage = new AsyncLocalStorage<BudgetScope>()
  const budgets = new Map<string, RunBudget>()
  const lifecycleByRunKey = new Map<string, CaptureScope>()
  const lifecycleByAccount = new Map<number, CaptureScope>()

  const budgetFor = (runId: string) => {
    let value = budgets.get(runId)
    if (!value) { value = emptyBudget(); budgets.set(runId, value) }
    return value
  }

  function initialize(run: ConnectionRun) {
    const budget = budgetFor(run.runId)
    if (budget.initialized) return budget
    const persisted = persistedBudget(run)
    budget.physicalAttempts = Math.max(0, Number(persisted.physicalAttempts) || 0)
    budget.retryAttempts = Math.max(0, Number(persisted.retryAttempts) || 0)
    budget.safetyOverrun = Math.max(0, Number(persisted.safetyOverrun) || 0)
    budget.reserve = Math.max(CONNECTION_NOCO_TERMINAL_RESERVE,
      Number(persisted.reserve) || CONNECTION_NOCO_OPTIONAL_RESERVE)
    budget.initialized = true
    return budget
  }

  function add(runId: string, physicalAttempts: number, retryAttempts = 0) {
    const budget = budgetFor(runId)
    budget.physicalAttempts += Math.max(0, physicalAttempts)
    budget.retryAttempts += Math.max(0, retryAttempts)
  }

  function mergeCapture(target: CaptureScope, source?: CaptureScope) {
    if (!source) return
    target.physicalAttempts += source.physicalAttempts
    target.retryAttempts += source.retryAttempts
  }

  function onPhysicalAttempt(attempt: { attempt: number }) {
    const scope = storage.getStore()
    if (!scope) return
    if (scope.kind === 'capture') {
      scope.physicalAttempts += 1
      if (attempt.attempt > 1) scope.retryAttempts += 1
      return
    }
    const budget = budgetFor(scope.runId)
    const cutoff = scope.mode === 'optional'
      ? budget.limit - budget.reserve : budget.limit
    if (budget.physicalAttempts >= cutoff) {
      if (scope.mode === 'mandatory') {
        // Once a durable sending/uncertain state exists, reconciliation wins over the budget.
        budget.safetyOverrun += 1
      } else {
        throw connectionError('connection_noco_budget_exhausted',
          'Connection Inviter NocoDB physical request budget is exhausted.')
      }
    }
    budget.physicalAttempts += 1
    if (attempt.attempt > 1) budget.retryAttempts += 1
  }

  async function capture<T>(action: () => Promise<T>) {
    const scope: CaptureScope = { kind: 'capture', physicalAttempts: 0, retryAttempts: 0 }
    const value = await storage.run(scope, action)
    return { value, scope }
  }

  function currentRunId() {
    const scope = storage.getStore()
    return scope?.kind === 'run' ? scope.runId : undefined
  }

  function syncRun(run: ConnectionRun, inFlightReserve = 0) {
    const budget = initialize(run)
    run.searchProgress.nocoBudget = {
      limit: budget.limit,
      physicalAttempts: budget.physicalAttempts + Math.max(0, inFlightReserve),
      retryAttempts: budget.retryAttempts,
      safetyOverrun: budget.safetyOverrun,
      reserve: budget.reserve
    }
  }

  return {
    onPhysicalAttempt,
    currentRunId,
    initialize,
    syncRun,
    snapshot(runId: string): ConnectionNocoBudgetSnapshot {
      const { initialized: _initialized, ...snapshot } = budgetFor(runId)
      return structuredClone(snapshot)
    },
    canStart(runId: string, requiredPhysicalAttempts: number) {
      const budget = budgetFor(runId)
      return budget.physicalAttempts + Math.max(0, requiredPhysicalAttempts) <= budget.limit
    },
    setReserve(runId: string, reserve: number) {
      budgetFor(runId).reserve = Math.max(CONNECTION_NOCO_TERMINAL_RESERVE, reserve)
    },
    run<T>(run: ConnectionRun, action: () => Promise<T>) {
      initialize(run)
      return storage.run({ kind: 'run', runId: run.runId, mode: 'mandatory' }, action)
    },
    mode<T>(runId: string, mode: 'mandatory' | 'optional', action: () => Promise<T>) {
      return storage.run({ kind: 'run', runId, mode }, action)
    },
    async captureRunKey<T>(runKey: string, action: () => Promise<T>, resolveRun?: (value: T) =>
      ConnectionRun | undefined) {
      if (currentRunId()) return action()
      const result = await capture(action)
      const run = resolveRun?.(result.value)
      if (run) {
        initialize(run); add(run.runId, result.scope.physicalAttempts, result.scope.retryAttempts)
      } else {
        const existing = lifecycleByRunKey.get(runKey) ??
          { kind: 'capture' as const, physicalAttempts: 0, retryAttempts: 0 }
        mergeCapture(existing, result.scope); lifecycleByRunKey.set(runKey, existing)
      }
      return result.value
    },
    async captureAccount<T>(platformAccountId: number, action: () => Promise<T>) {
      if (currentRunId()) return action()
      const result = await capture(action)
      const existing = lifecycleByAccount.get(platformAccountId) ??
        { kind: 'capture' as const, physicalAttempts: 0, retryAttempts: 0 }
      mergeCapture(existing, result.scope); lifecycleByAccount.set(platformAccountId, existing)
      return result.value
    },
    attachLifecycle(run: ConnectionRun) {
      initialize(run)
      const runKey = lifecycleByRunKey.get(run.runKey)
      const account = lifecycleByAccount.get(run.platformAccountId)
      add(run.runId, runKey?.physicalAttempts ?? 0, runKey?.retryAttempts ?? 0)
      add(run.runId, account?.physicalAttempts ?? 0, account?.retryAttempts ?? 0)
      lifecycleByRunKey.delete(run.runKey); lifecycleByAccount.delete(run.platformAccountId)
    },
    addCapturedToRuns(runs: ConnectionRun[], scope: CaptureScope) {
      for (const run of runs) {
        initialize(run); add(run.runId, scope.physicalAttempts, scope.retryAttempts)
      }
    },
    capture
  }
}

export type ConnectionNocoBudgetController = ReturnType<typeof createConnectionNocoBudgetController>
