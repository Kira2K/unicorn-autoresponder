import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { atomicJson } from '../infrastructure/store.ts'
import type { Source, SourceAccessGate } from '../types.ts'

export type SourceReviews = { pending(source: Source): Promise<SourceAccessGate | undefined>; queue(source: Source, gate: SourceAccessGate): Promise<void> }
/** Durable local review queue; SQL run audit retains the same evidence. No new tables. */
export function createSourceReviewStore(directory: string) {
  const path = (source: Source) => join(directory, digest([source.database?.sourceId ?? source.name, source.url]) + '.json')
  const read = async (source: Source) => {
    try { return JSON.parse(await readFile(path(source), 'utf8')) }
    catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error }
  }
  return {
    async pending(source: Source): Promise<SourceAccessGate | undefined> { const record = await read(source); return record?.status === 'pending' ? record.gate : undefined },
    async queue(source: Source, gate: SourceAccessGate) {
      const previous = await read(source)
      await atomicJson(path(source), { source, gate, status: 'pending', firstSeenAt: previous?.firstSeenAt ?? new Date().toISOString(), lastSeenAt: new Date().toISOString(), nextAction: 'Resolve access manually, then mark this review resolved before a fresh collection run.' })
    },
    async resolve(source: Source) { const record = await read(source); if (record) await atomicJson(path(source), { ...record, status: 'resolved', resolvedAt: new Date().toISOString() }) },
  }
}
