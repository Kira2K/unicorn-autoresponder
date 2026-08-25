import type { ValidationIssue } from '../input-types.ts'
import { strictObject } from './schema-helpers.ts'
import { GENERATED_PROFILE_SCHEMA } from './profile-schema.ts'

const sectionName = (path: string) => {
  const section = path.match(/^profile\.([a-z_]+)/)?.[1]
  return section === 'about' ? 'about_blocks' : section
}

export function repairSections(issues: ValidationIssue[]) {
  const available = (GENERATED_PROFILE_SCHEMA as any).properties.profile.properties
  return [...new Set(issues.map(issue => sectionName(issue.path)).filter(section =>
    section && available[section]))] as string[]
}

export function repairSchema(sections: string[]) {
  const available = (GENERATED_PROFILE_SCHEMA as any).properties.profile.properties
  return strictObject({ profile: strictObject(Object.fromEntries(
    sections.map(section => [section, available[section]]))) })
}

export function mergeRepair(document: any, repaired: any, sections: string[]) {
  const result = structuredClone(document)
  for (const section of sections) {
    const target = section === 'about_blocks' ? 'about' : section
    if (repaired?.profile?.[target] !== undefined) result.profile[target] = repaired.profile[target]
  }
  return result
}
