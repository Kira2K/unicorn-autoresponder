import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createFileStore, safeId } from '../infrastructure/store.ts'
import { tailoringInput } from '../application_preparation/tailoring.ts'
import type { TailoringPolicy } from '../application_preparation/tailoring.ts'
import type { BatchState } from '../types.ts'

export type TailoringState = { status: string; requests: number; requestedAt: string; hasResult: boolean; hasArtifact: boolean; failure?: { code?: string; status?: number; at: string } }

/** Read only selected target journals; never expose a result URL, CV contents or private answers. */
export async function readTailoringStates(input: { candidateId: string; studentId: string; batchId: string; positionIds: string[]; tailoringPolicy: TailoringPolicy }, batch: BatchState | undefined, root = 'storage/external-responses') {
  const states: Record<string, TailoringState> = {}
  if (!batch) return states
  const directory = join(resolve(root), 'candidates', safeId(input.candidateId), 'tailored', safeId(input.batchId))
  for (const id of input.positionIds) {
    const record = batch.records.find(r => r.position.id === id)
    if (!record) continue
    let journal: any
    try { journal = JSON.parse(await readFile(join(directory, `${safeId(id)}.json`), 'utf8')) }
    catch (error: any) { if (error.code === 'ENOENT') continue; throw error }
    const candidate = await createFileStore(root).candidate(input.candidateId)
    if (candidate.id !== input.candidateId || candidate.databaseClientId !== String(input.studentId)) throw Error('tailoring_checkpoint_student_mismatch')
    const expected = tailoringInput({ candidate, position: record.position, batchId: input.batchId, policy: input.tailoringPolicy, directory })
    if (JSON.stringify(journal.binding) !== JSON.stringify(expected) || journal.requests !== 1 || !Number.isFinite(Date.parse(journal.requestedAt))) throw Error('tailoring_checkpoint_binding_mismatch')
    const failure = journal.failure
    const safeFailure = failure && typeof failure.at === 'string' && Number.isFinite(Date.parse(failure.at)) ? {
      ...(typeof failure.code === 'string' && /^[a-z][a-z0-9_]{0,60}$/.test(failure.code) ? { code: failure.code } : {}),
      ...(Number.isInteger(failure.status) && failure.status >= 100 && failure.status <= 599 ? { status: failure.status } : {}), at: failure.at,
    } : undefined
    states[id] = { status: String(journal.status), requests: journal.requests, requestedAt: journal.requestedAt,
      hasResult: typeof journal.resultUrl === 'string' && !!journal.resultUrl,
      hasArtifact: !!journal.artifact,
      ...(safeFailure ? { failure: safeFailure } : {}) }
  }
  return states
}
