import { randomUUID } from 'node:crypto'
import { connectionMarketTier, type ConnectionSearchTemplate,
  type SearchAudience } from './catalog.ts'
import { dateParts } from './limits.ts'
import type { ConnectionAccountContext, ConnectionHistoryItem, ConnectionRun } from './types.ts'

export function publicRun(run: ConnectionRun) {
  const { searchProgress } = run
  const { pendingCandidates } = searchProgress
  const queuedByAudience = pendingCandidates.reduce((counts, item) => {
    if (item.audience === 'recruiter' || item.audience === 'technical') {
      counts[item.audience] += 1
    }
    return counts
  }, { recruiter: 0, technical: 0 })
  const currentAudience = searchProgress.audience ?? searchProgress.nextAudience
  const currentStream = currentAudience ? searchProgress.streams[currentAudience] : undefined
  const safeProgress = {
    audience: currentAudience, nextAudience: searchProgress.nextAudience,
    keyIndex: searchProgress.keyIndex, keyTotal: searchProgress.keyTotal,
    city: currentStream?.city ?? searchProgress.city,
    marketTier: currentStream?.marketTier, term: currentStream?.term,
    page: currentStream?.page ?? searchProgress.page,
    cursorPresent: Boolean(currentStream?.nextCursor ?? searchProgress.nextCursor),
    found: searchProgress.found, checked: searchProgress.checked,
    eligible: searchProgress.eligible, skipped: searchProgress.skipped,
    consecutiveEmptyRecruiterSearches: searchProgress.consecutiveEmptyRecruiterSearches,
    exhausted: searchProgress.exhausted, pass: searchProgress.pass,
    queuedCandidateCount: pendingCandidates.length, queuedByAudience
  }
  const safe = {
    runId: run.runId, platformAccountId: run.platformAccountId,
    clientId: run.clientId, clientName: run.clientName,
    stackId: run.stackId, stack: run.stack, safeRecruiterOnly: run.safeRecruiterOnly,
    localDate: run.localDate, weekKey: run.weekKey, status: run.status, stage: run.stage,
    connectionCount: run.connectionCount, dailyLimit: run.dailyLimit, dailyQuota: run.dailyQuota,
    audienceQuota: run.audienceQuota, counters: run.counters,
    searchProgress: safeProgress, skipReasonCounters: run.skipReasonCounters,
    retryState: run.retryState, timerState: run.timerState,
    nextActionAt: run.nextActionAt, pausedAt: run.pausedAt, errorCode: run.errorCode,
    createdAt: run.createdAt, updatedAt: run.updatedAt, finishedAt: run.finishedAt
  }
  return structuredClone(safe)
}

export function publicHistory(item: ConnectionHistoryItem) {
  const { recordId: _recordId, accountId: _accountId, ...safe } = item
  return structuredClone(safe)
}

export function makeRun(context: ConnectionAccountContext, now: Date, timeZone: string,
  safeRecruiterOnly: boolean): ConnectionRun {
  const date = dateParts(now, timeZone); const timestamp = now.toISOString()
  return {
    runId: randomUUID(), runKey: `${context.platformAccountId}:${date.localDate}`,
    platformAccountId: context.platformAccountId, clientId: context.clientId,
    clientName: context.clientName, accountId: context.accountId,
    ...(context.stackId ? { stackId: context.stackId } : {}),
    ...(context.stack ? { stack: context.stack } : {}), safeRecruiterOnly,
    localDate: date.localDate, weekKey: date.weekKey,
    status: context.stack || safeRecruiterOnly ? 'running' : 'paused',
    stage: context.stack || safeRecruiterOnly ? 'queued' : 'stack_required',
    audienceQuota: { recruiter: 0, technical: 0 },
    counters: { searched: 0, discovered: 0, eligible: 0, sent: 0, skipped: 0,
      sentByAudience: { recruiter: 0, technical: 0 },
      shortfallByAudience: { recruiter: 0, technical: 0 },
      filterFunnel: {
        recruiter: { found: 0, structurallyValid: 0, roleMatched: 0, historyClear: 0,
          preflightPassed: 0, claimed: 0, sent: 0 },
        technical: { found: 0, structurallyValid: 0, roleMatched: 0, historyClear: 0,
          preflightPassed: 0, claimed: 0, sent: 0 }
      } },
    usedSearchKeys: [], seenPersonIds: [], skipReasonCounters: {},
    searchProgress: {
      keyIndex: { recruiter: 0, technical: 0 }, keyTotal: { recruiter: 0, technical: 0 },
      streams: {
        recruiter: { keyIndex: 0, page: 0 }, technical: { keyIndex: 0, page: 0 }
      },
      recentSearchAt: [], locations: {},
      page: 0, found: 0, checked: 0, eligible: 0, skipped: 0,
      consecutiveEmptyRecruiterSearches: 0,
      exhausted: { recruiter: false, technical: safeRecruiterOnly }, pass: 1,
      passUsedSearchKeys: [],
      pendingCandidates: []
    },
    createdAt: timestamp, updatedAt: timestamp
  }
}

export function selectTemplates(catalog: ConnectionSearchTemplate[], runs: ConnectionRun[],
  run: ConnectionRun): Record<SearchAudience, ConnectionSearchTemplate[]> {
  const currentPass = new Set(run.searchProgress?.passUsedSearchKeys ?? [])
  const used = new Set([
    ...runs.filter(item => item.platformAccountId === run.platformAccountId &&
      item.runId !== run.runId).flatMap(item => item.usedSearchKeys),
    ...(run.usedSearchKeys ?? []).filter(sourceKey => !currentPass.has(sourceKey))
  ])
  const result = { recruiter: [] as ConnectionSearchTemplate[], technical: [] as ConnectionSearchTemplate[] }
  for (const audience of ['recruiter', 'technical'] as const) {
    if (run.safeRecruiterOnly && audience === 'technical') continue
    const matches = catalog.filter(item => item.enabled && item.audience === audience)
    const randomOrder = (items: ConnectionSearchTemplate[], bucket: string) => [...items]
      .sort((a, b) => templateRank(`${run.runId}:${bucket}`, a.sourceKey) -
        templateRank(`${run.runId}:${bucket}`, b.sourceKey) || a.sourceKey.localeCompare(b.sourceKey))
    result[audience] = (['primary', 'reserve'] as const).flatMap(tier => {
      const tierItems = matches.filter(item => connectionMarketTier(item.city) === tier)
      return [...randomOrder(tierItems.filter(item => !used.has(item.sourceKey)), `${tier}:new`),
        ...randomOrder(tierItems.filter(item => used.has(item.sourceKey)), `${tier}:used`)]
    })
    const activeSourceKey = run.searchProgress?.streams?.[audience]?.sourceKey
    const activeIndex = run.searchProgress?.streams?.[audience]?.keyIndex ?? 0
    const currentIndex = result[audience].findIndex(item => item.sourceKey === activeSourceKey)
    if (currentIndex >= 0 && currentIndex !== activeIndex) {
      const [activeTemplate] = result[audience].splice(currentIndex, 1)
      result[audience].splice(Math.min(activeIndex, result[audience].length), 0, activeTemplate)
    }
  }
  return result
}

function templateRank(seed: string, value: string): number {
  let hash = 2166136261
  for (const character of `${seed}:${value}`) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const sendDelay = (random: () => number) =>
  15_000 + Math.floor(Math.min(1, Math.max(0, random())) * 165_000)

export const isUnknownWrite = (error: any) =>
  ['unipile_timeout', 'unipile_unreachable'].includes(String(error?.code ?? ''))
