const SENIORITY = new Set(['junior', 'senior', 'lead', 'principal', 'staff'])

const words = (value: string) => value.replace(/\([^)]*\)/g, ' ')
  .replace(/[^a-zA-Z+#.]+/g, ' ').trim().split(/\s+/).filter(Boolean)

export function jobTitleQueries(value: string) {
  const source = words(value)
  const lower = source.map(word => word.toLowerCase())
  const withoutSeniority = source.filter((_, index) => !SENIORITY.has(lower[index])).join(' ')
  let broad = ''
  if (lower.includes('backend') && lower.includes('developer')) broad = 'Backend Developer'
  else if (lower.includes('backend')) broad = 'Backend Engineer'
  else if (lower.includes('developer')) broad = 'Software Developer'
  else if (lower.includes('engineer')) broad = 'Software Engineer'
  const generic = lower.some(word => ['developer', 'engineer'].includes(word))
    ? 'Software Engineer' : ''
  const candidates = [value.trim(), source.join(' '), withoutSeniority, broad, generic]
  return [...new Set(candidates.filter(Boolean).map(item => item.replace(/\s+/g, ' ')))].slice(0, 5)
}

export function jobTitleCatalogQueries(values: string[]) {
  const queries = values.flatMap(value => {
    const valueWords = words(value).map(word => word.toLowerCase())
    if (valueWords.some(word => ['backend', 'golang', 'go'].includes(word))) {
      return ['Backend Engineer']
    }
    if (valueWords.some(word => ['frontend', 'front-end'].includes(word))) {
      return ['Frontend Developer']
    }
    if (valueWords.includes('data')) return ['Data Engineer']
    if (valueWords.some(word => ['qa', 'quality', 'test'].includes(word))) return ['QA Engineer']
    if (valueWords.includes('devops')) return ['DevOps Engineer']
    return ['Software Engineer']
  })
  return [...new Set([...queries, 'Software Engineer', 'Software Developer'])].slice(0, 3)
}
