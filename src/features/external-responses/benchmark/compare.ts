type Verdict = 'eligible' | 'excluded' | 'review'
type Decision = { id: string; global: Verdict; stacks: Record<string, Verdict>; evidence: string[] }
type Reference = { id: string; global: Verdict; stacks?: Record<string, Verdict>; evidenceText: string }

/** Exact quality checks only. Never asks another model to judge a model response. */
export function compareDecisions(reference: Reference[], actual: Decision[]) {
  const expected = new Map(reference.map(row => [row.id, row])), seen = new Set<string>()
  if (expected.size !== reference.length) throw Error('duplicate_comparison_reference')
  const errors: { id: string; reason: string }[] = []
  for (const row of actual) {
    const gold = expected.get(row.id)
    if (!gold || seen.has(row.id)) { errors.push({ id: row.id, reason: gold ? 'duplicate_case' : 'unexpected_case' }); continue }
    seen.add(row.id)
    if (row.global !== gold.global) errors.push({ id: row.id, reason: 'global_decision_mismatch' })
    for (const [id, decision] of Object.entries(gold.stacks ?? {})) if (row.stacks?.[id] !== decision) errors.push({ id: row.id, reason: 'stack_decision_mismatch:' + id })
    if (!row.evidence?.length || row.evidence.some(text => typeof text !== 'string' || !text.trim() || !gold.evidenceText.includes(text))) errors.push({ id: row.id, reason: 'unsupported_evidence' })
  }
  for (const id of expected.keys()) if (!seen.has(id)) errors.push({ id, reason: 'missing_case' })
  return { comparableCases: reference.length, caseErrors: new Set(errors.map(e => e.id)).size, errors, equivalentQuality: errors.length === 0 }
}
