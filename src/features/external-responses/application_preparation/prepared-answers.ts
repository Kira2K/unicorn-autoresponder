import type { Answer, AnswerGenerator } from '../types.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'

/** Run-specific prepared answers never become confirmed candidate profile facts. */
export function withPreparedAnswers(base: AnswerGenerator, prepared: Record<string, Answer> = {}): AnswerGenerator {
  return { ...(base.cacheKey ? { cacheKey: (candidate, position, field) => digest({ base: base.cacheKey!(candidate, position, field), prepared: prepared[field.key] ?? prepared[field.label] }) } satisfies Pick<AnswerGenerator, 'cacheKey'> : {}), generate: async (candidate, position, form) => {
    const result = await base.generate(candidate, position, form)
    for (const field of form.fields) {
      const answer = prepared[field.key] ?? prepared[field.label]
      if (!answer || typeof answer.value !== 'string' || !Array.isArray(answer.evidence) || !answer.evidence.length || answer.evidence.some(e => typeof e !== 'string' || !e.trim())) continue
      if (field.options.length) {
        let selected: unknown = [answer.value]
        if (field.type === 'checkbox-group' && answer.value.startsWith('[')) {
          try { selected = JSON.parse(answer.value) } catch { continue }
        }
        if (!Array.isArray(selected) || !selected.length || selected.some(v => typeof v !== 'string' || !field.options.includes(v))) continue
      }
      result.values[field.key] = { value: answer.value, evidence: [...answer.evidence] }
    }
    result.missing = result.missing.filter(field => !result.values[field.key])
    return result
  } }
}
