import { createHash } from 'node:crypto'
import type { StackProfile } from './index.ts'

export type StackRow = { id: string; name: string; description: string | null }
export type StudentStackRow = { studentId: string; stackId: string | null }
export type CampaignScope = {
  version: 1; database: string; capturedAt: string; digest: string
  stacks: (StackProfile & { databaseId: string; studentIds: string[] })[]
  excluded: { databaseId: string; name: string; reason: 'no_students' }[]
  issues: string[]
}
const fingerprint = (value: Omit<CampaignScope, 'digest'>) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** No I/O. Existing stack IDs and current student relationships define campaign scope. */
export function buildCampaignScope(input: {
  database: string; stacks: StackRow[]; students: StudentStackRow[]
  stackIds?: string[]; studentIds?: string[]; capturedAt?: string
}): CampaignScope {
  const allStacks = new Set(input.stacks.map(s => s.id)), allStudents = new Set(input.students.map(s => s.studentId))
  if (allStacks.size !== input.stacks.length || allStudents.size !== input.students.length) throw Error('duplicate_database_identity')
  if (input.stackIds?.some(id => !allStacks.has(id))) throw Error('unknown_database_stack')
  if (input.studentIds?.some(id => !allStudents.has(id))) throw Error('unknown_database_student')
  const students = input.students.filter(s => !input.studentIds || input.studentIds.includes(s.studentId))
  const issues: string[] = [], stacks: CampaignScope['stacks'] = [], excluded: CampaignScope['excluded'] = []
  if (students.some(s => s.stackId !== null && !allStacks.has(s.stackId))) issues.push('Student relationship references an unknown stack')
  for (const row of input.stacks.filter(s => !input.stackIds || input.stackIds.includes(s.id))) {
    const studentIds = students.filter(s => s.stackId === row.id).map(s => s.studentId).sort()
    if (!studentIds.length) { excluded.push({ databaseId: row.id, name: row.name, reason: 'no_students' }); continue }
    if (!row.description?.trim()) issues.push(`${row.name} (${row.id}): stack_description required`)
    stacks.push({ id: `stack-${row.id}`, databaseId: row.id, name: row.name, description: row.description?.trim() ?? '', studentIds })
  }
  const value = { version: 1 as const, database: input.database, capturedAt: input.capturedAt ?? new Date().toISOString(), stacks, excluded, issues }
  return { ...value, digest: fingerprint(value) }
}

export function assertCampaignScope(scope: CampaignScope) {
  if (!scope || scope.version !== 1 || !Array.isArray(scope.stacks) || !Array.isArray(scope.issues)) throw Error('campaign_scope_required')
  const { digest, ...value } = scope
  if (fingerprint(value) !== digest) throw Error('campaign_scope_changed')
  if (scope.issues.length) throw Error('stack_configuration_required: ' + scope.issues.join('; '))
  if (scope.stacks.some(s => !s.databaseId || !s.studentIds.length || !s.description?.trim())) throw Error('campaign_scope_incomplete')
}

export function assertCampaignStudent(scope: CampaignScope, stackId: string, studentId?: string) {
  assertCampaignScope(scope)
  const stack = scope.stacks.find(s => s.id === stackId)
  if (!studentId || !stack?.studentIds.includes(studentId)) throw Error('candidate_stack_mismatch: student is outside the database campaign scope')
  return stack
}
