import { createHash } from 'node:crypto'
import { renderSearchKeywords, type SearchAudience } from './catalog.ts'
import { evaluateCandidate, parseConnectionCandidate,
  type CandidatePolicyEvaluation, type ParsedCandidate } from './policy.ts'
import { selectTemplates } from './run-model.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun, ConnectionSearchStreamState } from './types.ts'
import { connectionNextCursor, connectionPageItems } from './unipile-adapter.ts'
import { searchRequestDelay, waitWithRunTimer,
  withConnectionRetry } from './retry-state.ts'

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

function displayStream(run: ConnectionRun, audience: SearchAudience,
  stream: ConnectionSearchStreamState) {
  run.searchProgress.audience = audience; run.searchProgress.nextAudience = audience
  run.searchProgress.keyIndex[audience] = stream.keyIndex
  run.searchProgress.sourceKey = stream.sourceKey; run.searchProgress.city = stream.city
  run.searchProgress.page = stream.page; run.searchProgress.nextCursor = stream.nextCursor
}

export async function createCandidateDiscovery(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun) {
  const catalog = await withConnectionRetry(runtime, run, save, 'noco', 'catalog_read', () =>
    runtime.store.listCatalog())
  const previousRuns = await withConnectionRetry(runtime, run, save, 'noco', 'runs_read', () =>
    runtime.store.listRunsForAccount(run.platformAccountId, 1000))
  const templates = selectTemplates(catalog, previousRuns, run)
  run.searchProgress.keyTotal = {
    recruiter: templates.recruiter.length, technical: templates.technical.length
  }
  const seenPeople = new Set([...run.seenPersonIds,
    ...run.searchProgress.pendingCandidates.map(item => item.personId)])
  async function waitForSearchSlot() {
    const now = runtime.now().getTime()
    const recent = run.searchProgress.recentSearchAt.map(value => Date.parse(value))
      .filter(value => Number.isFinite(value) && value > now - 10 * 60_000)
      .sort((left, right) => left - right)
    run.searchProgress.recentSearchAt = recent.map(value => new Date(value).toISOString())
    const last = recent.at(-1)
    const gapDelay = last === undefined ? 0 : Math.max(0,
      last + searchRequestDelay(runtime.random) - now)
    const windowDelay = recent.length < 5 ? 0 : Math.max(0, recent[recent.length - 5] + 600_000 - now)
    const delayMs = Math.max(gapDelay, windowDelay)
    if (delayMs <= 0) return true
    return waitWithRunTimer(runtime, run, save,
      windowDelay > gapDelay ? 'search_batch_cooldown' : 'search_pacing',
      'search_cooldown', delayMs)
  }

  async function evaluatePage(audience: SearchAudience, searchKey: string, template: any,
    rawItems: any[]) {
    const evaluated: Array<{ candidate: ParsedCandidate; evaluation: CandidatePolicyEvaluation }> = []
    let skipped = 0
    for (const raw of rawItems) {
      const candidate = parseConnectionCandidate(raw)
      const evaluation = evaluateCandidate(candidate, template, run.stack, run.safeRecruiterOnly)
      const funnel = run.counters.filterFunnel[audience]
      run.counters.discovered += 1; run.searchProgress.checked += 1; funnel.found += 1
      const structurallyValid = !evaluation.hardReasons.some(reason =>
        ['missing_person_id', 'incomplete_profile'].includes(reason))
      if (structurallyValid) funnel.structurallyValid += 1
      if (structurallyValid && !evaluation.hardReasons.includes('role_mismatch')) funnel.roleMatched += 1
      recordSignals(run, audience, evaluation)
      logEvaluation(runtime, run, audience, searchKey, candidate, evaluation)

      if (candidate.personId && seenPeople.has(candidate.personId)) {
        recordSkip(runtime, run, audience, ['duplicate_in_run'],
          safeCandidateHash(run.runId, candidate.personId)); skipped += 1; continue
      }
      if (candidate.personId) {
        seenPeople.add(candidate.personId); run.seenPersonIds.push(candidate.personId)
      }
      if (!evaluation.eligible) {
        recordSkip(runtime, run, audience, evaluation.hardReasons,
          candidate.personId ? safeCandidateHash(run.runId, candidate.personId) : undefined)
        skipped += 1; continue
      }
      evaluated.push({ candidate, evaluation })
    }

    const existingRows = evaluated.length
      ? await withConnectionRetry(runtime, run, save, 'noco', 'history_batch_read', () =>
        runtime.store.findHistoryBatch(run.accountId, evaluated.map(item => item.candidate.personId)))
      : []
    const existingByPerson = new Map(existingRows.map(item => [item.personId, item]))
    const candidates: ConnectionHistoryItem[] = []
    for (const { candidate } of evaluated) {
      const existing = existingByPerson.get(candidate.personId)
      if (existing && PERMANENT_HISTORY.has(existing.status)) {
        recordSkip(runtime, run, audience, ['lifetime_history_block'],
          safeCandidateHash(run.runId, candidate.personId)); skipped += 1; continue
      }
      const proposed = proposedHistory(runtime, run, audience, searchKey, candidate, existing)
      candidates.push(proposed); run.searchProgress.pendingCandidates.push(proposed)
      run.counters.eligible += 1; run.searchProgress.eligible += 1
      run.counters.filterFunnel[audience].historyClear += 1
    }
    return { candidates, skipped }
  }

  return {
    async next(audience: SearchAudience): Promise<ConnectionHistoryItem[]> {
      while (!run.searchProgress.exhausted[audience]) {
        if (runtime.stopRequested(run.runId)) return []
        const stream = run.searchProgress.streams[audience]
        const template = templates[audience][stream.keyIndex]
        if (!template) {
          run.searchProgress.exhausted[audience] = true; displayStream(run, audience, stream)
          return []
        }
        if (stream.sourceKey !== template.sourceKey) {
          stream.sourceKey = template.sourceKey; stream.city = template.city
          stream.page = 0; stream.nextCursor = undefined
        }
        displayStream(run, audience, stream)
        if (!run.usedSearchKeys.includes(template.sourceKey)) run.usedSearchKeys.push(template.sourceKey)
        if (!await waitForSearchSlot()) return []

        const page = stream.page + 1
        const log = { runId: run.runId, platformAccountId: run.platformAccountId,
          audience, searchKey: template.sourceKey, city: template.city, page }
        runtime.logger.event('candidate_search', 'started', log)
        const keywords = renderSearchKeywords(template, run.stack, run.safeRecruiterOnly)
        const response = await withConnectionRetry(runtime, run, save, 'unipile', 'people_search', () =>
          runtime.adapter().searchPeople(run.accountId, keywords, stream.nextCursor))
        run.counters.searched += 1; stream.page = page
        run.searchProgress.recentSearchAt.push(runtime.now().toISOString())
        const items = connectionPageItems(response); run.searchProgress.found += items.length
        const result = await evaluatePage(audience, template.sourceKey, template, items)
        const nextCursor = connectionNextCursor(response)
        stream.nextCursor = nextCursor || undefined; displayStream(run, audience, stream)
        runtime.logger.event('candidate_search', 'succeeded', { ...log, keywords,
          candidateCount: items.length, eligibleCount: result.candidates.length,
          skippedCount: result.skipped, cursorPresent: Boolean(nextCursor) })
        await save(run, 'progress')

        if (!nextCursor) {
          stream.keyIndex += 1; stream.sourceKey = undefined; stream.city = undefined
          stream.page = 0; stream.nextCursor = undefined
          run.searchProgress.keyIndex[audience] = stream.keyIndex
          if (stream.keyIndex >= templates[audience].length) {
            run.searchProgress.exhausted[audience] = true
          }
        }
        if (result.candidates.length) return result.candidates
      }
      return []
    }
  }
}
