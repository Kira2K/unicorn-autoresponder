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

function position(step: { section: string; action: string }) {
  const key = ['experience', 'education'].includes(step.section)
    ? `${step.section}-${step.action}` : step.section
  return MCP_WRITE_ORDER.findIndex(value => value === key)
}

export async function buildProfilePlan(
  client: ProfileClient, account: ProfileAccount, desired: ProfileInput,
  current: JsonObject, validationIssues: ValidationIssue[], logger?: ProfileLogger,
  parameterCache?: ParameterSearchCache
): Promise<ProfilePlan> {
  const issues = structuredClone(validationIssues)
  const catalog = await resolveProfileCatalog({ client, accountId: account.accountId,
    desired, issues, logger, parameterCache })
  const resolved = selectProfileSkills(catalog, current, issues)
  const skillBudget = createEntrySkillBudget(current)
  const planned = [
    ...planBasic(resolved, current, issues),
    ...planExperience(resolved, current, issues, skillBudget),
    ...planEducation(resolved, current, issues, skillBudget),
    ...planSkills(resolved, current, issues),
    ...await planOpenToWork(client, account.accountId, resolved, current, issues, logger,
      parameterCache)
  ].sort((left, right) => position(left) - position(right))
  const steps = planned
  validatePlanPayloads(steps, issues, logger)
  steps.forEach(step => logger?.event('field_ready', 'succeeded', {
    stepId: step.id, section: step.section
  }))
  issues.filter(issue => issue.level === 'warning' && /skipped/i.test(issue.resolution ?? ''))
    .forEach(issue => logger?.event('field_skipped', 'succeeded', { fieldPath: issue.path }))
  return {
    kind: 'apply', account, input: resolved, entryPolicy: captureApprovedEntries(resolved, current),
    ...(resolved.skills.add.length ? { skillPolicy: {
      baseline: section(current, 'skills').map(name).filter((item): item is string => Boolean(item)),
      target: resolved.skills.add
    } } : {}),
    identity: {
      displayName: String(current.display_name ?? current.name ?? account.clientName),
      profileUrl: String(current.profile_url ?? account.profileUrl)
    },
    snapshot: {
      capturedAt: new Date().toISOString(),
      values: Object.fromEntries(steps.map(step => [step.id, structuredClone(step.before)]))
    },
    steps, issues
  }
}
