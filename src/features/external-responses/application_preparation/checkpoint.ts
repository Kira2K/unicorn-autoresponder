import { digest } from '../../company-client-management/legacy-snapshot.mts'
import type { Answer, AnswerGenerator, Answers, Candidate, Field, FormInspection, Position } from '../types.ts'

export type PreparationCheckpoint = {
  version: 1; contextHash: string; engine: string; formSignature: string; preparedAt: string
  fields: Record<string, { signature: string; answer?: Answer; missing: boolean }>; verifiedAt?: string
}
export function preparationContext(candidate: Candidate, position: Position, engine: string) {
  return digest({ version: 1, candidate: candidate.id, student: candidate.databaseClientId, facts: candidate.facts,
    cv: candidate.cv.sha256, position: { id: position.id, title: position.title, description: position.description, location: position.location, applyUrl: position.applyUrl }, engine })
}
export function validSavedAnswer(field: Field, answer?: Answer): boolean {
  if (!answer || typeof answer.value !== 'string' || !answer.evidence?.length || answer.evidence.some(v => typeof v !== 'string' || !v.trim())) return false
  if (!field.options.length) return !field.required || !!answer.value.trim()
  let values: unknown = [answer.value]
  if (field.type === 'checkbox-group' && answer.value.startsWith('[')) { try { values = JSON.parse(answer.value) } catch { return false } }
  return Array.isArray(values) && values.length > 0 && values.every(v => field.options.includes(v))
}

/** Field-local answer reuse. Unknown generator policies fail closed to ordinary generation. No browser/SQL/AI client here. */
export async function prepareWithCheckpoint(input: { candidate: Candidate; position: Position; form: FormInspection; engine: string; previous?: PreparationCheckpoint }, generator: AnswerGenerator) {
  const { candidate, position, form, engine, previous } = input, contextHash = preparationContext(candidate, position, engine)
  if (new Set(form.fields.map(f => f.key)).size !== form.fields.length) throw Error('duplicate_form_field_keys')
  const values: Answers['values'] = {}, missing: Field[] = [], pending: Field[] = []
  const signatures = new Map<string, string>(), fields: PreparationCheckpoint['fields'] = {}
  let reused = 0
  for (const field of form.fields) {
    const policy = generator.cacheKey?.(candidate, position, field)
    const signature = digest({ field, policy, aiBan: form.aiBan, minimumDaysBetweenApplications: form.minimumDaysBetweenApplications })
    signatures.set(field.key, signature)
    const saved = policy && previous?.version === 1 && previous.contextHash === contextHash ? previous.fields[field.key] : undefined
    const consistent = saved && (saved.answer ? !saved.missing && validSavedAnswer(field, saved.answer) : saved.missing || !field.required || field.type === 'file')
    if (saved?.signature === signature && consistent) {
      if (saved.answer) values[field.key] = structuredClone(saved.answer)
      if (saved.missing) missing.push(field)
      fields[field.key] = structuredClone(saved); reused++
    } else pending.push(field)
  }
  if (pending.length) {
    // Only opt-in field-local generators receive subsets; others retain the full form.
    const result = await generator.generate(candidate, position, { ...form, fields: pending })
    for (const field of pending) {
      const answer = result.values[field.key]
      if (validSavedAnswer(field, answer)) values[field.key] = structuredClone(answer)
      const unresolved = result.missing.some(f => f.key === field.key) || field.required && field.type !== 'file' && !values[field.key]
      if (unresolved) missing.push(field)
      fields[field.key] = { signature: signatures.get(field.key)!, answer: values[field.key], missing: unresolved }
    }
  }
  return { answers: { values, missing }, reused, generated: pending.length,
    checkpoint: { version: 1 as const, contextHash, engine, formSignature: digest(form.fields), preparedAt: new Date().toISOString(), fields } }
}
