import { withPreparedAnswers } from './prepared-answers.ts'
import type { AnswerGenerator, Answer, Candidate, Position } from '../types.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
export type TestAnswers = { campaignId: string; studentId: string; batchId: string; positionId: string; values: Record<string, Answer> }
/** Operator-reviewed campaign data, not a global answering rule or candidate facts. */
export function withTestAnswers(base: AnswerGenerator, input: { campaignId: string; studentId: string; batchId: string; targets: string[]; answers: TestAnswers[] }): AnswerGenerator {
  for (const row of input.answers) {
    if (row.campaignId !== input.campaignId || row.studentId !== input.studentId || row.batchId !== input.batchId || !input.targets.includes(row.positionId)) throw Error('test_answer_scope_mismatch')
  }
  if (new Set(input.answers.map(r => r.positionId)).size !== input.answers.length) throw Error('duplicate_test_answer_scope')
  return { ...(base.cacheKey ? { cacheKey: (candidate, position, field) => {
    if (candidate.databaseClientId !== input.studentId || !input.targets.includes(position.id)) throw Error('test_answer_scope_mismatch')
    const values = input.answers.find(r => r.positionId === position.id)?.values
    return digest({ base: base.cacheKey!(candidate, position, field), campaign: input.campaignId, student: input.studentId, batch: input.batchId, position: position.id, answer: values?.[field.key] ?? values?.[field.label] })
  } } satisfies Pick<AnswerGenerator, 'cacheKey'> : {}), generate: async (candidate: Candidate, position: Position, form) => {
    if (candidate.databaseClientId !== input.studentId || !input.targets.includes(position.id)) throw Error('test_answer_scope_mismatch')
    const row = input.answers.find(r => r.positionId === position.id)
    const values = Object.fromEntries(Object.entries(row?.values ?? {}).map(([key, answer]) => [key, { ...answer, evidence: [...answer.evidence, `operator_test_override:${input.campaignId}; student=${input.studentId}; batch=${input.batchId}; vacancy=${position.id}`] }]))
    return withPreparedAnswers(base, values).generate(candidate, position, form)
  } }
}
