import assert from 'node:assert/strict'
import { createDriveSourceLoader } from '../drive-source.ts'
import { google } from 'googleapis'
import { createProfileDriveClient } from '../drive-client.ts'
import { ProfileFillerError } from '../errors.ts'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF = 'application/pdf'
const GOOGLE_DOC = 'application/vnd.google-apps.document'
const cvUrl = 'https://docs.google.com/document/d/final-cv/edit'

function expectSafeError(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof ProfileFillerError)
    assert.equal(error.code, code)
    assert.equal(error.stage, 'load_sources')
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /FAKE_SECRET|PRIVATE_CONTENT|service account/i)
    return true
  }
}

function runAuthTests() {
  const sentinel = { files: {} }
  const choose = (env: NodeJS.ProcessEnv) => {
    let selected: any
    const client = createProfileDriveClient({ env, cwd: '/missing-drive-test-directory',
      createClient: config => { selected = config; return sentinel } })
    assert.equal(client, sentinel)
    assert.equal(selected.version, 'v3')
    return selected.auth
  }
  const both = { GOOGLE_DRIVE_API_KEY: '  FAKE_SECRET  ', GOOGLE_APPLICATION_CREDENTIALS: 'missing.json' }
  assert.equal(choose(both), 'FAKE_SECRET')
  assert.equal(choose({ ...both, HH_PROFILE_DRIVE_AUTH: 'api-key' }), 'FAKE_SECRET')
  assert.ok(choose({ ...both, HH_PROFILE_DRIVE_AUTH: 'service-account' }) instanceof google.auth.GoogleAuth)
  assert.ok(choose({ GOOGLE_DRIVE_API_KEY: '  ' }) instanceof google.auth.GoogleAuth)
  assert.ok(choose({}) instanceof google.auth.GoogleAuth)
  assert.throws(() => choose({ HH_PROFILE_DRIVE_AUTH: 'api-key', GOOGLE_DRIVE_API_KEY: ' ' }),
    expectSafeError('profile_drive_api_key_missing'))
  assert.throws(() => choose({ ...both, HH_PROFILE_DRIVE_AUTH: 'FAKE_SECRET' }),
    expectSafeError('profile_drive_auth_invalid'))
}

async function runDownloadTests() {
  for (const mimeType of [GOOGLE_DOC, PDF, DOCX]) {
    const calls: string[] = []
    const drive = { files: {
      get: async (input: any, options?: any) => {
        if (!input.alt) return { data: { mimeType, name: 'CV', version: '7', size: 3 } }
        assert.equal(input.alt, 'media')
        assert.equal(options.responseType, 'arraybuffer')
        calls.push('media')
        return { data: Buffer.from('CV!') }
      },
      export: async (input: any, options: any) => {
        assert.equal(input.mimeType, PDF)
        assert.equal(options.responseType, 'arraybuffer')
        calls.push('export')
        return { data: Buffer.from('CV!') }
      }
    } }
    const document = await createDriveSourceLoader({ drive, maxBytes: 3 }).loadCv(cvUrl)
    assert.deepEqual(calls, [mimeType === GOOGLE_DOC ? 'export' : 'media'])
    assert.equal(document.bytes.toString(), 'CV!')
    assert.equal(document.mimeType, mimeType === DOCX ? DOCX : PDF)
    assert.equal(document.fileName, mimeType === DOCX ? 'CV.docx' : 'CV.pdf')
    assert.equal(document.revision, '7')
    assert.equal(document.source, 'cv')
    await assert.rejects(createDriveSourceLoader({ drive, maxBytes: 2 }).loadCv(cvUrl),
      expectSafeError('profile_drive_file_too_large'))
  }
  for (const mimeType of [GOOGLE_DOC, PDF]) {
    const drive = { files: {
      get: async (input: any) => ({ data: input.alt ? Buffer.alloc(4) : { mimeType, size: 0 } }),
      export: async () => ({ data: Buffer.alloc(4) })
    } }
    await assert.rejects(createDriveSourceLoader({ drive, maxBytes: 3 }).loadCv(cvUrl),
      expectSafeError('profile_drive_file_too_large'))
  }
  const unsupported = { files: { get: async () => ({ data: { mimeType: 'image/png' } }) } }
  await assert.rejects(createDriveSourceLoader({ drive: unsupported }).loadCv(cvUrl),
    expectSafeError('profile_drive_format_unsupported'))
}

async function runFailureTests() {
  for (const step of ['metadata', 'export', 'media', 'list']) {
    for (const status of [401, 403, 404, 500]) {
      let requests = 0
      const fail = () => { requests++; throw Object.assign(new Error('FAKE_SECRET PRIVATE_CONTENT'),
        { code: 'ERR_BAD_RESPONSE', response: { status }, config: { key: 'FAKE_SECRET' } }) }
      const drive = { files: {
        get: async (input: any) => {
          if (step === 'metadata' || input.alt) return fail()
          return { data: { mimeType: step === 'export' ? GOOGLE_DOC : PDF } }
        },
        export: async () => fail(), list: async () => fail()
      } }
      let clients = 0
      const apiClient = createProfileDriveClient({ env: { GOOGLE_DRIVE_API_KEY: 'FAKE_SECRET' },
        createClient: config => { clients++; assert.equal(config.auth, 'FAKE_SECRET'); return drive } })
      const loader = createDriveSourceLoader({ drive: apiClient })
      await assert.rejects(step === 'list'
        ? loader.loadExperienceDescriptions('https://drive.google.com/drive/folders/student-folder')
        : loader.loadCv(cvUrl), expectSafeError(status === 500
          ? step === 'list' ? 'profile_drive_folder_unavailable' : 'profile_drive_download_failed'
          : 'profile_drive_access_denied'))
      assert.equal(requests, 1)
      assert.equal(clients, 1)
    }
  }
}

async function runIncompleteListingTests() {
  for (const repeatToken of [false, true]) {
    let pages = 0
    const drive = { files: {
      list: async () => {
        pages++
        if (pages === 2 && !repeatToken) throw new Error('PRIVATE_CONTENT FAKE_SECRET')
        return { data: { files: [], nextPageToken: 'same-page' } }
      }
    } }
    await assert.rejects(createDriveSourceLoader({ drive }).loadExperienceDescriptions(
      'https://drive.google.com/drive/folders/student-folder'),
    expectSafeError('profile_drive_folder_unavailable'))
    assert.equal(pages, 2, 'Do not return partial results or loop forever')
  }
}

export async function runDriveSourceTests() {
  runAuthTests()
  await runDownloadTests()
  await runFailureTests()
  await runIncompleteListingTests()
  const downloadedIds: string[] = []
  const listedParents: string[] = []
  const drive = {
    files: {
      list: async (input: { q: string; pageToken?: string; fields: string }) => {
        const parent = input.q.match(/^'([^']+)'/)?.[1] ?? ''
        assert.ok(input.fields.includes('nextPageToken'))
        listedParents.push(`${parent}:${input.pageToken ?? 'first'}`)
        // Both the target folder and a second experience file are on later pages.
        if (!input.pageToken) return { data: { files: parent === 'student-folder' ? [] : [
          { id: 'experience-first', name: 'Описание опыта 1.docx', mimeType: DOCX }
        ], nextPageToken: 'second' } }
        assert.equal(input.pageToken, 'second')
        return { data: { files: parent === 'student-folder' ? [
          { id: 'presentation-folder', name: 'Самопрезентация',
            mimeType: 'application/vnd.google-apps.folder' },
          { id: 'root-experience', name: 'Описание опыта.docx', mimeType: DOCX }
        ] : [
          { id: 'experience', name: 'Галина — описание опыта — final.docx', mimeType: DOCX,
            modifiedTime: '2026-09-08T00:00:00Z' },
          { id: 'presentation', name: 'Самопрезентация.docx', mimeType: DOCX,
            modifiedTime: '2026-09-08T00:00:00Z' }
        ] } }
      },
      get: async (input: { fileId: string; alt?: string }) => {
        if (input.alt === 'media') {
          downloadedIds.push(input.fileId)
          return { data: Buffer.from('document') }
        }
        return { data: { id: input.fileId, name: `${input.fileId}.docx`, mimeType: DOCX,
          modifiedTime: '2026-09-08T00:00:00Z', version: '1', size: 8 } }
      }
    }
  }

  const loader = createDriveSourceLoader({ drive })
  const documents = await loader.loadExperienceDescriptions(
    'https://drive.google.com/drive/folders/student-folder')

  assert.equal(documents.length, 2)
  assert.equal(documents[0].source, 'experience_description')
  assert.deepEqual(listedParents, ['student-folder:first', 'student-folder:second',
    'presentation-folder:first', 'presentation-folder:second'])
  assert.deepEqual(downloadedIds, ['experience-first', 'experience'])
  assert.deepEqual(await loader.loadExperienceDescriptions(), [])
}
