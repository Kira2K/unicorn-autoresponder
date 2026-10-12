import type { Answers, EmployerAiException, FormInspection } from '../types.ts'

/** An explicit candidate retry may decline an own-words declaration, never silently agree to it. */
export function allowsAiAssistedSubmission(form: FormInspection, exception?: EmployerAiException, answers?: Answers): boolean {
  if (typeof exception?.reason !== 'string' || !exception.reason.trim() || typeof exception.ownWordsFieldKey !== 'string') return false
  const field = form.fields.find(f => f.key === exception.ownWordsFieldKey)
  if (!field || !/only my own words/i.test(field.label) || !/\bAI\b|generated content/i.test(field.label)) return false
  if (!['select', 'combobox', 'radio', 'toggle', 'button-combobox'].includes(field.type)) return false
  if (field.options.length && !field.options.includes('No')) return false
  return !answers || answers.values[field.key]?.value === 'No'
}
