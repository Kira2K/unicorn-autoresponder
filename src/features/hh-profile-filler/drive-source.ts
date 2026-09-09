import { google } from 'googleapis'
import fs from 'node:fs'
import path from 'node:path'
import { profileFillerError } from './errors.ts'

export type SourceDocument = {
  bytes: Buffer
  fileName: string
  mimeType: 'application/pdf' |
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  revision: string
  source: 'cv' | 'self_presentation'
}

const GOOGLE_DOC = 'application/vnd.google-apps.document'
const PDF = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function driveId(value: string): string {
  try {
    const url = new URL(value)
    if (!['drive.google.com', 'docs.google.com'].includes(url.hostname)) throw new Error()
    const pathId = url.pathname.match(/\/(?:d|folders|file\/d)\/([\w-]+)/)?.[1]
    const id = pathId ?? url.searchParams.get('id') ?? ''
    if (!id) throw new Error()
    return id
  } catch {
    throw profileFillerError('profile_drive_url_invalid',
      'The Google Drive source URL is invalid.', 'load_sources')
  }
}

function safeName(value: unknown, fallback: string): string {
  const name = String(value ?? '').trim().replace(/[<>:"/\\|?*]/g, '-')
  return name || fallback
}

function normalizedTitle(value: unknown): string {
  return path.parse(String(value ?? '').trim()).name.toLowerCase().replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

export function createDriveSourceLoader(options: {
  maxBytes?: number
  drive?: any
} = {}) {
  const maxBytes = options.maxBytes ?? Number(process.env.HH_PROFILE_CV_MAX_BYTES ?? 20 * 1024 * 1024)
  const localCredentialCandidates = fs.readdirSync(process.cwd(), { withFileTypes: true })
    .filter(item => item.isFile() && /^project-.*\.json$/i.test(item.name))
    .map(item => path.resolve(process.cwd(), item.name))
  const credentialsFile = String(process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim() ||
    (localCredentialCandidates.length === 1 ? localCredentialCandidates[0] : undefined)
  const drive = options.drive ?? google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({
      keyFile: credentialsFile,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    })
  })

  async function download(fileId: string, source: SourceDocument['source']): Promise<SourceDocument> {
    let metadata: any
    try {
      metadata = await drive.files.get({ fileId,
        fields: 'id,name,mimeType,modifiedTime,version,size' })
    } catch (error: any) {
      const status = Number(error?.code ?? error?.response?.status)
      throw profileFillerError([401, 403, 404].includes(status)
        ? 'profile_drive_access_denied' : 'profile_drive_download_failed',
      'The Google Drive source cannot be read by the service account.', 'load_sources')
    }
    const mimeType = String(metadata.data.mimeType ?? '')
    const size = Number(metadata.data.size ?? 0)
    if (size > maxBytes) {
      throw profileFillerError('profile_drive_file_too_large',
        `Drive file ${fileId} exceeds the configured size limit.`, 'load_sources')
    }
    let response: any
    let outputMime: SourceDocument['mimeType']
    if (mimeType === GOOGLE_DOC) {
      response = await drive.files.export({ fileId, mimeType: PDF }, { responseType: 'arraybuffer' })
      outputMime = PDF
    } else if (mimeType === PDF || mimeType === DOCX) {
      response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
      outputMime = mimeType
    } else {
      throw profileFillerError('profile_drive_format_unsupported',
        `Unsupported Drive source format: ${mimeType || 'unknown'}.`, 'load_sources')
    }
    const bytes = Buffer.from(response.data as ArrayBuffer)
    if (bytes.length > maxBytes) {
      throw profileFillerError('profile_drive_file_too_large',
        `Drive file ${fileId} exceeds the configured size limit.`, 'load_sources')
    }
    const extension = outputMime === PDF ? '.pdf' : '.docx'
    const rawName = safeName(metadata.data.name, source)
    return {
      bytes,
      fileName: rawName.toLowerCase().endsWith(extension) ? rawName : `${rawName}${extension}`,
      mimeType: outputMime,
      revision: String(metadata.data.version ?? metadata.data.modifiedTime ?? fileId),
      source
    }
  }

  async function loadCv(url: string): Promise<SourceDocument> {
    return await download(driveId(url), 'cv')
  }

  async function loadSelfPresentations(folderUrl?: string): Promise<SourceDocument[]> {
    if (!folderUrl) return []
    const folderId = driveId(folderUrl)
    let response: any
    try {
      response = await drive.files.list({
        q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
        fields: 'files(id,name,mimeType,modifiedTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 100
      })
    } catch {
      throw profileFillerError('profile_drive_folder_unavailable',
        'The student Google Drive folder cannot be listed.', 'load_sources')
    }
    const matches = (response.data.files ?? []).filter((file: any) =>
      normalizedTitle(file.name) === 'самопрезентация')
    const documents: SourceDocument[] = []
    for (const file of matches) documents.push(await download(String(file.id), 'self_presentation'))
    return documents
  }

  return { loadCv, loadSelfPresentations }
}
