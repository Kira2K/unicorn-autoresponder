import { redact } from '../infrastructure/store.ts'
import type { Store, DiscoveryResult, BatchState, ApplicationRecord, Position } from '../types.ts'

const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
const csv = (v: unknown) => '"' + String(v ?? '').replace(/^[=+@-]/, value => "'" + value).replace(/"/g, '""') + '"'
const captured = (r: ApplicationRecord) => r.status === 'succeeded' && r.evidence?.confirmation === 'captured'
const workbookLocation = (p: Position) => (p.sources ?? [p.source]).map(s => s.workbook ? `${s.workbook.fileName}; ${s.workbook.sheet}!${s.workbook.companyCell}; ${s.workbook.sheet}!${s.workbook.careerCell}; row ${s.workbook.row}` : s.provenance ?? '').filter(Boolean).join('; ')
export async function generateReport(input: { candidateId: string; batchId?: string; discovery?: DiscoveryResult }, deps: { store: Store }) {
  const batches: BatchState[] = (await deps.store.batches(input.candidateId)).filter(b => !input.batchId || b.id === input.batchId)
  const records = batches.flatMap(b => b.records.map(r => ({ ...redact(r), batchId: b.id, cvSelection: b.cvSelection })))
  const failures = records.filter(r => ['failed', 'blocked', 'unknown', 'submitting'].includes(r.status))
  const robotFailures = records.flatMap(r => (r.outcomes ?? (r.reason === 'robot_rejected' ? [r] : [])).filter((o: any) => o.reason === 'robot_rejected').map((o: any) => ({ ...r, finalStatus: r.status, status: o.status, reason: o.reason, detail: o.detail, evidence: o.evidence, attempt: o.attempt })))
  const candidate = await deps.store.candidate(input.candidateId)
  const history = redact(candidate.history)
  const summary = { selected: batches.reduce((sum, b) => sum + b.targetIds.length, 0), confirmed: records.filter(captured).length, candidateReported: records.filter(r => r.status === 'succeeded' && r.evidence?.confirmation === 'operator_reported').length, failures: failures.length, robotRejections: robotFailures.length, batches: batches.map(b => ({ id: b.id, targets: b.targetIds.length, limit: b.limit, confirmed: b.records.filter(captured).length, passed: b.targetIds.length === b.limit && b.records.length === b.limit && b.records.every(captured) })) }
  const next = (r: any) => r.status === 'succeeded' ? 'Complete' : ['unknown', 'submitting'].includes(r.status) ? 'Reconcile receipt; do not resubmit' : r.status === 'prepared' ? 'Ready for live run' : r.status === 'skipped' ? 'Do not apply' : 'Resolve blocker and resume same target'
  const lines = ['# External applications report', '', `Candidate: ${input.candidateId}`, `Generated: ${new Date().toISOString()}`, '', `${summary.confirmed} captured confirmations; ${summary.candidateReported} candidate-reported successes; ${failures.length} failed, blocked or uncertain; ${robotFailures.length} robot rejections.`, '']
  if (records.some(r => r.preparedCv)) {
    lines.push('## Tailored documents', '', '| Vacancy | Exact application PDF | Original SHA-256 | Tailored SHA-256 | Validation |', '|---|---|---|---|---|')
    for (const r of records.filter(r => r.preparedCv)) { const cv = r.preparedCv!; lines.push(`| ${cell(r.position.company + ' / ' + r.position.title)} | [${cell(cv.fileName)}](<${cv.path.replace(/\\/g, '/') }>) | ${cv.originalHash} | ${cv.sha256} | ${cell(cv.testReview ? `Assistant test review: ${cv.testReview.result}; ${cv.testReview.evidence}` : 'Technical checks only')} |`) }
    lines.push('', 'These are the selected attachment artifacts. A PDF link alone does not establish that the application was submitted.', '')
  }
  for (const b of batches.filter(b => b.cvSelection?.mode === 'original')) lines.push(`Original CV selected for batch ${cell(b.id)}: [PDF](<${b.cvSelection!.path.replace(/\\/g, '/')}>) SHA-256 ${b.cvSelection!.sha256}; approved ${cell(b.cvSelection!.approval.approvedAt)} (${cell(b.cvSelection!.approval.approvalReference)}).`, '')
  for (const b of batches.filter(b => b.testCampaign)) lines.push(`Test campaign ${b.testCampaign!.id}: operator-authorized test answers=${b.testCampaign!.answerOverride}; answers are not verified student facts.`, '')
  const auditLines: string[] = []
  if (input.discovery) {
    const lines = auditLines
    lines.push('## Source audit', '', '| Company / provenance | Coverage | Postings found | Eligible / review / excluded | Issues |', '|---|---|---:|---|---|')
    for (const a of input.discovery.audit) {
      const positions = input.discovery.positions.filter(p => (p.sources ?? [p.source]).some(source => source.name === a.source.name))
      lines.push(`| [${cell(a.source.name)}](${a.source.url}); ${cell(a.source.provenance)} | ${a.status}; ${a.pages.length} pages | ${a.found} | ${['eligible','review','excluded'].map(d => positions.filter(p => p.fit?.decision === d).length).join(' / ')} | ${cell(a.issues.join('; '))} |`)
    }
    lines.push('', '## Vacancy decisions', '', '| Company | Role | Decision | Reasons |', '|---|---|---|---|')
    for (const p of input.discovery.positions) lines.push(`| ${cell(p.company)} | [${cell(p.title)}](${p.url}) | ${p.fit?.decision ?? 'review'} | ${cell(p.fit?.reasons.join('; '))} |`)
  }
  lines.push('', '## Batch acceptance', '', ...summary.batches.map(b => `- ${b.id}: ${b.confirmed}/${b.limit} confirmed; ${b.passed ? 'PASS' : 'INCOMPLETE'}. ${b.targets} immutable selected targets.`))
  const overrides = records.filter(r => r.reviewOverride)
  if (overrides.length) lines.push('', '## Explicit candidate selections', '', ...overrides.map(r => `- ${cell(r.position.company)}: ${cell(r.reviewOverride)}. Original fit: ${r.position.fit?.decision ?? 'review'}; ${cell(r.position.fit?.reasons.join('; '))}`))
  const aiExceptions = records.filter(r => r.employerAiException)
  if (aiExceptions.length) lines.push('', '## Employer AI-policy exceptions', '', ...aiExceptions.map(r => `- ${cell(r.position.company)}: ${cell(r.employerAiException!.reason)}. Configured own-words declaration: No; the employer may disqualify AI-assisted answers. A submission receipt does not establish hiring eligibility.`))
  lines.push('', '## Applications', '', '| Batch | Company / role | Workbook location | Exact selected PDF | Status | Reason | Confirmation / evidence | Next action |', '|---|---|---|---|---|---|---|---|')
  for (const r of records) lines.push(`| ${cell(r.batchId)} | [${cell(r.position.company + ' / ' + r.position.title)}](${r.position.url}) | ${cell(workbookLocation(r.position))} | ${r.cvSelection?.mode === 'original' ? `[Original PDF](<${r.cvSelection.path.replace(/\\/g, '/')}>)` : r.preparedCv ? `[PDF](<${r.preparedCv.path.replace(/\\/g, '/')}>)` : 'None'} | ${r.status} | ${cell([r.reason, r.detail].filter(Boolean).join(': '))} | ${cell(r.evidence ? `${r.status === 'succeeded' && r.evidence.confirmation ? r.evidence.confirmation : 'diagnostic evidence only'}; ${r.evidence.observedAt}; ${r.evidence.screenshot ?? r.evidence.url}; human assistance: ${r.manualAssistance === undefined ? 'not recorded' : r.manualAssistance}` : 'None')} | ${next(r)} |`)
  lines.push('', ...auditLines)
  lines.push('', '## Imported history (excluded from this run’s success count)', '', '| Company / role | Status | Confirmation | Date |', '|---|---|---|---|')
  for (const h of history) lines.push(`| [${cell(h.company + ' / ' + h.title)}](${h.url}) | ${h.status} | ${cell(h.confirmation === 'operator_reported' ? 'Candidate-reported success; no captured receipt' : h.confirmation ?? 'None')} | ${cell(h.date)} |`)
  return {
    summary, markdown: lines.join('\n') + '\n',
    csv: [['batch', 'company', 'title', 'url', 'status', 'reason', 'attempt', 'updatedAt', 'confirmation', 'evidence', 'manualAssistance', 'nextAction', 'workbookFileId', 'workbookFileName', 'sheet', 'row', 'companyCell', 'careerCell', 'tailoredPdf', 'originalSha256', 'resultSha256', 'cvValidation', 'selectedCvMode', 'selectedPdf'].map(csv).join(','), ...records.map(r => { const w = r.position.source.workbook; return [r.batchId, r.position.company, r.position.title, r.position.url, r.status, r.reason, r.attempt, r.updatedAt, r.status === 'succeeded' ? r.evidence?.confirmation : undefined, r.evidence?.screenshot ?? '', r.manualAssistance ?? 'not_recorded', next(r), w?.fileId, w?.fileName, w?.sheet, w?.row, w?.companyCell, w?.careerCell, r.preparedCv?.path, r.preparedCv?.originalHash ?? r.cvSelection?.sha256, r.preparedCv?.sha256, r.preparedCv?.testReview?.result ?? r.preparedCv?.validation, r.cvSelection?.mode ?? 'tailored', r.cvSelection?.path ?? r.preparedCv?.path].map(csv).join(',') })].join('\n'),
    results: records.map(({ answers, fields, preparation, position, ...r }) => ({ ...r, preparation: preparation ? { engine: preparation.engine, formSignature: preparation.formSignature, preparedAt: preparation.preparedAt, verifiedAt: preparation.verifiedAt, cachedQuestions: Object.keys(preparation.fields).length } : undefined, position: { id: position.id, company: position.company, title: position.title, url: position.url, source: position.source, sources: position.sources } })),
    failures: failures.map(r => ({ batchId: r.batchId, positionId: r.position.id, company: r.position.company, status: r.status, reason: r.reason, detail: r.detail, attempt: r.attempt, updatedAt: r.updatedAt, evidence: r.evidence, nextAction: next(r) })),
    robotFailures: robotFailures.map(r => ({ batchId: r.batchId, positionId: r.position.id, company: r.position.company, status: r.status, finalStatus: r.finalStatus, reason: r.reason, detail: r.detail, attempt: r.attempt, observedAt: r.evidence?.observedAt, evidence: r.evidence, nextAction: next({ ...r, status: r.finalStatus }) }))
  }
}
