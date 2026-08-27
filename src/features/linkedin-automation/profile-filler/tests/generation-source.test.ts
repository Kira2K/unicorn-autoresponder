import assert from 'node:assert/strict'
import { selectFinalEnglishCv } from '../generation/cv-source.ts'
import { driveFileId } from '../generation/drive-file-id.ts'
import { loadDriveCv } from '../generation/drive-cv.ts'

async function run() {
  const selected = selectFinalEnglishCv([
    { Id: 1, clients_id: 7, status: 'filled', en_version_url: 'old', UpdatedAt: '2026-01-01' },
    { Id: 2, clients_id: 7, status: 'moved to filling', en_version_url: 'new',
      UpdatedAt: '2026-02-01' },
    { Id: 3, clients_id: 7, status: 'Draft in process', en_version_url: 'draft' }
  ], 7)
  assert.equal(selected.url, 'new')
  assert.throws(() => selectFinalEnglishCv([], 7), { code: 'profile_cv_not_ready' })
  assert.equal(driveFileId('https://docs.google.com/document/d/doc-123/edit'), 'doc-123')
  assert.equal(driveFileId('https://drive.google.com/file/d/pdf-123/view'), 'pdf-123')
  assert.throws(() => driveFileId('https://example.com/file.pdf'), { code: 'profile_cv_url_invalid' })

  const calls: any[] = []
  const drive = { files: {
    async get(input: any, options?: any) {
      calls.push(['get', input, options])
      if (input.alt === 'media') return { data: Buffer.from('pdf') }
      return { data: { mimeType: 'application/pdf', size: '3', version: '9' } }
    },
    async export() { throw new Error('not expected') }
  } }
  const cv = await loadDriveCv('https://drive.google.com/file/d/pdf-123/view', 20, drive as any)
  assert.equal(cv.bytes.toString(), 'pdf')
  assert.equal(cv.revision, '9')
  assert.equal(calls[1][1].alt, 'media')

  const unsupported = { files: { async get() {
    return { data: { mimeType: 'text/plain', size: '2' } }
  } } }
  await assert.rejects(loadDriveCv('https://drive.google.com/file/d/x/view', 20,
    unsupported as any), { code: 'profile_cv_format_unsupported' })
  let exported = false
  const googleDoc = { files: {
    async get() { return { data: { mimeType: 'application/vnd.google-apps.document',
      modifiedTime: '2026-08-24' } } },
    async export() { exported = true; return { data: Buffer.from('doc-pdf') } }
  } }
  assert.equal((await loadDriveCv('https://docs.google.com/document/d/doc/edit', 20,
    googleDoc as any)).bytes.toString(), 'doc-pdf')
  assert.equal(exported, true)
  const large = { files: { async get() { return { data: {
    mimeType: 'application/pdf', size: '21' } } } } }
  await assert.rejects(loadDriveCv('https://drive.google.com/file/d/x/view', 20,
    large as any), { code: 'profile_cv_too_large' })
}

run().then(() => console.log('profile generation CV source tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
