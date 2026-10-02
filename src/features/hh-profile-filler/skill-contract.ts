import { strictSkillsCheck } from './contract.ts'
import { profileFillerError } from './errors.ts'

export type SavedSkills = { tags: string[]; advanced: string[] }
export async function ensureThirtyAdvanced(operations: {
  read(): Promise<SavedSkills>
  saveTags(tags: string[]): Promise<void>
  saveAdvanced(tags: string[]): Promise<void>
  same(left: string, right: string): boolean
}, sourceSkills: string[]): Promise<SavedSkills> {
  const before = await operations.read()
  if (strictSkillsCheck(before.tags, before.advanced).status === 'passed') return before
  const wanted = [...before.tags]
  for (const value of sourceSkills) {
    if (wanted.length === 30) break
    if (!wanted.some(current => operations.same(current, value))) wanted.push(value)
  }
  if (wanted.length !== 30) throw profileFillerError('profile_hh_thirty_skills_unavailable',
    'Exactly 30 source-supported skills are required; no skills were invented.', 'fill_skills')
  const preserves = (saved: string[], previous: string[]) => previous.every(tag =>
    saved.some(value => operations.same(tag, value)))
  const restore = async (tags: string[]) => {
    await operations.saveTags(tags)
    if (!preserves((await operations.read()).tags, tags)) throw profileFillerError(
      'profile_hh_skill_restore_failed', 'HH lost existing skills and restoration failed.', 'restore_skills')
  }
  await operations.saveTags([...before.tags, ...sourceSkills])
  const expanded = await operations.read()
  if (expanded.tags.length !== 30 || !preserves(expanded.tags, before.tags)) {
    if (!preserves(expanded.tags, before.tags)) await restore(before.tags)
    throw profileFillerError('profile_hh_thirty_skills_not_persisted',
      'HH did not persist exactly 30 skills while preserving existing tags.', 'verify_skills')
  }
  let levelError: unknown
  try { await operations.saveAdvanced(expanded.tags) } catch (error) { levelError = error }
  const after = await operations.read()
  if (!preserves(after.tags, expanded.tags)) {
    await restore(expanded.tags)
    throw profileFillerError('profile_hh_levels_reduced_skills',
      'HH discarded skills when saving levels; tags were restored and filling stopped.', 'verify_skills')
  }
  if (levelError) throw levelError
  if (strictSkillsCheck(after.tags, after.advanced).status !== 'passed') throw profileFillerError(
    'profile_hh_advanced_skills_not_persisted', 'All 30 saved skills must have Advanced level.', 'verify_skills')
  return after
}
