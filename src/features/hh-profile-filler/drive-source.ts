import path from 'node:path'
import { profileFillerError } from './errors.ts'
import { createProfileDriveClient } from './drive-client.ts'

export type SourceDocument = {
  bytes: Buffer
  fileName: string
  mimeType: 'application/pdf' |
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  revision: string
  source: 'cv' | 'experience_description'
}

const GOOGLE_DOC = 'application/vnd.google-apps.document'
const GOOGLE_FOLDER = 'application/vnd.google-apps.folder'
const PDF = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type DriveReference = { id: string; resourceKey?: string }

function driveReference(file: { id?: unknown; resourceKey?: unknown }): DriveReference {
  const id = String(file.id ?? '')
  const resourceKey = file.resourceKey ? String(file.resourceKey) : undefined
  if (!/^[\w-]+$/.test(id) || (resourceKey && !/^[\w-]+$/.test(resourceKey))) {
    throw profileFillerError('profile_drive_url_invalid',
      'The Google Drive source URL is invalid.', 'load_sources')
  }
  return { id, resourceKey }
}

function driveSource(value: string): DriveReference {
  try {
    const url = new URL(value)
    if (!['drive.google.com', 'docs.google.com'].includes(url.hostname)) throw new Error()
    const pathId = url.pathname.match(/\/(?:d|folders|file\/d)\/([\w-]+)/)?.[1]
    return driveReference({ id: pathId ?? url.searchParams.get('id'), resourceKey: url.searchParams.get('resourcekey') })
  } catch {
    throw profileFillerError('profile_drive_url_invalid',
      'The Google Drive source URL is invalid.', 'load_sources')
  }
}

function accessOptions(references: DriveReference[]) {
  const keys = new Map(references.filter(file => file.resourceKey).map(file => [file.id, file.resourceKey]))
  return keys.size ? { headers: { 'X-Goog-Drive-Resource-Keys': [...keys].map(([id, key]) => `${id}/${key}`).join(',') } } : {}
}

function safeName(value: unknown, fallback: string): string {
  const name = String(value ?? '').trim().replace(/[<>:"/\\|?*]/g, '-')
  return name || fallback
}

function normalizedTitle(value: unknown): string {
  return path.parse(String(value ?? '').trim()).name.toLowerCase().replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

function driveReadError(error: any, folder = false) {
  const status = Number(error?.response?.status ?? error?.code)
  return profileFillerError([401, 403, 404].includes(status)
    ? 'profile_drive_access_denied'
    : folder ? 'profile_drive_folder_unavailable' : 'profile_drive_download_failed',
  folder ? 'The Google Drive folder cannot be listed with the selected authorization.'
    : 'The Google Drive source cannot be read with the selected authorization.', 'load_sources')
}

export function createDriveSourceLoader(options: {
  maxBytes?: number
  drive?: any
} = {}) {
  const maxBytes = options.maxBytes ?? Number(process.env.HH_PROFILE_CV_MAX_BYTES ?? 20 * 1024 * 1024)
  const drive = options.drive ?? createProfileDriveClient()

  async function download(file: DriveReference, source: SourceDocument['source'], parents: DriveReference[] = []): Promise<SourceDocument> {
    const fileId = file.id
    let metadata: any
    try {
      metadata = await drive.files.get({ fileId,
        fields: 'id,name,mimeType,modifiedTime,version,size,resourceKey' }, accessOptions([...parents, file]))
    } catch (error) {
      throw driveReadError(error)
    }
    const mimeType = String(metadata.data.mimeType ?? '')
    const size = Number(metadata.data.size ?? 0)
    const access = accessOptions([...parents, driveReference({ id: fileId, resourceKey: file.resourceKey ?? metadata.data.resourceKey })])
    if (size > maxBytes) {
      throw profileFillerError('profile_drive_file_too_large',
        `Drive file ${fileId} exceeds the configured size limit.`, 'load_sources')
    }
    let response: any
    let outputMime: SourceDocument['mimeType']
    if (mimeType === GOOGLE_DOC) {
      outputMime = PDF
    } else if (mimeType === PDF || mimeType === DOCX) {
      outputMime = mimeType
    } else {
      throw profileFillerError('profile_drive_format_unsupported',
        `Unsupported Drive source format: ${mimeType || 'unknown'}.`, 'load_sources')
    }
    try {
      response = mimeType === GOOGLE_DOC
        ? await drive.files.export({ fileId, mimeType: PDF }, { ...access, responseType: 'arraybuffer' })
        : await drive.files.get({ fileId, alt: 'media' }, { ...access, responseType: 'arraybuffer' })
    } catch (error) {
      throw driveReadError(error)
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
    return await download(driveSource(url), 'cv')
  }

  async function loadExperienceDescriptions(folderUrl?: string): Promise<SourceDocument[]> {
    if (!folderUrl) return []
    async function listChildren(folder: DriveReference, parents: DriveReference[] = []) {
      let metadata: any
      // A search by parent may succeed with [] even when the parent itself is inaccessible.
      try {
        metadata = await drive.files.get({ fileId: folder.id, fields: 'id,mimeType,resourceKey' }, accessOptions([...parents, folder]))
      } catch (error) {
        throw driveReadError(error, true)
      }
      if (metadata.data.mimeType !== GOOGLE_FOLDER) {
        throw profileFillerError('profile_drive_format_unsupported',
          'The Google Drive source is not a folder.', 'load_sources')
      }
      const parent = driveReference({ id: folder.id, resourceKey: folder.resourceKey ?? metadata.data.resourceKey })
      const access = accessOptions([...parents, parent])
      try {
        const files: any[] = []
        const seenTokens = new Set<string>()
        let pageToken: string | undefined
        do {
          const response = await drive.files.list({
            q: `'${parent.id}' in parents and trashed = false`,
            fields: 'files(id,name,mimeType,modifiedTime,resourceKey),nextPageToken',
            orderBy: 'modifiedTime desc',
            pageSize: 100,
            ...(pageToken ? { pageToken } : {})
          }, access)
          files.push(...(response.data.files ?? []))
          pageToken = response.data.nextPageToken || undefined
          if (pageToken) {
            if (seenTokens.has(pageToken)) throw new Error('Repeated Drive page token')
            seenTokens.add(pageToken)
          }
        } while (pageToken)
        return { parent, files }
      } catch (error) {
        throw driveReadError(error, true)
      }
    }

    const root = await listChildren(driveSource(folderUrl))
    const presentationFolders = root.files.filter((file: any) =>
      file.mimeType === GOOGLE_FOLDER && normalizedTitle(file.name) === 'самопрезентация')
    const matches: Array<{ file: DriveReference; parents: DriveReference[] }> = []
    for (const folder of presentationFolders) {
      const children = await listChildren(driveReference(folder), [root.parent])
      matches.push(...children.files.filter((file: any) =>
        file.mimeType !== GOOGLE_FOLDER && normalizedTitle(file.name).includes('описание опыта'))
        .map((file: any) => ({ file: driveReference(file), parents: [root.parent, children.parent] })))
    }
    const documents: SourceDocument[] = []
    for (const match of matches) {
      documents.push(await download(match.file, 'experience_description', match.parents))
    }
    return documents
  }

  return { loadCv, loadExperienceDescriptions }
}
