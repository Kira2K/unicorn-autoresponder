import { renderSearchKeywords, type SearchAudience } from './catalog.ts'
import { evaluateCandidate, parseConnectionCandidate } from './policy.ts'
import { selectTemplates } from './run-model.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { connectionNextCursor, connectionPageItems } from './unipile-adapter.ts'
import { searchBatchDelay, searchRequestDelay, waitWithRunTimer,
  withConnectionRetry } from './retry-state.ts'

const AUDIENCES: SearchAudience[] = ['recruiter', 'technical']
const PERMANENT_HISTORY = new Set(['sending', 'sent', 'pending', 'accepted', 'uncertain'])

function countSkip(runtime: ConnectionRuntime, run: ConnectionRun, audience: SearchAudience,
  reasonCode: string) {
  run.counters.skipped += 1; run.searchProgress.skipped += 1
  run.skipReasonCounters[reasonCode] = (run.skipReasonCounters[reasonCode] ?? 0) + 1
  runtime.logger.event('candidate_skip', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, audience, reasonCode })
}

function proposedHistory(runtime: ConnectionRuntime, run: ConnectionRun, audience: SearchAudience,
  searchKey: string, candidate: ReturnType<typeof parseConnectionCandidate>): ConnectionHistoryItem {
  const timestamp = runtime.now().toISOString()
  return {
    historyKey: `${run.accountId}:${candidate.personId}`, runId: run.runId,
    platformAccountId: run.platformAccountId, accountId: run.accountId,
    personId: candidate.personId, audience, searchKey, name: candidate.name,
    headline: candidate.headline, location: candidate.location,
    ...(candidate.profileUrl ? { profileUrl: candidate.profileUrl } : {}),
    status: 'eligible', reasonCode: 'candidate_eligible', discoveredAt: timestamp, updatedAt: timestamp
  }
}

export async function discoverCandidates(runtime: ConnectionRuntime, run: ConnectionRun,
  quota: Record<SearchAudience, number>, save: SaveRun) {
  const catalog = await withConnectionRetry(runtime, run, save, 'noco', 'catalog_read', () =>
    runtime.store.listCatalog())
  const previousRuns = await withConnectionRetry(runtime, run, save, 'noco', 'runs_read', () =>
    runtime.store.listRuns(1000))
  const templates = selectTemplates(catalog, previousRuns, run)
  run.searchProgress.keyTotal = {
    recruiter: templates.recruiter.length, technical: templates.technical.length
  }
  const queues: Record<SearchAudience, ConnectionHistoryItem[]> = { recruiter: [], technical: [] }
  const queuedPeople = new Set(run.seenPersonIds)
  const targets = { recruiter: Math.max(0, quota.recruiter * 2),
    technical: Math.max(0, quota.technical * 2) }
  let requestCount = 0

  while (true) {
    if (runtime.stopRequested(run.runId)) return queues
    const needs = AUDIENCES.filter(audience => targets[audience] > queues[audience].length &&
      !run.searchProgress.exhausted[audience])
    if (!needs.length) break
    needs.sort((a, b) => queues[a].length / Math.max(1, targets[a]) -
      queues[b].length / Math.max(1, targets[b]))
    const audience = needs[0]
    let keyIndex = run.searchProgress.keyIndex[audience]
    const template = templates[audience][keyIndex]
    if (!template) {
      run.searchProgress.exhausted[audience] = true
      continue
    }
    const continuing = run.searchProgress.audience === audience &&
      run.searchProgress.sourceKey === template.sourceKey
    let page = continuing ? run.searchProgress.page : 0
    let cursor = continuing ? run.searchProgress.nextCursor ?? '' : ''
    run.searchProgress.audience = audience; run.searchProgress.sourceKey = template.sourceKey
    run.searchProgress.city = template.city
    if (!run.usedSearchKeys.includes(template.sourceKey)) run.usedSearchKeys.push(template.sourceKey)

    for (; page < 3; page += 1) {
      if (runtime.stopRequested(run.runId)) return queues
      if (requestCount > 0) {
        const proceed = await waitWithRunTimer(runtime, run, save, 'search_pacing',
          'search_cooldown', searchRequestDelay(runtime.random))
        if (!proceed) return queues
      }
      const log = { runId: run.runId, platformAccountId: run.platformAccountId,
        audience, searchKey: template.sourceKey, page: page + 1 }
      runtime.logger.event('candidate_search', 'started', log)
      const response = await withConnectionRetry(runtime, run, save, 'unipile', 'people_search', () =>
        runtime.adapter().searchPeople(run.accountId,
          renderSearchKeywords(template, run.stack, run.safeRecruiterOnly), cursor || undefined))
      requestCount += 1; run.counters.searched += 1; run.searchProgress.page = page + 1
      const items = connectionPageItems(response)
      run.searchProgress.found += items.length
      let pageEligible = 0; let pageSkipped = 0
      for (const raw of items) {
        const candidate = parseConnectionCandidate(raw)
        run.counters.discovered += 1; run.searchProgress.checked += 1
        if (!candidate.personId) {
          countSkip(runtime, run, audience, 'missing_person_id'); pageSkipped += 1; continue
        }
        if (queuedPeople.has(candidate.personId)) {
          countSkip(runtime, run, audience, 'duplicate_in_run'); pageSkipped += 1; continue
        }
        const decision = evaluateCandidate(candidate, template, run.stack, run.safeRecruiterOnly)
        if (!decision.eligible) {
          countSkip(runtime, run, audience, decision.reasonCode); pageSkipped += 1; continue
        }
        const existing = await withConnectionRetry(runtime, run, save, 'noco', 'history_read', () =>
          runtime.store.findHistory(run.accountId, candidate.personId))
        if (existing && PERMANENT_HISTORY.has(existing.status)) {
          countSkip(runtime, run, audience, 'lifetime_history_block'); pageSkipped += 1; continue
        }
        const proposed = proposedHistory(runtime, run, audience, template.sourceKey, candidate)
        queues[audience].push(proposed); run.searchProgress.pendingCandidates.push(proposed)
        queuedPeople.add(candidate.personId); run.seenPersonIds.push(candidate.personId)
        run.counters.eligible += 1; run.searchProgress.eligible += 1; pageEligible += 1
      }
      cursor = connectionNextCursor(response); run.searchProgress.nextCursor = cursor || undefined
      runtime.logger.event('candidate_search', 'succeeded', { ...log,
        candidateCount: items.length, eligibleCount: pageEligible, skippedCount: pageSkipped,
        cursorPresent: Boolean(cursor) })
      runtime.emit(run, 'progress')
      if (!cursor || queues[audience].length >= targets[audience]) break
    }

    const keyFinished = !cursor || page >= 2
    if (keyFinished) {
      keyIndex += 1; run.searchProgress.keyIndex[audience] = keyIndex
      run.searchProgress.page = 0; run.searchProgress.nextCursor = undefined
      run.searchProgress.sourceKey = undefined; run.searchProgress.city = undefined
      if (keyIndex >= templates[audience].length) run.searchProgress.exhausted[audience] = true
      if ((run.searchProgress.keyIndex.recruiter + run.searchProgress.keyIndex.technical) % 5 === 0) {
        const proceed = await waitWithRunTimer(runtime, run, save, 'search_batch_cooldown',
          'search_cooldown', searchBatchDelay(runtime.random), true)
        if (!proceed) return queues
      }
    }
    if (queues[audience].length >= targets[audience]) break
  }
  await save(run, 'progress')
  return queues
}
