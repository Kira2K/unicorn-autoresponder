import type { ProfileInput } from './input-types.ts'
import type { ProfileClient, ProfilePlan, PlanSection } from './plan-types.ts'
import type { ProfileLogger } from './profile-logger.ts'
import { buildProfilePlan, orderProfileSteps } from './planner.ts'
import { codedError } from './errors.ts'
import { parameterSearchKey, type ParameterSearchCache, type SearchType } from './parameter-search.ts'
import { bindEntryTargets } from './entry-bindings.ts'
import { planningSnapshot } from './planning-snapshot.ts'
import { specifics } from './profile-data.ts'

export async function rebuildFieldPlan(client: ProfileClient, plan: ProfilePlan, input: ProfileInput,
  changedSection: string, logger: ProfileLogger, changedPath: string,
  disabledFields: string[] = plan.disabledFields ?? []): Promise<ProfilePlan> {
  // Entry Skills and the profile Skill total are one dependency group; basic fields are independent.
  const scope: PlanSection[] = ['experience', 'education', 'skills'].includes(changedSection)
    ? ['experience', 'education', 'skills'] : [changedSection as PlanSection]
  const relevant = (path: string) => scope.some(section => path === `profile.${section}` ||
    path.startsWith(`profile.${section}.`) || path.startsWith(`profile.${section}[`))
  const desired: ProfileInput = { schemaVersion: 1, experience: [], education: [],
    skills: { add: [], targetCount: 100 } }
  const keys = { headline: 'headline', about: 'about', experience: 'experience', education: 'education',
    skills: 'skills', open_to_work: 'openToWork' } as const
  for (const section of scope) Object.assign(desired, { [keys[section]]: structuredClone(input[keys[section]]) })
  const selectionOnly = changedPath === ''
  const cached = selectionOnly && plan.planning &&
    (plan.planning.profile.provider_id ?? plan.planning.profile.id) ? plan.planning.profile : undefined
  const refreshed = selectionOnly && !cached
    ? ['experience', 'education', 'skills', 'open_to_work'] : scope
  const sections = refreshed.filter(section => !['headline', 'about'].includes(section)).map(section => `linkedin_${section}`)
  const profile = cached ? structuredClone(cached)
    : await client.getOwnProfile(plan.account.accountId, sections, { fresh: true })
  if (String(profile.provider_id ?? profile.id ?? '') !== plan.account.providerId) {
    throw codedError('linkedin_provider_id_mismatch', 'Аккаунт LinkedIn изменился. Правка не сохранена.')
  }
  const original = bindEntryTargets(plan.input!, plan.planning?.profile ?? {
    ...profile, specifics: { ...specifics(profile), ...plan.entryPolicy }
  }, plan.steps)
  for (const group of ['experience', 'education'] as const) desired[group].forEach((entry, index) => {
    entry.match = structuredClone(original[group][index].match)
  })
  const cache: ParameterSearchCache = structuredClone(plan.planning?.parameters ?? {})
  const seed = (type: SearchType, value?: string, found?: { id?: string; name: string }) => {
    if (value && found) cache[parameterSearchKey(type, value)] = found.id ? [{ id: found.id, name: found.name }] : []
  }
  for (const { data } of plan.input!.experience) {
    seed('COMPANY', data.company, data.catalog?.company)
    seed('JOB_TITLE', data.jobTitle, data.catalog?.jobTitle)
    seed('LOCATION', data.location, data.catalog?.location)
  }
  for (const { data } of plan.input!.education) seed('SCHOOL', data.school, data.catalog?.school)
  // Keep source warnings and safety errors; only the edited field can resolve its source issue.
  const sourceIssues = (plan.validationIssues ?? plan.issues).filter(issue => issue.path !== changedPath &&
    !issue.path.startsWith(`${changedPath}[`) && !issue.path.startsWith(`${changedPath}.`))
  const omitted = plan.issues.filter(issue => issue.path === 'profile.skills.omitted' &&
    !changedPath.endsWith('.skills') && changedPath !== 'profile.skills.add')
  const rebuilt = await buildProfilePlan(client, plan.account, desired, profile,
    [...sourceIssues.filter(issue => relevant(issue.path)), ...omitted], logger, cache, disabledFields)
  const steps = [...plan.steps.filter(step => !scope.includes(step.section)), ...rebuilt.steps].sort(orderProfileSteps)
  const merged: ProfilePlan = { ...plan, input: structuredClone(plan.input!), steps, disabledFields,
    planning: { profile: cached ? structuredClone(cached)
      : planningSnapshot(profile, plan.planning?.profile, refreshed), parameters: structuredClone(cache) },
    validationIssues: sourceIssues,
    issues: [...new Map([...plan.issues.filter(issue => !relevant(issue.path)), ...rebuilt.issues]
      .map(issue => [JSON.stringify(issue), issue])).values()],
    skippedChanges: [...(plan.skippedChanges ?? []).filter(path => !relevant(path)), ...(rebuilt.skippedChanges ?? [])],
    entryPolicy: { ...plan.entryPolicy, ...rebuilt.entryPolicy },
    snapshot: { capturedAt: new Date().toISOString(), values: { ...plan.snapshot.values, ...rebuilt.snapshot.values } } }
  for (const section of scope) Object.assign(merged.input!, { [keys[section]]: rebuilt.input![keys[section]] })
  if (scope.includes('skills')) {
    merged.skillPolicy = rebuilt.skillPolicy
    for (const section of ['experience', 'education'] as const) {
      if (!rebuilt.entryPolicy?.[section]) delete merged.entryPolicy![section]
    }
  }
  return merged
}
