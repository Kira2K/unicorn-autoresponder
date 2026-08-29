import { createHash } from 'node:crypto'
import { renderSearchKeywords, type SearchAudience } from './catalog.ts'
import { evaluateCandidate, parseConnectionCandidate,
  type CandidatePolicyEvaluation, type ParsedCandidate } from './policy.ts'
import { selectTemplates } from './run-model.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { connectionNextCursor, connectionPageItems } from './unipile-adapter.ts'
import { searchBatchDelay, searchRequestDelay, waitWithRunTimer,
  withConnectionRetry } from './retry-state.ts'

const AUDIENCES: SearchAudience[] = ['recruiter', 'technical']
const PERMANENT_HISTORY = new Set(['sending', 'sent', 'pending', 'accepted', 'uncertain'])

function increment(run: ConnectionRun, key: string) {
  run.skipReasonCounters[key] = (run.skipReasonCounters[key] ?? 0) + 1
}

function recordSignals(run: ConnectionRun, audience: SearchAudience,
  evaluation: CandidatePolicyEvaluation) {
  for (const signal of evaluation.softSignals) {
    increment(run, `soft:${signal}`); increment(run, `audience:${audience}:soft:${signal}`)
  }
  for (const hard of evaluation.hardReasons) {
    for (const soft of evaluation.softSignals) {
      increment(run, `intersection:${hard}+${soft}`)
      increment(run, `audience:${audience}:intersection:${hard}+${soft}`)
    }
  }
}

function recordSkip(runtime: ConnectionRuntime, run: ConnectionRun, audience: SearchAudience,
  reasonCodes: string[], candidateHash?: string) {
  const uniqueReasons = [...new Set(reasonCodes)]
  run.counters.skipped += 1; run.searchProgress.skipped += 1
  for (const reason of uniqueReasons) {
    increment(run, `hard:${reason}`); increment(run, `audience:${audience}:hard:${reason}`)
  }
  runtime.logger.event('candidate_skip', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, audience, reasonCode: uniqueReasons[0],
    hardReasonCodes: uniqueReasons.join('|'), candidateHash })
}

function safeCandidateHash(runId: string, personId: string) {
  return createHash('sha256').update(`${runId}:${personId}`).digest('hex').slice(0, 16)
}

function logEvaluation(runtime: ConnectionRuntime, run: ConnectionRun, audience: SearchAudience,
  searchKey: string, candidate: ParsedCandidate, evaluation: CandidatePolicyEvaluation) {
  runtime.logger.event('candidate_policy', 'succeeded', {
    runId: run.runId, platformAccountId: run.platformAccountId, audience, searchKey,
    candidateHash: candidate.personId ? safeCandidateHash(run.runId, candidate.personId) : 'missing',
    roleCategory: evaluation.roleCategory, locationMatch: evaluation.evidence.locationMatch,
    stackEvidence: evaluation.evidence.stackEvidence,
    hardReasonCodes: evaluation.hardReasons.join('|') || 'none',
    softSignalCodes: evaluation.softSignals.join('|') || 'none'
  })
}

function proposedHistory(runtime: ConnectionRuntime, run: ConnectionRun, audience: SearchAudience,
  searchKey: string, candidate: ParsedCandidate, existing?: ConnectionHistoryItem): ConnectionHistoryItem {
  const timestamp = runtime.now().toISOString()
  return {
    historyKey: `${run.accountId}:${candidate.personId}`, runId: run.runId,
    platformAccountId: run.platformAccountId, accountId: run.accountId,
    personId: candidate.personId, audience, searchKey, name: candidate.name,
    headline: candidate.headline, location: candidate.location,
    ...(candidate.profileUrl ? { profileUrl: candidate.profileUrl } : {}),
    status: 'eligible', reasonCode: 'candidate_eligible',
    discoveredAt: existing?.discoveredAt ?? timestamp, updatedAt: timestamp,
    ...(existing?.recordId ? { recordId: existing.recordId } : {})
  }
}

export async function discoverCandidates(runtime: ConnectionRuntime, run: ConnectionRun,
  quota: Record<SearchAudience, number>, save: SaveRun) {
  const catalog = await withConnectionRetry(runtime, run, save, 'noco', 'catalog_read', () =>
    runtime.store.listCatalog())
  const previousRuns = await withConnectionRetry(runtime, run, save, 'noco', 'runs_read', () =>
    runtime.store.listRunsForAccount(run.platformAccountId, 1000))
  const templates = selectTemplates(catalog, previousRuns, run)
  run.searchProgress.keyTotal = {
    recruiter: templates.recruiter.length, technical: templates.technical.length
  }
  const queues: Record<SearchAudience, ConnectionHistoryItem[]> = { recruiter: [], technical: [] }
  const seenPeople = new Set(run.seenPersonIds)
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
    if (!template) { run.searchProgress.exhausted[audience] = true; continue }
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
      const evaluated: Array<{ candidate: ParsedCandidate; evaluation: CandidatePolicyEvaluation }> = []

      for (const raw of items) {
        const candidate = parseConnectionCandidate(raw)
        const evaluation = evaluateCandidate(candidate, template, run.stack, run.safeRecruiterOnly)
        const funnel = run.counters.filterFunnel[audience]
        run.counters.discovered += 1; run.searchProgress.checked += 1; funnel.found += 1
        const structurallyValid = !evaluation.hardReasons.some(reason =>
          ['missing_person_id', 'incomplete_profile'].includes(reason))
        if (structurallyValid) funnel.structurallyValid += 1
        if (structurallyValid && !evaluation.hardReasons.includes('role_mismatch')) funnel.roleMatched += 1
        recordSignals(run, audience, evaluation)
        logEvaluation(runtime, run, audience, template.sourceKey, candidate, evaluation)

        if (candidate.personId && seenPeople.has(candidate.personId)) {
          recordSkip(runtime, run, audience, ['duplicate_in_run'],
            safeCandidateHash(run.runId, candidate.personId)); pageSkipped += 1; continue
        }
        if (candidate.personId) {
          seenPeople.add(candidate.personId); run.seenPersonIds.push(candidate.personId)
        }
        if (!evaluation.eligible) {
          recordSkip(runtime, run, audience, evaluation.hardReasons,
            candidate.personId ? safeCandidateHash(run.runId, candidate.personId) : undefined)
          pageSkipped += 1; continue
        }
        evaluated.push({ candidate, evaluation })
      }

      const existingRows = evaluated.length
        ? await withConnectionRetry(runtime, run, save, 'noco', 'history_batch_read', () =>
          runtime.store.findHistoryBatch(run.accountId, evaluated.map(item => item.candidate.personId)))
        : []
      const existingByPerson = new Map(existingRows.map(item => [item.personId, item]))
      for (const { candidate } of evaluated) {
        const existing = existingByPerson.get(candidate.personId)
        if (existing && PERMANENT_HISTORY.has(existing.status)) {
          recordSkip(runtime, run, audience, ['lifetime_history_block'],
            safeCandidateHash(run.runId, candidate.personId)); pageSkipped += 1; continue
        }
        const proposed = proposedHistory(runtime, run, audience, template.sourceKey, candidate, existing)
        queues[audience].push(proposed); run.searchProgress.pendingCandidates.push(proposed)
        run.counters.eligible += 1; run.searchProgress.eligible += 1
        run.counters.filterFunnel[audience].historyClear += 1; pageEligible += 1
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
          'search_cooldown', searchBatchDelay(runtime.random))
        if (!proceed) return queues
      }
    }
    if (queues[audience].length >= targets[audience]) break
  }
  await save(run, 'progress')
  return queues
}
