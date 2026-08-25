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

function position(step: { section: string; action: string }) {
  const key = ['experience', 'education'].includes(step.section)
    ? `${step.section}-${step.action}` : step.section
  return MCP_WRITE_ORDER.indexOf(key as any)
}

export async function buildProfilePlan(
  client: ProfileClient, account: ProfileAccount, desired: ProfileInput,
  current: JsonObject, validationIssues: ValidationIssue[], logger?: ProfileLogger
): Promise<ProfilePlan> {
  const issues = structuredClone(validationIssues)
  const skillBudget = createEntrySkillBudget(current)
  const planned = [
    ...planBasic(desired, current, issues),
    ...planExperience(desired, current, issues, skillBudget),
    ...planEducation(desired, current, issues, skillBudget),
    ...planSkills(desired, current, issues),
    ...await planOpenToWork(client, account.accountId, desired, current, issues, logger)
  ].sort((left, right) => position(left) - position(right))
  const steps = planned
  validatePlanPayloads(steps, issues, logger)
  return {
    kind: 'apply', account, input: desired,
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
