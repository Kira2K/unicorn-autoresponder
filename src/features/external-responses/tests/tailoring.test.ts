import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { tailorCv, assertPreparedCv, tailoringInput } from '../application_preparation/tailoring.ts'
import type { Candidate, Position } from '../types.ts'

const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
const original = Buffer.from('%PDF-1.4\noriginal fixture')
const output = Buffer.from('%PDF-1.4\ntailored fixture')
const policy = { id: 'fixture-v1', approvedAt: '2026-09-28T00:00:00Z', approvalReference: 'explicit test approval' }
const inspect = async (b: Buffer) => ({ pages: 1, text: b.toString(), textHash: hash(b) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'external-tailor-'))
  const cvPath = join(directory, 'original.pdf'); await writeFile(cvPath, original)
  const candidate: Candidate = { id: 'kirill', databaseClientId: '35', cv: { path: cvPath, sha256: hash(original), fileName: 'original.pdf' }, facts: {}, criteria: { titles: [] }, history: [], createdAt: policy.approvedAt }
  const position: Position = { id: 'role-1', title: 'Senior Fullstack Engineer', company: 'Example', description: 'Build TypeScript product features.', location: 'Europe', url: 'https://jobs.example/1', applyUrl: 'https://jobs.example/1/apply', retrievedAt: policy.approvedAt, source: { name: 'Example', url: 'https://jobs.example' } }
  return { directory, candidate, position, batchId: 'one', policy }
}
test('tailoring sends original bytes and complete description, binds output, and reuses without another call', async () => {
  const input = await fixture(); let calls = 0
  const deps = { inspect, service: { tailorFromPdf: async (r: any) => { calls++; assert.deepEqual(r.fileBuffer, original); assert.equal(r.jobRequirements, input.position.description); return { url: 'https://files.example/cv.pdf' } } }, download: async () => output }
  try {
    const a = await tailorCv(input, deps), b = await tailorCv(input, deps)
    assert.equal(calls, 1); assert.equal(a.sha256, hash(output)); assert.equal(b.sha256, a.sha256)
    assert.notEqual(a.path, input.candidate.cv.path); assert.deepEqual(await readFile(input.candidate.cv.path), original)
    await assertPreparedCv(a, input.candidate, input.position)
    await assert.rejects(assertPreparedCv(a, { ...input.candidate, databaseClientId: '36' }, input.position), /binding/)
    await assert.rejects(assertPreparedCv(a, input.candidate, { ...input.position, id: 'role-2' }), /binding/)
    await assert.rejects(assertPreparedCv({ ...a, path: input.candidate.cv.path }, input.candidate, input.position), /original_cv/)
    await assert.rejects(assertPreparedCv({ ...a, sha256: input.candidate.cv.sha256 }, input.candidate, input.position), /original_cv/)
    await writeFile(a.path, original); await assert.rejects(assertPreparedCv(a, input.candidate, input.position), /hash/)
  } finally { await rm(input.directory, { recursive: true, force: true }) }
})
test('uncertain generation consumes budget; resume never repeats POST', async () => {
  const input = await fixture(); let calls = 0
  const deps = { inspect, service: { tailorFromPdf: async () => { calls++; throw Error('timeout') } }, download: async () => output }
  try { await assert.rejects(tailorCv(input, deps)); await assert.rejects(tailorCv(input, deps), /consumed|uncertain/); assert.equal(calls, 1) }
  finally { await rm(input.directory, { recursive: true, force: true }) }
})
test('invalid downloaded document cannot become prepared CV and download recovery does not regenerate', async () => {
  const input = await fixture(); let calls = 0, downloads = 0
  const deps = { inspect: async (bytes: Buffer) => { if (!bytes.toString().startsWith('%PDF')) throw Error('invalid_pdf'); return inspect(bytes) }, service: { tailorFromPdf: async () => { calls++; return { url: 'https://files.example/result' } } }, download: async () => ++downloads === 1 ? Buffer.from('<html>error</html>') : output }
  try { await assert.rejects(tailorCv(input, deps), /invalid_pdf/); const a = await tailorCv(input, deps); assert.equal(calls, 1); assert.equal(a.sha256, hash(output)) }
  finally { await rm(input.directory, { recursive: true, force: true }) }
})
test('changed inputs cannot reuse a consumed request; no truncation', async () => {
  const input = await fixture()
  try {
    assert.throws(() => tailoringInput({ ...input, position: { ...input.position, description: 'x'.repeat(100001) } }), /description/)
    const deps = { inspect, service: { tailorFromPdf: async () => ({ url: 'https://files.example/cv.pdf' }) }, download: async () => output }
    await tailorCv(input, deps)
    await assert.rejects(tailorCv({ ...input, position: { ...input.position, description: 'changed' } }, deps), /inputs_changed/)
  } finally { await rm(input.directory, { recursive: true, force: true }) }
})
