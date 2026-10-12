import { positionId,isDuplicate } from '../infrastructure/identity.ts'
import { diagnostic } from '../infrastructure/store.ts'
import { basicFit } from './basic-fit.ts'
import type { Candidate,Position,Source,DiscoveryStrategy,DiscoveryResult,Store } from '../types.ts'

export async function discoverPositions(input: { candidate: Candidate; runId: string; sources: Source[] }, deps: {
  strategy: DiscoveryStrategy; store?: Store; assess?: (position: Position, candidate: Candidate) => Promise<NonNullable<Position['fit']>>
}): Promise<DiscoveryResult> {
  const result = await deps.strategy.discover(input.sources, input.candidate)
  const retained = new Map<string, Position>()
  for (const position of result.positions) {
    position.id = positionId(position.url)
    if (isDuplicate(position, input.candidate.history)) position.fit = { decision: 'excluded', reasons: ['Existing application or skip history'], evidence: [position.url] }
    else if (!position.fit) {
      position.fit = basicFit(position, input.candidate)
      if (position.fit?.decision !== 'excluded' && deps.assess) {
        try { position.fit = await deps.assess(position, input.candidate) }
        catch { position.fit = { decision: 'review', reasons: ['Fit assessment unavailable'], evidence: [] } }
      }
    }
    const previous = retained.get(position.id)
    const preferred = !previous || position.description.length > previous.description.length ? position : previous
    preferred.sources = [...new Map([...(previous?.sources ?? (previous ? [previous.source] : [])), ...(position.sources ?? [position.source])].map(source => [source.name + '|' + source.url + '|' + source.provenance, source])).values()]
    retained.set(position.id, preferred)
  }
  const output = { ...result, positions: [...retained.values()], runId: input.runId, candidateId: input.candidate.id, strategy: deps.strategy.name, createdAt: new Date().toISOString() }
  if (deps.store) await diagnostic(deps.store, { at: output.createdAt, action: 'discovery_completed', runId: input.runId, candidateId: input.candidate.id, data: { sources: output.audit, positions: output.positions.map(p => ({ id: p.id, title: p.title, fit: p.fit })) } })
  return output
}
