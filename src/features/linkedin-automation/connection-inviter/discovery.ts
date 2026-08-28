import { CONNECTION_SEARCH_CATALOG, renderSearchKeywords, type SearchAudience } from './catalog.ts'
import { evaluateCandidate, parseConnectionCandidate } from './policy.ts'
import { selectTemplates } from './run-model.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { connectionNextCursor, connectionPageItems } from './unipile-adapter.ts'
import { claimRunCandidate } from './history-claim.ts'

export async function discoverCandidates(runtime: ConnectionRuntime, run: ConnectionRun,
  quota: Record<SearchAudience, number>, save: SaveRun) {
  const catalog = (await runtime.store.listCatalog?.()) ?? CONNECTION_SEARCH_CATALOG
  const templates = selectTemplates(catalog, await runtime.store.listRuns(1000), run)
  const queues: Record<SearchAudience, ConnectionHistoryItem[]> = { recruiter: [], technical: [] }
  const queuedPeople = new Set<string>()
  const positions = { recruiter: 0, technical: 0 }
  let keys = 0
  while (keys < 5) {
    if (runtime.stopRequested(run.runId)) return queues
    const needs = (['recruiter', 'technical'] as const).filter(audience =>
      queues[audience].length < quota[audience] * 2 && positions[audience] < templates[audience].length)
    if (!needs.length) break
    needs.sort((a, b) => (quota[b] - queues[b].length) - (quota[a] - queues[a].length))
    const audience = needs[0]; const template = templates[audience][positions[audience]++]
    keys += 1; run.usedSearchKeys.push(template.sourceKey)
    let cursor = ''
    for (let page = 0; page < 3; page += 1) {
      if (runtime.stopRequested(run.runId)) return queues
      const log = { runId: run.runId, platformAccountId: run.platformAccountId,
        audience, searchKey: template.sourceKey, page: page + 1 }
      runtime.logger.event('candidate_search', 'started', log)
      let response: any
      try {
        response = await runtime.adapter().searchPeople(run.accountId,
          renderSearchKeywords(template, run.stack, run.safeRecruiterOnly), cursor || undefined)
      } catch (error: any) {
        runtime.logger.event('candidate_search', 'failed', { ...log,
          errorCode: String(error?.code ?? 'candidate_search_failed') })
        throw error
      }
      run.counters.searched += 1
      let pageEligible = 0; let pageSkipped = 0
      for (const raw of connectionPageItems(response)) {
        const candidate = parseConnectionCandidate(raw); run.counters.discovered += 1
        if (!candidate.personId) { run.counters.skipped += 1; pageSkipped += 1; continue }
        const decision = evaluateCandidate(candidate, template, run.stack, run.safeRecruiterOnly)
        const timestamp = runtime.now().toISOString()
        const history: ConnectionHistoryItem = {
          historyKey: `${run.accountId}:${candidate.personId}`, runId: run.runId,
          platformAccountId: run.platformAccountId, accountId: run.accountId,
          personId: candidate.personId, audience, searchKey: template.sourceKey,
          name: candidate.name, headline: candidate.headline, location: candidate.location,
          ...(candidate.profileUrl ? { profileUrl: candidate.profileUrl } : {}),
          status: decision.eligible ? 'eligible' : 'skipped', reasonCode: decision.reasonCode,
          discoveredAt: timestamp, updatedAt: timestamp
        }
        const claimed = await claimRunCandidate(runtime.store, history)
        if (!claimed || queuedPeople.has(candidate.personId)) {
          run.counters.skipped += 1; pageSkipped += 1; continue
        }
        if (decision.eligible) {
          queues[audience].push(claimed); queuedPeople.add(candidate.personId)
          run.counters.eligible += 1; pageEligible += 1
        } else { run.counters.skipped += 1; pageSkipped += 1 }
      }
      cursor = connectionNextCursor(response)
      runtime.logger.event('candidate_search', 'succeeded', { ...log,
        candidateCount: connectionPageItems(response).length, eligibleCount: pageEligible,
        skippedCount: pageSkipped, cursorPresent: Boolean(cursor) })
      if (!cursor || queues[audience].length >= quota[audience] * 2) break
    }
    await save(run)
  }
  return queues
}
