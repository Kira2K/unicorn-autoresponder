import assert from 'node:assert/strict'
import { generationErrorText, profileStageText } from './profile-generation-view.js'
import { cvMime, cvUploadError, DOCX_MIME, PDF_MIME } from './profile-cv-upload.js'
import './profile-preview-view.test.js'
import './profile-session.test.js'
import './profile-actions.test.js'
import { testProfileObserver } from './profile-job-observer.test.js'

await testProfileObserver()

assert.equal(profileStageText('extracting_cv_facts'), 'Читаем факты из CV')
assert.equal(profileStageText('resolving_job_titles'),
  'Подбираем должности для готовности к работе')
assert.match(generationErrorText('profile_cv_access_denied'), /Сервисный аккаунт/)
assert.match(generationErrorText('profile_cv_content_invalid'), /PDF или DOCX/)
assert.match(generationErrorText('openai_rate_limited'), /ограничил/)
assert.match(generationErrorText('openai_schema_invalid'), /формат/)
assert.match(generationErrorText('unipile_api_too_many_requests'), /продолжить/)
assert.match(profileStageText('waiting_unipile_retry'), /вручную/)
assert.equal(generationErrorText('unknown'), undefined)
assert.equal(cvMime({ name: 'cv.PDF', size: 10 }), PDF_MIME)
assert.equal(cvMime({ name: 'cv.docx', size: 10 }), DOCX_MIME)
assert.match(cvUploadError({ name: 'cv.txt', size: 10 }), /PDF или DOCX/)
console.log('profile generation view tests passed')
