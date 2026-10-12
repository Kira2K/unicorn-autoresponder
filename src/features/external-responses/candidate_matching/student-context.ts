import type { Candidate } from '../types.ts'

export type EligibilityStudent = Pick<Candidate, 'id' | 'databaseClientId' | 'facts' | 'seniorityExceptions'>

/** Decision adapters receive identity and confirmed facts, never a CV or extracted CV facts. */
export function studentEligibilityContext(student: EligibilityStudent): EligibilityStudent {
  return {
    id: student.id,
    databaseClientId: student.databaseClientId,
    ...(student.seniorityExceptions ? { seniorityExceptions: structuredClone(student.seniorityExceptions) } : {}),
    facts: structuredClone(Object.fromEntries(Object.entries(student.facts).filter(([, fact]) => fact.source === 'confirmed')))
  }
}
