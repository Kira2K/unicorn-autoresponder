import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Store } from '../types.ts'
import { assertPreparedCv, cvHash } from './tailoring.ts'
import { inspectPdf } from './pdf.ts'

/** Adopt a reviewed local correction before the first submission; never regenerate or overwrite its parent. */
export async function revisePreparedCv(input: { candidateId: string; batchId: string; positionId: string; parentHash: string; path: string; sha256: string; reason: string; evidence: string },
  deps: { store: Store; inspect?: typeof inspectPdf }) {
  const release = await deps.store.lock(input.candidateId)
  try {
    const candidate = await deps.store.candidate(input.candidateId), batch = await deps.store.batch(input.candidateId, input.batchId)
    const record = batch?.records.find(r => r.position.id === input.positionId), parent = record?.preparedCv
    if (!batch || !record || !parent || !batch.targetIds.includes(input.positionId)) throw Error('revision_target_missing')
    if (record.attempt !== 0 || !['prepared', 'blocked'].includes(record.status) || record.outcomes?.length || record.evidence) throw Error('revision_after_attempt_forbidden')
    if (!input.reason.trim() || !input.evidence.trim()) throw Error('revision_review_required')
    await assertPreparedCv(parent, candidate, record.position)
    const bytes = await readFile(input.path)
    if (cvHash(bytes) !== input.sha256) throw Error('revision_hash_mismatch')
    if (parent.sha256 === input.sha256 && record.cvRevisions?.some(r => r.parent.sha256 === input.parentHash && r.resultHash === input.sha256)) return parent
    if (parent.sha256 !== input.parentHash || parent.batchId !== batch.id) throw Error('revision_parent_mismatch')
    if (resolve(input.path) === resolve(parent.path) || input.sha256 === parent.sha256) throw Error('revision_must_preserve_parent')
    const inspected = await (deps.inspect ?? inspectPdf)(bytes), now = new Date().toISOString()
    const next = { ...parent, path: resolve(input.path), sha256: input.sha256, textHash: inspected.textHash, pages: inspected.pages, createdAt: now,
      testReview: { result: 'passed' as const, evidence: input.evidence, reviewedAt: now, sha256: input.sha256 } }
    await assertPreparedCv(next, candidate, record.position)
    record.cvRevisions = [...(record.cvRevisions ?? []), { parent, resultHash: next.sha256, reason: input.reason, evidence: input.evidence, at: now }]
    record.preparedCv = next; record.updatedAt = batch.updatedAt = now
    await deps.store.saveBatch(batch)
    return next
  } finally { await release() }
}
