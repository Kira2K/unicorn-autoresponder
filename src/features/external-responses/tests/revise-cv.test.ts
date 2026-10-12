import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { revisePreparedCv } from '../application_preparation/revise-cv.ts'
import { cvHash } from '../application_preparation/tailoring.ts'

test('reviewed correction preserves parent, resumes without another revision and rejects unsafe changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cv-revision-'))
  try {
    const parentPath = join(dir, 'parent.pdf'), path = join(dir, 'corrected.pdf')
    await writeFile(parentPath, 'generated'); await writeFile(path, 'corrected')
    const candidate: any = { id: 'c', databaseClientId: '1', cv: { path: join(dir, 'original.pdf'), sha256: cvHash('original') } }
    const position: any = { id: 'p', description: 'description' }
    const parent: any = { candidateId: 'c', studentId: '1', positionId: 'p', batchId: 'b', originalHash: candidate.cv.sha256, descriptionHash: cvHash('description'), path: parentPath, sha256: cvHash('generated'), validation: 'technical' }
    const record: any = { position, preparedCv: parent, status: 'blocked', attempt: 0 }
    const batch: any = { id: 'b', targetIds: ['p'], records: [record] }
    let saves = 0, locked = false
    const store: any = { candidate: async () => candidate, batch: async () => batch, saveBatch: async () => { assert.ok(locked); saves++ }, lock: async () => { locked = true; return async () => { locked = false } } }
    const inspect = async (b: Buffer) => ({ text: b.toString(), textHash: cvHash(b), pages: 2 })
    const input = { candidateId: 'c', batchId: 'b', positionId: 'p', parentHash: parent.sha256, path, sha256: cvHash('corrected'), reason: 'Remove invented degree', evidence: 'review.md' }
    await assert.rejects(revisePreparedCv({ ...input, parentHash: 'wrong' }, { store, inspect }), /parent/)
    await assert.rejects(revisePreparedCv({ ...input, sha256: 'wrong' }, { store, inspect }), /hash/)
    await assert.rejects(revisePreparedCv(input, { store, inspect: async () => { throw Error('invalid_pdf') } }), /invalid_pdf/)
    await revisePreparedCv(input, { store, inspect }); await revisePreparedCv(input, { store, inspect })
    assert.equal(saves, 1); assert.equal(record.cvRevisions.length, 1); assert.deepEqual(record.cvRevisions[0].parent, parent)
    assert.equal(record.preparedCv.testReview.result, 'passed')
    record.attempt = 1
    await assert.rejects(revisePreparedCv(input, { store, inspect }), /after_attempt/)
    record.attempt = 0; record.status = 'unknown'
    await assert.rejects(revisePreparedCv(input, { store, inspect }), /after_attempt/)
    record.status = 'blocked'; record.preparedCv.studentId = 'other'
    await assert.rejects(revisePreparedCv(input, { store, inspect }), /binding/)
    assert.equal(locked, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
