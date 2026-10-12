import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectPdf } from '../../application_preparation/pdf.ts'

/** Test-only comparison signals. Substantive relevance and layout still require the test review. */
export function compareTailoring(original: { textHash: string }, result: { textHash: string }, descriptionHash: string, previous: { textHash: string; descriptionHash: string }[] = []) {
  return {
    unchangedText: original.textHash === result.textHash,
    repeatedAcrossDifferentDescriptions: previous.some(p => p.descriptionHash !== descriptionHash && p.textHash === result.textHash),
  }
}

/** Local test evidence; never called by production CV acceptance. */
export async function renderReviewPdf(path: string, output: string, prefix: string) {
  const bytes = await readFile(path), inspection = await inspectPdf(bytes)
  const { createCanvas } = await import('@napi-rs/canvas')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }), pdf = await task.promise
  await mkdir(output, { recursive: true })
  const previews: string[] = []
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1.5 })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({ canvas: canvas as any, canvasContext: canvas.getContext('2d') as any, viewport }).promise
      const image = join(output, `${prefix}-${n}.png`)
      await writeFile(image, canvas.toBuffer('image/png')); previews.push(image); page.cleanup()
    }
    await writeFile(join(output, `${prefix}-text.txt`), inspection.text)
    return { ...inspection, previews }
  } finally { await task.destroy() }
}
