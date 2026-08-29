import { randomUUID } from 'node:crypto'
import type { ConnectionSearchTemplate, SearchAudience } from './catalog.ts'
import { dateParts } from './limits.ts'
import type { ConnectionAccountContext, ConnectionHistoryItem, ConnectionRun } from './types.ts'

export function publicRun(run: ConnectionRun) {
  const { recordId: _recordId, accountId: _accountId, ...safe } = run
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
      sentByAudience: { recruiter: 0, technical: 0 } },
    usedSearchKeys: [], seenPersonIds: [], skipReasonCounters: {},
    searchProgress: {
      keyIndex: { recruiter: 0, technical: 0 }, keyTotal: { recruiter: 0, technical: 0 },
      page: 0, found: 0, checked: 0, eligible: 0, skipped: 0,
      exhausted: { recruiter: false, technical: safeRecruiterOnly }, pass: 1,
      pendingCandidates: []
    },
    createdAt: timestamp, updatedAt: timestamp
  }
}

export function selectTemplates(catalog: ConnectionSearchTemplate[], runs: ConnectionRun[],
  run: ConnectionRun): Record<SearchAudience, ConnectionSearchTemplate[]> {
  const used = new Set(runs.filter(item => item.platformAccountId === run.platformAccountId)
    .flatMap(item => item.usedSearchKeys))
  const result = { recruiter: [] as ConnectionSearchTemplate[], technical: [] as ConnectionSearchTemplate[] }
  for (const audience of ['recruiter', 'technical'] as const) {
    if (run.safeRecruiterOnly && audience === 'technical') continue
    const matches = catalog.filter(item => item.enabled && item.audience === audience)
    const randomOrder = (items: ConnectionSearchTemplate[], bucket: string) => [...items]
      .sort((a, b) => templateRank(`${run.runId}:${bucket}`, a.sourceKey) -
        templateRank(`${run.runId}:${bucket}`, b.sourceKey) || a.sourceKey.localeCompare(b.sourceKey))
    result[audience] = [...randomOrder(matches.filter(item => !used.has(item.sourceKey)), 'new'),
      ...randomOrder(matches.filter(item => used.has(item.sourceKey)), 'used')]
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
