import { createHash } from 'node:crypto'
import { PostError, object } from './errors.ts'
import type { JsonFiles } from './json-files.ts'
import type { Context } from './writer-types.ts'
import type { FactsExtractor } from './source-types.ts'
import { FACTS_VERSION } from './fact-instructions.ts'
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const PDF = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export type StoredCv = { data: string; mimeType: string; fileName: string; revision: string }
export function parseCvUpload(value: unknown): StoredCv {
  const input = object(value)
  if (typeof input.data !== 'string' || input.data.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 ||
    input.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(input.data)) {
    throw new PostError('post_cv_size_or_encoding_invalid')
  }
  const bytes = Buffer.from(input.data, 'base64')
  if (bytes.toString('base64') !== input.data) throw new PostError('post_cv_size_or_encoding_invalid')
  const pdf = input.mimeType === PDF && bytes.subarray(0, 5).toString() === '%PDF-'
  const docx = input.mimeType === DOCX && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])) &&
    bytes.includes(Buffer.from('[Content_Types].xml')) && bytes.includes(Buffer.from('word/document.xml'))
  if ((!pdf && !docx) || !bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new PostError('post_cv_format_invalid')
  return { data: input.data, mimeType: pdf ? PDF : DOCX, fileName: pdf ? 'cv.pdf' : 'cv.docx',
    revision: createHash('sha256').update(bytes).digest('hex') }
}
export function createCvFiles(store: JsonFiles, extract: FactsExtractor) {
  const pending = new Map<string, Promise<Context>>()
  return {
    async uploadCv(value: unknown) {
      const document = parseCvUpload(value)
      if (!await store.get('cv', document.revision)) await store.put('cv', document.revision, document)
      return document.revision
    },
    async uploadedContext(reference: string, previous?: Context): Promise<Context> {
      if (!/^[a-f0-9]{64}$/.test(reference)) throw new PostError('post_cv_reference_invalid')
      if (previous?.revision === reference && previous.factsVersion === FACTS_VERSION) return structuredClone(previous)
      const cached = await store.get<Context>('facts', reference)
      if (cached?.factsVersion === FACTS_VERSION) return cached
      let task = pending.get(reference)
      if (!task) {
        task = (async () => {
          const doc = await store.get<StoredCv>('cv', reference)
          if (!doc) throw new PostError('post_cv_missing')
          const context = { ...await extract({ ...doc, bytes: Buffer.from(doc.data, 'base64') }),
            revision: reference, factsVersion: FACTS_VERSION }
          await store.put('facts', reference, context)
          return context
        })().finally(() => pending.delete(reference))
        pending.set(reference, task)
      }
      return structuredClone(await task)
    }
  }
}
