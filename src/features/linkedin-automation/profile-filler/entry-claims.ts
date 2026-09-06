import type { JsonObject } from './input-types.ts'
import type { ProfilePlan } from './plan-types.ts'
import { educationCandidates, experienceCandidates } from './profile-match.ts'
import { codedError } from './errors.ts'

export function sharedEntryTargets<T>(entries: JsonObject[], desired: T[],
  candidates: (entries: JsonObject[], entry: T) => JsonObject[]) {
  const owners = new Map<unknown, Set<number>>()
  desired.forEach((entry, index) => {
    for (const candidate of candidates(entries, entry)) {
      const key = candidate.id ?? candidate
      const indexes = owners.get(key) ?? new Set<number>()
      indexes.add(index)
      owners.set(key, indexes)
    }
  })
  return new Set([...owners.values()].filter(indexes => indexes.size > 1)
    .flatMap(indexes => [...indexes]))
}

export function assertDistinctPlanTargets(plan: ProfilePlan) {
  const reject = () => { throw codedError('profile_entry_ambiguous',
    'Multiple CV entries target the same LinkedIn entry. Build a new Preview.') }
  if (plan.input && plan.entryPolicy) {
    if (sharedEntryTargets(plan.entryPolicy.education ?? [], plan.input.education,
      educationCandidates).size) reject()
    if (sharedEntryTargets(plan.entryPolicy.experience ?? [], plan.input.experience,
      experienceCandidates).size) reject()
  }
  const targets = new Set<string>()
  for (const step of plan.steps) {
    const spec = step.verification
    if ((spec.kind !== 'experience' && spec.kind !== 'education') || !spec.id) continue
    const key = `${spec.kind}:${spec.id}`
    if (targets.has(key)) reject()
    targets.add(key)
  }
}
