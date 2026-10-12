import type { Position } from '../types.ts'
import type { SqlOperation } from '../infrastructure/postgres.ts'
import { canonicalUrl } from '../infrastructure/identity.ts'
import { publicationContext } from './posting-content.ts'
import type { VacancyCollection } from './index.ts'

export type PublicationEvidence = { sourceId: string; runId: string; url: string; observedAt: string; dates: string[] }
const sourceIds = (p: Position) => (p.sources ?? [p.source]).flatMap(s => s?.database?.sourceId ? [s.database.sourceId] : [])
const identity = (url: string) => { try { return canonicalUrl(url) } catch { return undefined } }

/** Current SQL source pointers only: no historical-run search, browser or classification call. */
export async function loadLatestPublicationEvidence(positions: Position[], read: SqlOperation): Promise<PublicationEvidence[]> {
  const ids = [...new Set(positions.flatMap(sourceIds))]
  if (!ids.length) return []
  const wanted = new Set(positions.flatMap(p => sourceIds(p).map(id => `${id}:${identity(p.url)}`)))
  const rows = await read(async s => (await s.query(`SELECT s.id::text AS source_id,r.id AS run_id,r.collection
    FROM noco.sources s JOIN noco.collection_runs r ON
      r.id=s.collection_state->'snapshot'->>'runId' OR r.id=s.collection_state->>'lastAttemptRun'
    WHERE s.id=ANY($1::bigint[])`, [ids])).rows)
  const result: PublicationEvidence[] = []
  for (const row of rows) {
    const sourceId = String(row.source_id), runId = String(row.run_id), collection = row.collection as VacancyCollection
    const add = (url: string, observedAt: string, dates: string[]) => {
      if (dates.length && Number.isFinite(Date.parse(observedAt)) && wanted.has(`${sourceId}:${identity(url)}`)) result.push({ sourceId, runId, url, observedAt, dates })
    }
    for (const p of collection.positions ?? []) {
      if (!sourceIds(p).includes(sourceId) || !Number.isFinite(Date.parse(p.retrievedAt))) continue
      const context = publicationContext(p, new Date(p.retrievedAt))
      add(p.url, p.retrievedAt, context.status === 'valid' ? [context.publicationDate!] : context.evidence)
    }
    // An expired posting is deliberately absent from positions; its date survives in the precheck audit.
    for (const audit of collection.audit ?? []) {
      if (audit.source.database?.sourceId !== sourceId) continue
      for (const item of audit.publicationDatePrecheck?.outcomes ?? []) {
        add(item.url, audit.publicationDatePrecheck!.checkedAt, item.publicationDate ? [item.publicationDate] : item.evidence)
      }
    }
  }
  return result
}

/** Enrich evidence, never eligibility. Existing date conflicts remain reviewable; observation/body stay unchanged. */
export function withLatestPublicationEvidence(positions: Position[], observations: PublicationEvidence[]): Position[] {
  const index = new Map<string, PublicationEvidence[]>()
  for (const item of observations) {
    const key = `${item.sourceId}:${identity(item.url)}`
    const group = index.get(key) ?? []; group.push(item); index.set(key, group)
  }
  return positions.map(p => {
    const found = sourceIds(p).flatMap(id => index.get(`${id}:${identity(p.url)}`) ?? [])
      .filter(item => Date.parse(item.observedAt) >= Date.parse(p.retrievedAt))
    if (!found.length) return p
    return { ...p, publicationDates: [...new Set([...(p.publicationDates ?? []), ...(p.publishedAt ? [p.publishedAt] : []), ...found.flatMap(item => item.dates)])],
      publicationEvidence: found.map(({ dates, ...reference }) => reference) }
  })
}
