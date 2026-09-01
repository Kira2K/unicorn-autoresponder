import { createHash } from 'node:crypto'
import { connectionMarketTier, connectionSearchTerms, type SearchAudience } from './catalog.ts'
import { connectionError } from './errors.ts'
import { requireConnectionRunDay } from './day-window.ts'
import { selectLocation } from './location-resolution.ts'
import { evaluateCandidate, parseConnectionCandidate,
  type CandidatePolicyEvaluation, type ParsedCandidate } from './policy.ts'
import { selectTemplates } from './run-model.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun, ConnectionSearchStreamState } from './types.ts'
import { connectionPageItems, parseConnectionPeopleSearchResponse } from './unipile-adapter.ts'
import { searchRequestDelay, waitWithRunTimer,
  withConnectionRetry } from './retry-state.ts'
import { CONNECTION_SEARCH_WINDOW_MS, connectionSearchSlot } from './search-limiter.ts'

const SEARCH_RESERVATION_MS = 30 * 60_000

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
  const accountAttempts = previousRuns.flatMap(item => item.searchProgress.recentSearchAt ?? [])
  run.searchProgress.recentSearchAt = [...new Set([
    ...accountAttempts, ...run.searchProgress.recentSearchAt
  ])].sort()
  const templates = selectTemplates(catalog, previousRuns, run)
  run.searchProgress.keyTotal = {
    recruiter: templates.recruiter.length, technical: templates.technical.length
  }
  const seenPeople = new Set([...run.seenPersonIds,
    ...run.searchProgress.pendingCandidates.map(item => item.personId)])
  async function waitForSearchSlot() {
    const now = runtime.now().getTime()
    const slot = connectionSearchSlot(run.searchProgress.recentSearchAt, now,
      searchRequestDelay(runtime.random))
    run.searchProgress.recentSearchAt = slot.recent
    const reservationAt = Date.parse(run.searchProgress.searchReservedUntil ?? '')
    const reservationDelay = Number.isFinite(reservationAt) ? Math.max(0, reservationAt - now) : 0
    const delayMs = Math.max(slot.delayMs, reservationDelay)
    if (delayMs <= 0) return true
    const proceed = await waitWithRunTimer(runtime, run, save,
      reservationDelay > slot.delayMs ? 'search_batch_cooldown' : slot.waitKind,
      'search_cooldown', delayMs, true)
    if (proceed && reservationDelay > 0) {
      run.searchProgress.searchReservedUntil = undefined
      await save(run, 'progress', 'critical')
    }
    return proceed
  }

  async function pacedRequest<T>(operation: string, action: () => Promise<T>) {
    return withConnectionRetry(runtime, run, save, 'unipile', operation, async () => {
      if (!await waitForSearchSlot()) {
        throw new Error('Connection search stopped before the next request slot.')
      }
      requireConnectionRunDay(runtime, run)
      // Persist a conservative reservation before dispatch. If the process dies during the
      // provider call, recovery waits instead of forgetting an in-flight request.
      do {
        run.searchProgress.searchReservedUntil = new Date(runtime.now().getTime() +
          SEARCH_RESERVATION_MS).toISOString()
        await save(run, 'progress', 'critical')
      } while (Date.parse(run.searchProgress.searchReservedUntil) - runtime.now().getTime() <
        CONNECTION_SEARCH_WINDOW_MS)
      requireConnectionRunDay(runtime, run)
      // Timestamp the actual dispatch after a potentially slow Noco checkpoint. The crash-only
      // reservation above covers a process loss until this timestamp is persisted with the
      // provider result (or in the error path below).
      const attemptedAt = runtime.now().toISOString()
      run.searchProgress.recentSearchAt.push(attemptedAt)
      run.searchProgress.recentSearchAt = run.searchProgress.recentSearchAt.slice(-100)
      let result: T
      try { result = await action() }
      catch (error) {
        // A provider response/error proves the request is no longer in flight. Retain the
        // persisted attempt timestamp, but remove the crash-only reservation before retry.
        run.searchProgress.searchReservedUntil = undefined
        await save(run, 'progress', 'critical')
        throw error
      }
      requireConnectionRunDay(runtime, run)
      return result
    })
  }

  async function resolveCity(city: string) {
    const cached = run.searchProgress.locations[city]
    if (cached) return cached
    run.stage = 'location_resolving'; run.searchProgress.city = city
    await save(run, 'stage_changed')
    runtime.logger.event('location_lookup', 'started', { runId: run.runId,
      platformAccountId: run.platformAccountId, city })
    const response = await pacedRequest('location_lookup', () =>
      runtime.adapter().resolveLocations(run.accountId, city))
    const resolved = selectLocation(city, connectionPageItems(response), runtime.now().toISOString())
    run.searchProgress.locations[city] = resolved
    run.searchProgress.searchReservedUntil = undefined
    await save(run, 'progress', 'critical')
    runtime.logger.event('location_lookup', resolved.status === 'resolved' ? 'succeeded' : 'failed', {
      runId: run.runId, platformAccountId: run.platformAccountId, city,
      locationId: resolved.id, errorCode: resolved.status === 'unresolved'
        ? 'connection_location_unresolved' : undefined })
    return resolved
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
          stream.locationId = undefined; stream.marketTier = connectionMarketTier(template.city)
          stream.termIndex = 0; stream.term = undefined; stream.emptyCursorStreak = 0
          stream.page = 0; stream.nextCursor = undefined
        }
        displayStream(run, audience, stream)
        if (!run.usedSearchKeys.includes(template.sourceKey)) run.usedSearchKeys.push(template.sourceKey)
        if (!run.searchProgress.passUsedSearchKeys.includes(template.sourceKey)) {
          run.searchProgress.passUsedSearchKeys.push(template.sourceKey)
        }
        const location = await resolveCity(template.city)
        if (location.status !== 'resolved' || !location.id) {
          increment(run, 'hard:location_unresolved')
          stream.keyIndex += 1; stream.sourceKey = undefined; stream.city = undefined
          stream.locationId = undefined; stream.marketTier = undefined
          stream.termIndex = 0; stream.term = undefined; stream.emptyCursorStreak = 0
          stream.page = 0; stream.nextCursor = undefined
          run.searchProgress.keyIndex[audience] = stream.keyIndex
          await save(run, 'progress', 'critical')
          continue
        }
        stream.locationId = location.id; displayStream(run, audience, stream)

        const terms = connectionSearchTerms(template, run.stack, run.safeRecruiterOnly)
        const termIndex = stream.termIndex ?? 0
        const keywords = terms[termIndex]
        if (!keywords) {
          stream.keyIndex += 1; stream.sourceKey = undefined; stream.city = undefined
          stream.locationId = undefined; stream.marketTier = undefined
          stream.termIndex = 0; stream.term = undefined; stream.emptyCursorStreak = 0
          stream.page = 0; stream.nextCursor = undefined
          run.searchProgress.keyIndex[audience] = stream.keyIndex
          await save(run, 'progress', 'critical')
          continue
        }
        stream.term = keywords
        const page = stream.page + 1
        const log = { runId: run.runId, platformAccountId: run.platformAccountId,
          audience, searchKey: template.sourceKey, city: template.city, page,
          marketTier: stream.marketTier, term: keywords, locationId: location.id,
          locationLabel: location.label }
        runtime.logger.event('candidate_search', 'started', log)
        let response
        try {
          response = await pacedRequest('people_search', () => runtime.adapter()
            .searchPeople(run.accountId, { keywords, locationId: location.id! }, stream.nextCursor))
        } catch (error: any) {
          runtime.logger.event('candidate_search', 'failed', { ...log,
            errorCode: String(error?.code ?? 'connection_inviter_internal_error'),
            errorName: String(error?.name ?? 'Error'),
            causeCode: String(error?.cause?.code ?? 'unknown'),
            hasResponse: Boolean(error?.response ?? error?.cause?.response),
            httpStatus: Number(error?.details?.httpStatus ?? error?.response?.status) || undefined })
          throw error
        }
        run.counters.searched += 1; stream.page = page
        const parsed = parseConnectionPeopleSearchResponse(response)
        const items = parsed.items; run.searchProgress.found += items.length
        const nextCursor = parsed.nextCursor
        stream.emptyCursorStreak = items.length === 0 && nextCursor
          ? (stream.emptyCursorStreak ?? 0) + 1 : 0
        if (audience === 'recruiter' && stream.marketTier === 'primary' && page === 1) {
          if (items.length > 0) run.searchProgress.consecutiveEmptyRecruiterSearches = 0
          else run.searchProgress.consecutiveEmptyRecruiterSearches += 1
        }
        const result = await evaluatePage(audience, template.sourceKey, template, items)
        stream.nextCursor = nextCursor || undefined; displayStream(run, audience, stream)
        const emptyCursorLimit = (stream.emptyCursorStreak ?? 0) >= 2
        const termFinished = !nextCursor || emptyCursorLimit
        const termFinishReason = emptyCursorLimit ? 'empty_cursor_limit' :
          (!nextCursor ? 'cursor_exhausted' : undefined)
        runtime.logger.event('candidate_search', 'succeeded', { ...log,
          candidateCount: items.length, eligibleCount: result.candidates.length,
          skippedCount: result.skipped, cursorPresent: Boolean(nextCursor),
          responseShape: parsed.responseShape,
          consecutiveEmptyCount: run.searchProgress.consecutiveEmptyRecruiterSearches,
          emptyCursorStreak: stream.emptyCursorStreak, termFinishReason })
        if (termFinished) {
          stream.termIndex = termIndex + 1; stream.term = undefined
          stream.emptyCursorStreak = 0; stream.page = 0; stream.nextCursor = undefined
          if (stream.termIndex >= terms.length) {
            stream.keyIndex += 1; stream.sourceKey = undefined; stream.city = undefined
            stream.locationId = undefined; stream.marketTier = undefined; stream.termIndex = 0
            run.searchProgress.keyIndex[audience] = stream.keyIndex
            if (stream.keyIndex >= templates[audience].length) {
              run.searchProgress.exhausted[audience] = true
            }
          }
        }
        // Cursor and empty-page state are the exact safe resume position after a restart.
        run.searchProgress.searchReservedUntil = undefined
        // A normal empty first/final page is read-only and may be checkpointed. Before the next
        // provider call its advanced term/key position is included in the mandatory reservation
        // save; if the process dies sooner, recovery can only repeat this harmless empty read.
        const persistence = items.length === 0 && !nextCursor ? 'checkpoint' : 'critical'
        await save(run, 'progress', persistence)
        if (audience === 'recruiter' &&
          run.searchProgress.consecutiveEmptyRecruiterSearches >= 20) {
          throw connectionError('connection_search_contract_suspect',
            'Twenty consecutive recruiter searches returned no candidates.')
        }
        if (result.candidates.length) return result.candidates
      }
      return []
    }
  }
}
