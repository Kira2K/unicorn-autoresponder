import { createHash } from 'node:crypto'
import { codedError } from '../errors.ts'
import type { CvDocument } from './types.ts'

export const MAX_CV_UPLOAD_BYTES = 20 * 1024 * 1024
export const PDF_MIME = 'application/pdf'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const SUPPORTED = new Set([PDF_MIME, DOCX_MIME])

export type CvUpload = { bytes: Buffer; mimeType: string }

export function normalizeUploadedCv(upload: CvUpload,
  maxBytes = MAX_CV_UPLOAD_BYTES): CvDocument {
  const mimeType = String(upload?.mimeType ?? '').split(';')[0].trim().toLowerCase()
  const bytes = Buffer.isBuffer(upload?.bytes) ? upload.bytes : Buffer.alloc(0)
  if (!SUPPORTED.has(mimeType)) throw codedError('profile_cv_format_unsupported',
    'Only PDF and DOCX CV files are supported.')
  if (!bytes.length) throw codedError('profile_cv_empty', 'The uploaded CV file is empty.')
  if (bytes.length > maxBytes) throw codedError('profile_cv_too_large',
    'The uploaded CV exceeds 20 MB.')
  const isPdf = mimeType === PDF_MIME
  const signatureOk = isPdf ? bytes.subarray(0, 5).toString() === '%PDF-' :
    bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!signatureOk) throw codedError('profile_cv_content_invalid',
    'The uploaded file content does not match its format.')
  const revision = `upload:${createHash('sha256').update(bytes).digest('hex')}`
  return { bytes, mimeType: mimeType as CvDocument['mimeType'],
    fileName: isPdf ? 'uploaded-en-cv.pdf' : 'uploaded-en-cv.docx', revision }
}
