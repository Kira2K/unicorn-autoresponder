import { google } from 'googleapis'
import { codedError } from '../errors.ts'
import { driveFileId } from './drive-file-id.ts'
import type { CvDocument } from './types.ts'

const GOOGLE_DOC = 'application/vnd.google-apps.document'
const PDF = 'application/pdf'

function safeDriveError(error: any): never {
  const status = Number(error?.code ?? error?.response?.status)
  if ([401, 403, 404].includes(status)) throw codedError('profile_cv_access_denied',
    'The service account cannot read the final English CV.')
  throw codedError('profile_cv_download_failed', 'The final English CV could not be downloaded.')
}

export async function loadDriveCv(url: string, maxBytes: number,
  drive = google.drive({ version: 'v3', auth: new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  }) })) : Promise<CvDocument> {
  try {
    const fileId = driveFileId(url)
    const metadata = await drive.files.get({ fileId, fields: 'id,mimeType,modifiedTime,version,size' })
    const mimeType = String(metadata.data.mimeType ?? '')
    const size = Number(metadata.data.size ?? 0)
    if (size > maxBytes) throw codedError('profile_cv_too_large', 'The final English CV exceeds 20 MB.')
    let response
    if (mimeType === GOOGLE_DOC) response = await drive.files.export({ fileId, mimeType: PDF },
      { responseType: 'arraybuffer' })
    else if (mimeType === PDF) response = await drive.files.get({ fileId, alt: 'media' },
      { responseType: 'arraybuffer' })
    else throw codedError('profile_cv_format_unsupported', 'Only Google Docs and PDF CVs are supported.')
    const bytes = Buffer.from(response.data as ArrayBuffer)
    if (bytes.length > maxBytes) throw codedError('profile_cv_too_large', 'The final English CV exceeds 20 MB.')
    return { bytes, mimeType: PDF, fileName: 'final-en-cv.pdf',
      revision: String(metadata.data.version ?? metadata.data.modifiedTime ?? fileId) }
  } catch (error: any) {
    if (String(error?.code).startsWith('profile_cv_')) throw error
    return safeDriveError(error)
  }
}
