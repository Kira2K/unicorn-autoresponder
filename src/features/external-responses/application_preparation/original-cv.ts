import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Candidate } from '../types.ts'

export type OriginalCvApproval = { approvedAt: string; approvalReference: string }

export function assertOriginalCvApproval(approval?: OriginalCvApproval) {
  if (!approval || !Number.isFinite(Date.parse(approval.approvedAt)) || !approval.approvalReference?.trim()) throw Error('original_cv_approval_required')
}

export async function assertOriginalCv(candidate: Candidate) {
  const bytes = await readFile(candidate.cv.path)
  if (createHash('sha256').update(bytes).digest('hex') !== candidate.cv.sha256) throw Error('original_cv_hash_mismatch')
  return candidate.cv
}
