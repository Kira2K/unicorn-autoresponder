import type { Position } from '../types.ts'

/** Observation labels are kept separately; no requirements, numbers or arbitrary sentences are removed. */
export function postingContent(raw: string) {
  const publicationLabels: string[] = []
  const description = raw.split(/\r?\n/).filter(line => {
    if (!/^(?:posted|published)\s+(?:\d+\+?\s+(?:minutes?|hours?|days?|weeks?|months?)\s+ago|today|yesterday)\.?$/i.test(line.trim())) return true
    publicationLabels.push(line.trim())
    return false
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { description, publicationLabels }
}

/** Date evidence and arithmetic only. Eligibility policy is authored in the selection skill. */
export function publicationContext(position: Pick<Position, 'description' | 'publicationLabels' | 'publicationDates' | 'publishedAt' | 'retrievedAt'>, now = new Date()) {
  const date = (value?: string) => {
    if (!value) return undefined
    // Explicit named-month dates are unambiguous; numeric locale dates still
    // require review. Keep UTC calendar validation below, including leap days.
    const named=/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(value.trim())
    if(named){const month=['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(named[1].toLowerCase())+1;value=`${named[3]}-${String(month).padStart(2,'0')}-${named[2].padStart(2,'0')}`}
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value)
    if (!match) return undefined
    const [year, month, day] = match.slice(1).map(Number), strict = new Date(Date.UTC(year, month - 1, day))
    if (strict.getUTCFullYear() !== year || strict.getUTCMonth() !== month - 1 || strict.getUTCDate() !== day) return undefined
    if (value.length > 10) {
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return undefined
      const instant=Date.parse(value);if(!Number.isFinite(instant))return undefined
      return new Date(instant).toISOString().slice(0,10)
    }
    return `${match[1]}-${match[2]}-${match[3]}`
  }
  const labels = [...new Set([...(position.publicationLabels ?? []), ...postingContent(position.description).publicationLabels,
    ...position.description.split(/\r?\n/).map(s=>s.trim()).filter(s=>/^(?:(?:date posted|publication date)\b|(?:posted|published)(?:\s*:|\s+(?:on\s+)?(?:\d|today\b|yesterday\b|recently\b|last\b|this\b|Jan(?:uary)?\b|Feb(?:ruary)?\b|Mar(?:ch)?\b|Apr(?:il)?\b|May\b|Jun(?:e)?\b|Jul(?:y)?\b|Aug(?:ust)?\b|Sep(?:tember)?\b|Oct(?:ober)?\b|Nov(?:ember)?\b|Dec(?:ember)?\b))|опубликован[ао]?\s|дата публикации)/i.test(s))])].sort()
  const explicit = [...new Set([...(position.publicationDates ?? []), ...(position.publishedAt ? [position.publishedAt] : [])])]
  const evidence = [...labels, ...explicit]
  const asOfDate = now.toISOString().slice(0,10), observedAt = labels.length ? date(position.retrievedAt) : undefined
  const days: string[] = []
  let invalid = false, ambiguous = false
  for (const value of explicit) {
    const day = date(value)
    if (day) days.push(day)
    else invalid = true
  }
  for (const label of labels) {
    const relative = /^(?:posted|published)\s+(?:(\d+)\s+days?\s+ago|(today)|(yesterday))\.?$/i.exec(label)
    if (relative && observedAt) {
      const value = new Date(Date.parse(observedAt) - Number(relative[1] ?? (relative[3] ? 1 : 0)) * 86400000)
      if (Number.isFinite(value.getTime())) days.push(value.toISOString().slice(0,10))
      else invalid = true
      continue
    }
    const absolute = /^(?:(?:date posted|posted|published|publication date)\s*:?\s*(?:on\s+)?)(\d{4}-\d{2}-\d{2}(?:T\S+)?|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\.?$/i.exec(label)
    if (absolute) { const day = date(absolute[1]); if (day) days.push(day); else invalid = true; continue }
    ambiguous = true
  }
  const unique = [...new Set(days)], publicationDate = unique.length === 1 ? unique[0] : undefined
  const ageDays = publicationDate ? (Date.parse(asOfDate) - Date.parse(publicationDate)) / 86400000 : undefined
  const status = invalid ? 'invalid' as const : unique.length > 1 ? 'contradictory' as const : ambiguous || Boolean(evidence.length && !publicationDate) ? 'ambiguous' as const
    : ageDays !== undefined && ageDays < 0 ? 'future' as const : publicationDate ? 'valid' as const : 'missing' as const
  return { asOfDate, observedAt, publishedAt: position.publishedAt, evidence, publicationDate, ageDays, status }
}
