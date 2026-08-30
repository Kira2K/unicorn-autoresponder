type MetricClaim = { raw: string; value: string; unit: string; meaning: string }

const METRIC = /\d+(?:(?:[ ,]\d{3})+|[.,]\d+)?(?:\s*%|\s*x)?/gi

function normalizedValue(raw: string) {
  const compact = raw.toLowerCase().replace(/\s+/g, '')
  const numeric = compact.replace(/[%x]$/, '')
  const thousands = /^\d{1,3}(?:[ ,]\d{3})+$/.test(raw.trim())
  const decimalComma = /^\d+,\d{1,2}$/.test(numeric)
  const canonical = thousands ? numeric.replace(/[ ,]/g, '') :
    decimalComma ? numeric.replace(',', '.') : numeric.replace(/ /g, '')
  const parsed = Number(canonical)
  return Number.isFinite(parsed) ? String(parsed) : canonical
}

export function metricClaims(value: unknown): MetricClaim[] {
  const text = String(value ?? '')
  return [...text.matchAll(METRIC)].map(match => {
    const raw = match[0].trim(); const start = match.index ?? 0
    return {
      raw, value: normalizedValue(raw),
      unit: raw.includes('%') ? '%' : /x\s*$/i.test(raw) ? 'x' : '',
      meaning: text.slice(Math.max(0, start - 60), start + raw.length + 60).trim()
    }
  })
}

export function allowedExperienceMetrics(fact: any) {
  return metricClaims([
    ...(fact?.achievements ?? []), ...(fact?.responsibilities ?? []), fact?.evidence ?? ''
  ].join('\n'))
}

export function unsupportedMetrics(text: unknown, allowed: MetricClaim[]) {
  return metricClaims(text).filter(claim => !allowed.some(fact =>
    fact.value === claim.value && (!claim.unit || !fact.unit || fact.unit === claim.unit)))
}

export function allFactMetrics(facts: any) {
  return metricClaims(JSON.stringify(facts))
}

export function metricFactCount(facts: any) {
  return allFactMetrics(facts).length
}

export type { MetricClaim }
