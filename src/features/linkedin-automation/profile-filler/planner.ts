import type { JsonObject, ProfileInput, ValidationIssue } from './input-types.ts'
import type { ProfileAccount, ProfileClient, ProfilePlan } from './plan-types.ts'
import { planBasic } from './planners/basic.ts'
import { planEducation } from './planners/education.ts'
import { planExperience } from './planners/experience.ts'
import { planOpenToWork } from './planners/open-to-work.ts'
import { planSkills } from './planners/skills.ts'
import { resolvePlanParameters } from './parameter-resolution.ts'
import type { ProfileLogger } from './profile-logger.ts'

const order = ['headline', 'about', 'experience-update', 'education-update', 'skills',
  'experience-create', 'education-create', 'open_to_work']

function position(step: { section: string; action: string }) {
  const key = ['experience', 'education'].includes(step.section)
    ? `${step.section}-${step.action}` : step.section
  return order.indexOf(key)
}

export async function buildProfilePlan(
  client: ProfileClient, account: ProfileAccount, desired: ProfileInput,
  current: JsonObject, validationIssues: ValidationIssue[], logger?: ProfileLogger
): Promise<ProfilePlan> {
  const issues = structuredClone(validationIssues)
  const planned = [
    ...planBasic(desired, current, issues),
    ...planExperience(desired, current, issues),
    ...planEducation(desired, current, issues),
    ...planSkills(desired, current, issues),
    ...await planOpenToWork(client, account.accountId, desired, current, issues)
  ].sort((left, right) => position(left) - position(right))
  const steps = await resolvePlanParameters(client, account.accountId, planned, issues, logger)
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
