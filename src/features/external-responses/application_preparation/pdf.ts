import { createHash } from 'node:crypto'
import { assertAllowedUrl } from '../infrastructure/navigation-policy.ts'

/** Local structural/readability validation. No AI, semantic scoring or visual approval. */
export async function inspectPdf(bytes: Buffer) {
  if (bytes.length > 15 * 1024 * 1024 || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw Error('invalid_pdf')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 })
  const pdf = await task.promise
  try {
    if (!pdf.numPages || pdf.numPages > 100) throw Error('invalid_pdf_page_count')
    const pages: string[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), content = await page.getTextContent()
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' ')); page.cleanup()
    }
    const text = pages.join('\n\n'), normalized = text.replace(/\s+/g, ' ').trim()
    if (normalized.length < 80) throw Error('pdf_has_no_readable_resume_text')
    return { pages: pdf.numPages, text, textHash: createHash('sha256').update(normalized).digest('hex') }
  } finally { await task.destroy() }
}

export async function downloadPdf(url: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  let current = url
  for (let i = 0; i < 5; i++) {
    assertAllowedUrl(current)
    const parsed = new URL(current)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(parsed.hostname)) throw Error('unsafe_tailored_document_url')
    const response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(60000) })
    if ([301, 302, 303, 307, 308].includes(response.status)) { current = new URL(response.headers.get('location') ?? '', current).href; await response.body?.cancel(); continue }
    if (!response.ok || !response.body) throw Error(`tailored_download_failed:${response.status}`)
    const parts: Uint8Array[] = []; let size = 0
    for await (const part of response.body as any as AsyncIterable<Uint8Array>) { size += part.length; if (size > 15 * 1024 * 1024) throw Error('tailored_pdf_too_large'); parts.push(part) }
    return Buffer.concat(parts)
  }
  throw Error('tailored_download_redirect_limit')
}
