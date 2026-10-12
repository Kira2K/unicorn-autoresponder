import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { atomicJson } from './store.ts'

export type BudgetPolicy = {
  version: 1
  campaignId: string
  baseline: { observedAt: string; limitId: string; windowMinutes: number; usedPercent: number; resetsAt: number }
  allowancePoints: number
  bufferPoints: number
  pauseAtPercent: number
  stopAtPercent: number
}

export type RateLimitObservation = {
  observedAt: string
  limitId: string
  windowMinutes: number
  usedPercent: number
  resetsAt: number
}

export type GuardStatus = 'paused' | 'ready' | 'admission_stopped' | 'hard_stopped'
export type GuardState = {
  version: 1
  campaignId: string
  status: GuardStatus
  reason: string
  updatedAt: string
  observation?: RateLimitObservation
  accounting: {
    calls: number
    failedCalls: number
    uniqueResponses: number
    duplicateResponses: number
    responsesWithoutId: number
    knownInputTokens: number
    knownCachedInputTokens: number
    knownUncachedInputTokens: number
    knownOutputTokens: number
    knownReasoningTokens: number
  }
  seenResponseHashes?: string[]
}

export type CallUsage = { ok: boolean; responseId?: string; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; reasoningTokens?: number }
export type QuotaGuard = ReturnType<typeof createQuotaGuard>

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isoTime = (value: unknown) => typeof value === 'string' ? Date.parse(value) : Number.NaN
const safeTokenCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0

export function assertBudgetPolicy(value: unknown): asserts value is BudgetPolicy {
  const policy = value as Partial<BudgetPolicy>, baseline = policy?.baseline
  if (policy?.version !== 1 || typeof policy.campaignId !== 'string' || !policy.campaignId || !baseline ||
      typeof baseline.limitId !== 'string' || !baseline.limitId || !finite(baseline.usedPercent) || baseline.usedPercent < 0 || baseline.usedPercent > 100 ||
      !Number.isInteger(baseline.windowMinutes) || baseline.windowMinutes <= 0 || !Number.isSafeInteger(baseline.resetsAt) ||
      !Number.isFinite(isoTime(baseline.observedAt)) || !finite(policy.allowancePoints) || policy.allowancePoints <= 0 ||
      !finite(policy.bufferPoints) || policy.bufferPoints < 0 || policy.bufferPoints >= policy.allowancePoints ||
      !finite(policy.pauseAtPercent) || !finite(policy.stopAtPercent)) throw Error('invalid_budget_policy')
  const expectedStop = baseline.usedPercent + policy.allowancePoints
  const expectedPause = expectedStop - policy.bufferPoints
  if (policy.stopAtPercent !== expectedStop || policy.pauseAtPercent !== expectedPause || expectedStop > 100) throw Error('budget_policy_threshold_mismatch')
}

export async function loadBudgetPolicy(path: string): Promise<BudgetPolicy> {
  let value: unknown
  try { value = JSON.parse(await readFile(path, 'utf8')) } catch { throw Error('budget_policy_unreadable') }
  assertBudgetPolicy(value)
  return value
}

/** Extracts only the account-wide primary percentage and window identity. Tokens never enter this decision. */
export function primaryRateLimit(value: unknown, observedAt = new Date().toISOString(), windowMinutes = 10080): RateLimitObservation | undefined {
  const payload = (value as any)?.result ?? value
  const codex = payload?.rateLimitsByLimitId?.codex
  const selected = codex && Object.values(codex).find((limit: any) => limit?.windowDurationMins === windowMinutes) as any
  if (!selected) return undefined
  return { observedAt, limitId: 'codex', windowMinutes: selected.windowDurationMins, usedPercent: selected.usedPercent, resetsAt: selected.resetsAt }
}

export function evaluateQuota(policy: BudgetPolicy, observation: RateLimitObservation | undefined,
  previous: RateLimitObservation | undefined, nowMs: number, maxAgeMs = 30_000): Pick<GuardState, 'status' | 'reason'> {
  if (!observation) return { status: 'paused', reason: 'rate_limit_missing' }
  const observedMs = isoTime(observation.observedAt)
  if (!finite(observation.usedPercent) || observation.usedPercent < 0 || observation.usedPercent > 100 ||
      !Number.isInteger(observation.windowMinutes) || observation.windowMinutes <= 0 ||
      !Number.isSafeInteger(observation.resetsAt) || !Number.isFinite(observedMs)) return { status: 'paused', reason: 'rate_limit_invalid' }
  if (observedMs > nowMs + 5_000 || nowMs - observedMs > maxAgeMs) return { status: 'paused', reason: 'rate_limit_stale' }
  // The service rounds the same weekly reset timestamp by about one second between reads.
  if (observation.limitId !== policy.baseline.limitId || observation.windowMinutes !== policy.baseline.windowMinutes ||
      Math.abs(observation.resetsAt - policy.baseline.resetsAt) > 2) return { status: 'paused', reason: 'rate_limit_window_changed' }
  if (Math.floor(nowMs / 1000) >= policy.baseline.resetsAt) return { status: 'paused', reason: 'rate_limit_window_reset' }
  const floor = previous?.usedPercent ?? policy.baseline.usedPercent
  if (observation.usedPercent < floor) return { status: 'paused', reason: 'rate_limit_decreased' }
  if (observation.usedPercent >= policy.stopAtPercent) return { status: 'hard_stopped', reason: 'quota_hard_stop' }
  if (observation.usedPercent >= policy.pauseAtPercent) return { status: 'admission_stopped', reason: 'quota_admission_stop' }
  return { status: 'ready', reason: 'within_budget' }
}

export function createQuotaGuard(policy: BudgetPolicy, options: {
  statePath: string
  now?: () => number
  maxAgeMs?: number
  initialState?: GuardState
}) {
  assertBudgetPolicy(policy)
  const now = options.now ?? Date.now
  let state: GuardState = options.initialState?.campaignId === policy.campaignId ? structuredClone(options.initialState) : {
    version: 1, campaignId: policy.campaignId, status: 'paused', reason: 'rate_limit_unobserved',
    updatedAt: new Date(now()).toISOString(), accounting: { calls: 0, failedCalls: 0, uniqueResponses: 0,
      duplicateResponses: 0, responsesWithoutId: 0, knownInputTokens: 0, knownCachedInputTokens: 0,
      knownUncachedInputTokens: 0, knownOutputTokens: 0, knownReasoningTokens: 0 }
  }
  state.accounting = { ...{ calls: 0, failedCalls: 0, uniqueResponses: 0, duplicateResponses: 0, responsesWithoutId: 0,
    knownInputTokens: 0, knownCachedInputTokens: 0, knownUncachedInputTokens: 0, knownOutputTokens: 0,
    knownReasoningTokens: 0 }, ...state.accounting }
  const responseIds = new Set(state.seenResponseHashes ?? [])
  const save = async () => atomicJson(options.statePath, state)
  const setFailure = async (reason = 'rate_limit_read_failed') => {
    state = { ...state, ...(state.status === 'hard_stopped' ? {} : { status: 'paused' as const, reason }), updatedAt: new Date(now()).toISOString() }
    await save(); return structuredClone(state)
  }
  const observe = async (observation?: RateLimitObservation) => {
    const evaluated = evaluateQuota(policy, observation, state.observation, now(), options.maxAgeMs)
    const decision = state.status === 'hard_stopped'
      ? { status: 'hard_stopped' as const, reason: 'quota_hard_stop_latched' }
      : evaluated
    // Invalid/decreasing readings must never lower the persisted high-water mark.
    const acceptedObservation = evaluated.status !== 'paused' && observation
    state = { ...state, ...decision, updatedAt: new Date(now()).toISOString(), ...(acceptedObservation ? { observation } : {}) }
    await save(); return structuredClone(state)
  }
  const recordCall = async (usage: CallUsage) => {
    const accounting = { ...state.accounting, calls: state.accounting.calls + 1 }
    if (!usage.ok) accounting.failedCalls++
    if (!usage.responseId) accounting.responsesWithoutId++
    else {
      const responseHash = createHash('sha256').update(usage.responseId).digest('hex')
      if (responseIds.has(responseHash)) accounting.duplicateResponses++
      else {
        responseIds.add(responseHash); accounting.uniqueResponses++
        const inputTokens = safeTokenCount(usage.inputTokens), outputTokens = safeTokenCount(usage.outputTokens)
        const rawCached = safeTokenCount(usage.cachedInputTokens), rawReasoning = safeTokenCount(usage.reasoningTokens)
        const cachedInputTokens = rawCached <= inputTokens ? rawCached : 0
        const reasoningTokens = rawReasoning <= outputTokens ? rawReasoning : 0
        accounting.knownInputTokens += inputTokens
        accounting.knownCachedInputTokens += cachedInputTokens
        accounting.knownUncachedInputTokens += inputTokens - cachedInputTokens
        accounting.knownOutputTokens += outputTokens
        accounting.knownReasoningTokens += reasoningTokens
      }
    }
    state = { ...state, accounting, seenResponseHashes: [...responseIds], updatedAt: new Date(now()).toISOString() }
    await save(); return structuredClone(state)
  }
  return {
    policy,
    observe,
    setFailure,
    recordCall,
    latest: () => structuredClone(state),
    admission: () => {
      const current = state.status === 'ready' ? evaluateQuota(policy, state.observation, state.observation, now(), options.maxAgeMs) : state
      return { allowed: current.status === 'ready', status: current.status, reason: current.reason }
    },
  }
}

export async function readGuardState(path: string): Promise<GuardState | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as GuardState }
  catch (error: any) { if (error?.code === 'ENOENT') return undefined; throw Error('budget_state_unreadable') }
}
