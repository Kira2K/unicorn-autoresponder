import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createCvTailoringService } from '../../../integrations/cv-tailoring.ts'
import type { CvTailoringService } from '../../../integrations/cv-tailoring.ts'
import { atomicJson, createFileStore, safeId } from '../infrastructure/store.ts'
import { inspectPdf, downloadPdf } from './pdf.ts'
import type { Candidate, Position } from '../types.ts'

export type TailoringPolicy = { id: string; approvedAt: string; approvalReference: string }
export type PreparedCv = { candidateId: string; studentId: string; positionId: string; batchId: string; originalHash: string; descriptionHash: string; policy: TailoringPolicy; path: string; sha256: string; fileName: string; textHash: string; pages: number; createdAt: string; validation: 'technical'; testReview?: { result: 'passed' | 'failed'; evidence: string; reviewedAt: string; sha256: string } }
type Input = { candidate: Candidate; position: Position; batchId: string; policy: TailoringPolicy; directory: string }
export const cvHash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
export function tailoringInput(input: Input) {
  if (!input.candidate.databaseClientId) throw Error('tailoring_student_binding_required')
  if (!input.policy.id || !input.policy.approvalReference || !Number.isFinite(Date.parse(input.policy.approvedAt))) throw Error('tailoring_policy_approval_required')
  if (!input.position.description.trim() || Buffer.byteLength(input.position.description, 'utf8') > 100000) throw Error('tailoring_description_limit')
  return { candidateId: input.candidate.id, studentId: input.candidate.databaseClientId, positionId: input.position.id, batchId: input.batchId, originalHash: input.candidate.cv.sha256, descriptionHash: cvHash(input.position.description), policy: input.policy }
}
export async function assertPreparedCv(cv: PreparedCv, candidate: Candidate, position: Position) {
  if (cv.candidateId !== candidate.id || cv.studentId !== candidate.databaseClientId || cv.positionId !== position.id || cv.originalHash !== candidate.cv.sha256 || cv.descriptionHash !== cvHash(position.description) || cv.validation !== 'technical') throw Error('prepared_cv_binding_mismatch')
  if (resolve(cv.path) === resolve(candidate.cv.path)) throw Error('original_cv_upload_forbidden')
  if (cv.sha256 === candidate.cv.sha256) throw Error('unchanged_original_cv_upload_forbidden')
  if (cvHash(await readFile(cv.path)) !== cv.sha256) throw Error('prepared_cv_hash_mismatch')
}
/** One durable generation intent per student/target/batch. A lost response never permits another POST. */
export async function tailorCv(input: Input, deps: { service: CvTailoringService; inspect: typeof inspectPdf; download: (url: string) => Promise<Buffer> } = { service: createCvTailoringService(), inspect: inspectPdf, download: downloadPdf }): Promise<PreparedCv> {
  const binding = tailoringInput(input), directory = resolve(input.directory), target = safeId(input.position.id)
  const release = await createFileStore(directory).lock(`tailoring-${input.candidate.databaseClientId}`)
  try {
    const statePath = join(directory, `${target}.json`)
    let state: any
    try { state = JSON.parse(await readFile(statePath, 'utf8')) } catch (e: any) { if (e.code !== 'ENOENT') throw e }
    if (state && JSON.stringify(state.binding) !== JSON.stringify(binding)) throw Error('tailoring_inputs_changed')
    if (state?.artifact) { await assertPreparedCv(state.artifact, input.candidate, input.position); return state.artifact }
    const bytes = await readFile(input.candidate.cv.path)
    if (bytes.length > 15 * 1024 * 1024 || cvHash(bytes) !== binding.originalHash) throw Error('original_cv_hash_or_size_invalid')
    if (!state) {
      await deps.inspect(bytes)
      state = { binding, status: 'request_intent', requestedAt: new Date().toISOString(), requests: 1, upstreamUsage: 'unknown' }
      await atomicJson(statePath, state)
      try {
        const result = await deps.service.tailorFromPdf({ fileName: input.candidate.cv.fileName, mimeType: 'application/pdf', fileBuffer: bytes, jobRequirements: input.position.description })
        state = { ...state, status: 'result_received', resultUrl: result.url }; await atomicJson(statePath, state)
      } catch (error: any) {
        const code = typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,60}$/.test(error.code) ? error.code : undefined
        const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined
        await atomicJson(statePath, { ...state, status: 'generation_uncertain_or_failed', failure: { code, status, at: new Date().toISOString() } })
        throw error
      }
    }
    if (!state.resultUrl) throw Error('tailoring_request_consumed_or_uncertain')
    const result = await deps.download(state.resultUrl), path = join(directory, `${target}-tailored.pdf`)
    await mkdir(directory, { recursive: true }); await writeFile(path, result, { mode: 0o600 })
    const inspected = await deps.inspect(result)
    const artifact: PreparedCv = { ...binding, path, sha256: cvHash(result), fileName: `${safeId(input.candidate.id)}-${target}-CV.pdf`, textHash: inspected.textHash, pages: inspected.pages, createdAt: new Date().toISOString(), validation: 'technical' }
    await writeFile(join(directory, `${target}-text.txt`), inspected.text, { mode: 0o600 })
    await atomicJson(statePath, { ...state, status: 'ready', artifact })
    return artifact
  } finally { await release() }
}
