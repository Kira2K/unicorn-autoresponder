import type { JsonObject, ProfileInput, ValidationIssue } from './input-types.ts'
import type { ProfileAccount, ProfileClient, ProfilePlan } from './plan-types.ts'
import { planBasic } from './planners/basic.ts'
import { planEducation } from './planners/education.ts'
import { planExperience } from './planners/experience.ts'
import { planOpenToWork } from './planners/open-to-work.ts'
import { planSkills } from './planners/skills.ts'
import { validatePlanPayloads } from './payload-contract.ts'
import type { ProfileLogger } from './profile-logger.ts'
import { createEntrySkillBudget } from './entry-skill-budget.ts'
import { MCP_WRITE_ORDER } from './mcp-contract.ts'
import { resolveProfileCatalog } from './catalog-resolution.ts'
import type { ParameterSearchCache } from './parameter-search.ts'
import { selectProfileSkills } from './skill-selection.ts'
import { name, section } from './profile-data.ts'
import { captureApprovedEntries } from './approved-state.ts'
import { readyChanges } from './partial-plan.ts'
import { comparisonValues } from './comparison-values.ts'
import { fieldDisabled, selectedEntriesInput } from './field-selection.ts'
import { bindEntryTargets } from './entry-bindings.ts'
import { planningSnapshot } from './planning-snapshot.ts'

function position(step: { section: string; action: string }) {
  const key = ['experience', 'education'].includes(step.section)
    ? `${step.section}-${step.action}` : step.section
  return MCP_WRITE_ORDER.findIndex(value => value === key)
}
export const orderProfileSteps = (left: { section: string; action: string }, right: { section: string; action: string }) =>
  position(left) - position(right)

export async function buildProfilePlan(
  client: ProfileClient, account: ProfileAccount, desired: ProfileInput,
  current: JsonObject, validationIssues: ValidationIssue[], logger?: ProfileLogger,
  parameterCache?: ParameterSearchCache, disabledFields: string[] = []
): Promise<ProfilePlan> {
  const issues = structuredClone(validationIssues.filter(issue => !fieldDisabled(disabledFields, issue.path)))
  const cache = parameterCache ?? {}
  const catalog = bindEntryTargets(await resolveProfileCatalog({ client, accountId: account.accountId,
    desired, issues, logger, parameterCache: cache }), current)
  const resolved = selectProfileSkills(catalog, current, issues, disabledFields)
  if (disabledFields.includes('profile.headline')) delete resolved.headline
  if (disabledFields.includes('profile.about')) delete resolved.about
  const skillBudget = createEntrySkillBudget(current)
  const planned = [
    ...planBasic(resolved, current, issues),
    ...planExperience(resolved, current, issues, skillBudget, disabledFields),
    ...planEducation(resolved, current, issues, skillBudget, disabledFields),
    ...planSkills(resolved, current, issues),
    ...await planOpenToWork(client, account.accountId, resolved, current, issues, logger,
      cache, disabledFields)
  ].sort(orderProfileSteps)
  validatePlanPayloads(planned, issues, logger)
  const { steps, skippedChanges } = readyChanges(planned, issues)
  steps.forEach(step => logger?.event('field_ready', 'succeeded', {
    stepId: step.id, section: step.section
  }))
  issues.filter(issue => issue.level === 'warning' && /skipped/i.test(issue.resolution ?? ''))
    .forEach(issue => logger?.event('field_skipped', 'succeeded', { fieldPath: issue.path }))
  return {
    kind: 'apply', account, input: disabledFields.length ? catalog : resolved, disabledFields,
    planning: { profile: planningSnapshot(current), parameters: structuredClone(cache) },
    skippedChanges, validationIssues: structuredClone(validationIssues),
    entryPolicy: captureApprovedEntries(selectedEntriesInput(resolved, disabledFields, skippedChanges), current),
    ...(resolved.skills.add.length && steps.some(step => ['skills', 'experience', 'education'].includes(step.section)) ? { skillPolicy: {
      baseline: section(current, 'skills').map(name).filter((item): item is string => Boolean(item)),
      target: resolved.skills.add
    } } : {}),
    identity: {
      displayName: String(current.display_name ?? current.name ?? account.clientName),
      profileUrl: String(current.profile_url ?? account.profileUrl)
    },
    snapshot: {
      capturedAt: new Date().toISOString(),
      values: { ...comparisonValues(resolved, current),
        ...Object.fromEntries(steps.map(step => [step.id, structuredClone(step.before)])) }
    },
    steps, issues
  }
}
