const skillKey = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLowerCase()

function uniqueSkills(values: unknown[]) {
  const seen = new Set<string>()
  return values.flatMap(value => {
    if (typeof value !== 'string') return []
    const key = skillKey(value)
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [value]
  })
}

export function reconcileSkillCandidates(candidates: unknown, attachedGroups: unknown[]) {
  if (!Array.isArray(candidates)) return candidates
  const limit = candidates.length
  const attached = uniqueSkills(attachedGroups.flatMap(value => Array.isArray(value) ? value : []))
  return uniqueSkills([...attached, ...candidates]).slice(0, limit)
}
