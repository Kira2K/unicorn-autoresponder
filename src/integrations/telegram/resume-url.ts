/** Validate format only; preserve the submitted URL spelling and never fetch the document. */
export function isResumeUrl(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!/^https?:\/\//i.test(text) || /[\s\u0000-\u001f\u007f<>\\]/u.test(text)) return false
  try {
    const url = new URL(text)
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname
  } catch { return false }
}
