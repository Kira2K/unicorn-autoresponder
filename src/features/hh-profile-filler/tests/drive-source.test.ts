import assert from 'node:assert/strict'
import { createDriveSourceLoader } from '../drive-source.ts'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export async function runDriveSourceTests() {
  const downloadedIds: string[] = []
  const listedParents: string[] = []
  const drive = {
    files: {
      list: async (input: { q: string }) => {
        const parent = input.q.match(/^'([^']+)'/)?.[1] ?? ''
        listedParents.push(parent)
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

  assert.equal(documents.length, 1)
  assert.equal(documents[0].source, 'experience_description')
  assert.deepEqual(listedParents, ['student-folder', 'presentation-folder'])
  assert.deepEqual(downloadedIds, ['experience'])
}
