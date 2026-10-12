export type SeniorityException = { level: string; source: 'cv' | 'student_rule'; evidence: string }
export function higherSeniorityGate(title: string, exceptions: SeniorityException[] = []) {
  const levels = [...new Set((title.toLowerCase().match(/\b(staff|principal|lead|head|manager|director|vp|chief)\b/g) ?? []))]
  const missing = levels.filter(level => !exceptions.some(exception => exception.level.toLowerCase() === level && ['cv', 'student_rule'].includes(exception.source) && !!exception.evidence.trim()))
  return { decision: missing.length ? 'excluded' as const : 'eligible' as const,
    reasons: missing.length ? ['Higher seniority requires explicit CV/student-rule permission: ' + missing.join(', ')] : [],
    evidence: missing.length ? [title] : exceptions.filter(exception => levels.includes(exception.level.toLowerCase())).map(exception => exception.evidence) }
}
