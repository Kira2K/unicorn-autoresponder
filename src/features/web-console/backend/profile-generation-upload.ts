type Handler = import('express').RequestHandler
type Request = import('express').Request
const express = require('express') as typeof import('express')
const { codedError } = require('../../linkedin-automation/profile-filler/errors.ts') as
  typeof import('../../linkedin-automation/profile-filler/errors.ts')
const { DOCX_MIME, MAX_CV_UPLOAD_BYTES, PDF_MIME } =
  require('../../linkedin-automation/profile-filler/generation/uploaded-cv.ts') as
  typeof import('../../linkedin-automation/profile-filler/generation/uploaded-cv.ts')

const rawBody = express.raw({ type: [PDF_MIME, DOCX_MIME], limit: MAX_CV_UPLOAD_BYTES })

const parseCvBody: Handler = (req, res, next) => rawBody(req, res, (error: any) => {
  if (!error) { next(); return }
  const tooLarge = error?.type === 'entity.too.large'
  res.status(tooLarge ? 413 : 400).json({
    error: tooLarge ? 'profile_cv_too_large' : 'profile_cv_content_invalid',
    message: tooLarge ? 'The uploaded CV exceeds 20 MB.' : 'The uploaded CV could not be read.'
  })
})

function readCvUpload(req: Request) {
  const mimeType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const isUpload = mimeType === PDF_MIME || mimeType === DOCX_MIME
  if (!isUpload && Number(req.headers['content-length'] ?? 0) > 0) {
    throw codedError('profile_cv_format_unsupported', 'Only PDF and DOCX CV files are supported.')
  }
  return isUpload ? {
    bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), mimeType
  } : undefined
}

function cvUploadFailure(error: any) {
  const code = String(error?.code ?? '')
  if (!['profile_cv_format_unsupported', 'profile_cv_empty',
    'profile_cv_content_invalid'].includes(code)) return undefined
  return { status: code === 'profile_cv_format_unsupported' ? 415 : 400,
    body: { error: code, message: String(error?.message ?? 'The uploaded CV is invalid.') } }
}

module.exports = { cvUploadFailure, parseCvBody, readCvUpload }
