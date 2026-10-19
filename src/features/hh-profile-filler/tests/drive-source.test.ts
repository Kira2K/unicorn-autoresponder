import assert from 'node:assert/strict'
import { createDriveSourceLoader } from '../drive-source.ts'
import { google } from 'googleapis'
import { createProfileDriveClient } from '../drive-client.ts'
import { ProfileFillerError } from '../errors.ts'
import http from 'node:http'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF = 'application/pdf'
const GOOGLE_DOC = 'application/vnd.google-apps.document'
const GOOGLE_FOLDER = 'application/vnd.google-apps.folder'
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
          if (step === 'list') return { data: { mimeType: GOOGLE_FOLDER } }
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
      get: async () => ({ data: { mimeType: GOOGLE_FOLDER } }),
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
  await runFolderAccessTests()
  await runResourceKeyTests()
  await runResourceKeyTransportTest()
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
        if (['student-folder', 'presentation-folder'].includes(input.fileId)) return { data: { mimeType: GOOGLE_FOLDER } }
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

async function runFolderAccessTests() {
  for (const status of [401, 403, 404, 500]) {
    let lists = 0
    const drive = { files: {
      get: async () => { throw Object.assign(new Error('FAKE_SECRET PRIVATE_CONTENT'), { response: { status } }) },
      list: async () => { lists++; return { data: { files: [] } } }
    } }
    await assert.rejects(createDriveSourceLoader({ drive }).loadExperienceDescriptions(
      'https://drive.google.com/drive/folders/student-folder'),
    expectSafeError(status === 500 ? 'profile_drive_folder_unavailable' : 'profile_drive_access_denied'))
    assert.equal(lists, 0, 'An inaccessible folder is not a successful empty search')
  }
  let lists = 0
  const readable = { files: {
    get: async () => ({ data: { mimeType: GOOGLE_FOLDER } }),
    list: async () => { lists++; return { data: { files: [] } } }
  } }
  assert.deepEqual(await createDriveSourceLoader({ drive: readable }).loadExperienceDescriptions(
    'https://drive.google.com/drive/folders/student-folder'), [])
  assert.equal(lists, 1, 'A readable empty folder remains valid')
  const notFolder = { files: { ...readable.files, get: async () => ({ data: { mimeType: PDF } }) } }
  await assert.rejects(createDriveSourceLoader({ drive: notFolder }).loadExperienceDescriptions(
    'https://drive.google.com/drive/folders/student-folder'), expectSafeError('profile_drive_format_unsupported'))
  assert.equal(lists, 1)
  const lostChild = { files: {
    get: async ({ fileId }: any) => {
      if (fileId !== 'student-folder') throw Object.assign(new Error('FAKE_SECRET'), { code: 404 })
      return { data: { mimeType: GOOGLE_FOLDER } }
    },
    list: async () => ({ data: { files: [{ id: 'presentation', name: 'Самопрезентация', mimeType: GOOGLE_FOLDER }] } })
  } }
  await assert.rejects(createDriveSourceLoader({ drive: lostChild }).loadExperienceDescriptions(
    'https://drive.google.com/drive/folders/student-folder'), expectSafeError('profile_drive_access_denied'))
}

async function runResourceKeyTests() {
  const header = (options: any) => options?.headers?.['X-Goog-Drive-Resource-Keys']
  for (const mimeType of [PDF, DOCX, GOOGLE_DOC]) {
    let expected: string | undefined = 'final-cv/FAKE_SECRET'
    const drive = { files: {
      get: async (input: any, options: any) => {
        assert.equal(header(options), expected)
        return { data: input.alt ? Buffer.from('CV!') : { mimeType, size: 3 } }
      },
      export: async (_input: any, options: any) => { assert.equal(header(options), expected); return { data: Buffer.from('CV!') } }
    } }
    const loader = createDriveSourceLoader({ drive })
    assert.equal((await loader.loadCv(cvUrl + '?resourcekey=FAKE_SECRET')).bytes.toString(), 'CV!')
    expected = undefined
    assert.equal((await loader.loadCv(cvUrl)).bytes.toString(), 'CV!', 'Keys must not leak between source reads')
  }
  let reads = 0
  const discoverKey = { files: { get: async (input: any, options: any) => {
    if (!input.alt) { assert.equal(header(options), undefined); return { data: { mimeType: PDF, resourceKey: 'FAKE_SECRET' } } }
    reads++; assert.equal(header(options), 'final-cv/FAKE_SECRET'); return { data: Buffer.from('CV!') }
  } } }
  await createDriveSourceLoader({ drive: discoverKey }).loadCv(cvUrl)
  assert.equal(reads, 1)
  for (const value of ['FAKE_SECRET%0d%0aInjected:yes', 'FAKE_SECRET%2Fother', 'FAKE_SECRET%2Cother']) {
    await assert.rejects(createDriveSourceLoader({ drive: { files: {} } }).loadCv(cvUrl + '?resourcekey=' + value),
      expectSafeError('profile_drive_url_invalid'))
  }
  const rootHeader = 'student-folder/root-key'
  const childHeader = rootHeader + ',presentation/child-key'
  const drive = { files: {
    get: async (input: any, options: any) => {
      const expected = input.fileId === 'student-folder' ? rootHeader : input.fileId === 'presentation' ? childHeader : childHeader + ',experience/FAKE_SECRET'
      assert.equal(header(options), expected)
      return { data: input.alt ? Buffer.from('experience') : { mimeType: ['student-folder', 'presentation'].includes(input.fileId) ? GOOGLE_FOLDER : DOCX } }
    },
    list: async (input: any, options: any) => {
      assert.ok(input.fields.includes('resourceKey'))
      const root = input.q.includes("'student-folder'")
      assert.equal(header(options), root ? rootHeader : childHeader)
      if (!input.pageToken) return { data: { files: [], nextPageToken: 'page-2' } }
      return { data: { files: root
        ? [{ id: 'presentation', name: 'Самопрезентация', mimeType: GOOGLE_FOLDER, resourceKey: 'child-key' }]
        : [{ id: 'experience', name: 'Описание опыта.docx', mimeType: DOCX, resourceKey: 'FAKE_SECRET' }] } }
    }
  } }
  const documents = await createDriveSourceLoader({ drive }).loadExperienceDescriptions(
    'https://drive.google.com/drive/folders/student-folder?resourcekey=root-key')
  assert.equal(documents.length, 1)
  assert.equal(documents[0].bytes.toString(), 'experience')
}

async function runResourceKeyTransportTest() {
  let requests = 0
  const server = http.createServer((request, response) => {
    requests++
    const url = new URL(request.url!, 'http://localhost')
    response.setHeader('Content-Type', 'application/json')
    if (request.headers['x-goog-drive-resource-keys'] !== 'final-cv/FAKE_SECRET') {
      response.statusCode = 404; response.end(JSON.stringify({ error: { message: 'FAKE_SECRET PRIVATE_CONTENT' } })); return
    }
    if (url.searchParams.get('alt') === 'media') response.end('CV!')
    else response.end(JSON.stringify({ id: 'final-cv', name: 'CV.pdf', mimeType: PDF, size: 3 }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const drive = createProfileDriveClient({ env: { GOOGLE_DRIVE_API_KEY: 'FAKE_SECRET' },
      createClient: config => google.drive({ ...config, rootUrl: `http://127.0.0.1:${address.port}/` }) })
    const loader = createDriveSourceLoader({ drive })
    const document = await loader.loadCv(cvUrl + '?resourcekey=FAKE_SECRET')
    assert.equal(document.bytes.toString(), 'CV!')
    await assert.rejects(loader.loadCv(cvUrl), expectSafeError('profile_drive_access_denied'))
    assert.equal(requests, 3)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}
