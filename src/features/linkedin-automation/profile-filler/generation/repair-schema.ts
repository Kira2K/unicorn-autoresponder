import type { ValidationIssue } from '../input-types.ts'
import { strictObject } from './schema-helpers.ts'
import { GENERATED_PROFILE_SCHEMA } from './profile-schema.ts'
import { isObject } from '../validation/shared.ts'
import { normalizedEntries } from './entry-additions.ts'

const available = (GENERATED_PROFILE_SCHEMA.properties.profile as {
  properties: Record<string, unknown>
}).properties

const sectionName = (path: string) => {
  const section = path.match(/^profile\.([a-z_]+)/)?.[1]
  return section === 'about' ? 'about_blocks' : section
}

export function repairSections(issues: ValidationIssue[]) {
  return [...new Set(issues.map(issue => sectionName(issue.path)).filter(section =>
    section && available[section]))] as string[]
}

export function repairSchema(sections: string[]) {
  return strictObject({ profile: strictObject(Object.fromEntries(
    sections.map(section => [section, available[section]]))) })
}

export function mergeRepair(document: unknown, repaired: unknown, sections: string[],
  allowedIds?: Record<string, string[]>) {
  const result = structuredClone(isObject(document) ? document : {})
  const profile = isObject(result.profile) ? result.profile : {}
  result.profile = profile
  const repair = isObject(repaired) && isObject(repaired.profile) ? repaired.profile : {}
  for (const section of sections) {
    const replacement = repair[section]
    if (replacement === undefined) continue
    if (['experience', 'education'].includes(section) && Array.isArray(replacement)) {
      const existing = normalizedEntries(profile[section])
      const additions = normalizedEntries(replacement)
      const allowed = allowedIds?.[section] && new Set(allowedIds[section])
      const replaced = new Set(additions.map(item => item.fact_id))
      const retained = existing.filter(item => !replaced.has(item.fact_id) &&
        (!allowed || typeof item.fact_id === 'string' && allowed.has(item.fact_id)))
      // Keep every returned entry: validation must see duplicate and unknown IDs.
      profile[section] = [...retained, ...additions]
    } else profile[section] = replacement
  }
  return result
}
