import type { CvProfile } from './types.ts'
import { profileFillerError } from './errors.ts'

export const REQUIRED_HH_SKILLS = 30
export const ADVANCED_HH_SKILL_LEVEL = 'advanced'

export function skillKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

// Preserve category order: first item of each group, then second, and so on.
// Ungrouped CV skills and explicit experience technologies supply any remainder.
export function orderedSkillCandidates(cv: Pick<CvProfile, 'skillGroups' | 'skills' | 'experience'>): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const add = (value: string) => {
    const name = value.trim().replace(/\s+/g, ' ')
    const key = skillKey(name)
    if (key && !seen.has(key)) { seen.add(key); result.push(name) }
  }
  const groups = cv.skillGroups.map(group => group.items)
  for (let index = 0; index < Math.max(0, ...groups.map(items => items.length)); index += 1) {
    for (const items of groups) if (items[index]) add(items[index])
  }
  cv.skills.forEach(add)
  cv.experience.flatMap(item => item.technologies).forEach(add)
  return result
}

export function requiredSkillSet(cv: Pick<CvProfile, 'skillGroups' | 'skills' | 'experience'>): string[] {
  const candidates = orderedSkillCandidates(cv)
  if (candidates.length < REQUIRED_HH_SKILLS) throw profileFillerError(
    'profile_hh_skills_source_insufficient',
    `The CV provides ${candidates.length} unique skills; ${REQUIRED_HH_SKILLS} are required.`, 'validate_skills')
  return candidates.slice(0, REQUIRED_HH_SKILLS)
}

export type SavedSkill = { name: string; level: string | null }

export function assertCompleteSkills(actual: SavedSkill[], expected: string[]): void {
  const expectedKeys = new Set(expected.map(skillKey))
  const actualKeys = new Set(actual.map(item => skillKey(item.name)))
  if (expected.length !== REQUIRED_HH_SKILLS || expectedKeys.size !== REQUIRED_HH_SKILLS ||
      actual.length !== REQUIRED_HH_SKILLS || actualKeys.size !== REQUIRED_HH_SKILLS ||
      [...expectedKeys].some(key => !actualKeys.has(key)) ||
      actual.some(item => item.level !== ADVANCED_HH_SKILL_LEVEL)) throw profileFillerError(
    'profile_hh_skills_incomplete',
    'Every resume must contain exactly 30 distinct source-selected skills, all Advanced.', 'verify_skills')
}
