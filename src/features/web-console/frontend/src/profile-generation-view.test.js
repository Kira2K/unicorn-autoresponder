import assert from 'node:assert/strict'
import { generationErrorText, profileStageText } from './profile-generation-view.js'
import { cvMime, cvUploadError, DOCX_MIME, PDF_MIME } from './profile-cv-upload.js'

assert.equal(profileStageText('extracting_cv_facts'), 'Extracting facts from final EN CV')
assert.equal(profileStageText('resolving_job_titles'),
  'Matching Open to Work roles with LinkedIn')
assert.match(generationErrorText('profile_cv_access_denied'), /service account/)
assert.match(generationErrorText('profile_cv_content_invalid'), /PDF or DOCX/)
assert.match(generationErrorText('openai_rate_limited'), /rate limit/)
assert.match(generationErrorText('openai_schema_invalid'), /schema/)
assert.match(generationErrorText('unipile_api_too_many_requests'), /resume/)
assert.match(profileStageText('waiting_unipile_retry'), /manual resume/)
assert.equal(generationErrorText('unknown'), undefined)
assert.equal(cvMime({ name: 'cv.PDF', size: 10 }), PDF_MIME)
assert.equal(cvMime({ name: 'cv.docx', size: 10 }), DOCX_MIME)
assert.match(cvUploadError({ name: 'cv.txt', size: 10 }), /PDF or DOCX/)
console.log('profile generation view tests passed')
