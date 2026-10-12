/** Whitespace-only equivalence; return the original contiguous source span, never a fuzzy quote. */
export function evidenceSpan(quote: string, fields: (string | undefined)[]): string | undefined {
  if (!quote.trim()) return undefined
  const parts = quote.trim().split(/\s+/u)
  const pattern = parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:\\s|&nbsp;|&#0*160;|&#[xX]0*[aA]0;)+')
  for (const field of fields) {
    if (!field) continue
    if (field.includes(quote)) return quote
    const match = new RegExp(pattern, 'u').exec(field)
    if (match) return match[0]
  }
  return undefined
}
