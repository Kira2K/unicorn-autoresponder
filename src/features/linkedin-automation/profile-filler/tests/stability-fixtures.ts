import type { JsonObject } from '../input-types.ts'
import type { ProfilePlan, PlanStep } from '../plan-types.ts'
import type { TimingPolicy } from '../timing.ts'

export const noWait: TimingPolicy = { firstWrite: { min: 0, max: 0 }, ordinaryWrite: { min: 0, max: 0 },
  readBack: { min: 0, max: 0 }, skillsBatch: { min: 0, max: 0 }, finalReadBack: { min: 0, max: 0 },
  verificationScheduleSeconds: [0, 0] }
export const silent = { event() {} }
export const fixtureProfile = (): JsonObject => ({ description: 'Old', bio: 'Old',
  specifics: { experience: [], education: [], skills: [] } })
export const headlineStep: PlanStep = { id: 'headline', section: 'headline', action: 'update',
  summary: 'Headline', before: 'Old', after: 'New', payload: { specifics: { linkedin: { headline: 'New' } } },
  verification: { kind: 'headline', expected: 'New' } }
export const createStep: PlanStep = { id: 'experience-1', section: 'experience', action: 'create',
  summary: 'Experience', before: null, after: {}, payload: { specifics: { linkedin: { experience: {
    operation: 'create', company: { name: 'Example' }, job_title: { name: 'Engineer' },
    start_date: { year: 2024, month: 1 }
  } } } }, verification: { kind: 'experience', expected: { company: 'Example', jobTitle: 'Engineer',
    startDate: { year: 2024, month: 1 }, skills: [] } } }
export const fixturePlan = (steps: PlanStep[]): ProfilePlan => ({ kind: 'apply',
  account: { platformAccountId: 1, accountId: 'mock', clientName: 'Mock', providerId: 'mock', profileUrl: 'mock' },
  identity: { displayName: 'Mock', profileUrl: 'mock' }, snapshot: { capturedAt: '', values: {} }, steps, issues: [] })
