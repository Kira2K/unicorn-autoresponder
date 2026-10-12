import { collectionIssues, collectionCoverageGaps, sourceKey } from '../vacancy_collection/index.ts'
import type { ClassifiedCollection } from '../stack_classification/index.ts'
import { telegramOnly } from '../vacancy_collection/application-destinations.ts'
import { higherSeniorityGate } from '../candidate_matching/seniority.ts'
import type { VacancyCollection } from '../vacancy_collection/index.ts'
import { validateSourceDescriptions } from '../vacancy_collection/source-quality.ts'
import { classificationTotals } from './classification-metrics.ts'
import { redact } from '../infrastructure/store.ts'
export function companyCoverage(collection:VacancyCollection) {
  const verified=validateSourceDescriptions(collection.audit,collection.positions)
  return (collection.scan?.companies??[]).map(company=>{
    const audits=verified.filter(a=>a.source.database?.companyId===company.id)
    const scopeIssues=(collection.sourceIssues??[]).filter(issue=>issue.startsWith(`company:${company.id}:`))
    const issues=[...scopeIssues,...audits.flatMap(a=>a.issues)]
    const status=!audits.length?'unsupported':audits.every(a=>a.status==='complete')&&!scopeIssues.length?'complete':audits.every(a=>a.status==='unavailable')?'unavailable':'partial'
    return {...company,status,sourceCount:audits.length,readerCalls:audits.reduce((n,a)=>n+(a.trace?.requests??0),0),issues}
  })
}
export function generateCollectionReport(input: ClassifiedCollection) {
  input={...input,collection:{...input.collection,audit:validateSourceDescriptions(input.collection.audit,input.collection.positions)}}
  const clean = (value: unknown) => String(value ?? '').replace(/[\r\n|]/g, ' ')
  const rows = input.collection.audit.map(audit => ({    
company: audit.source.name, url: audit.source.url, workbook: audit.source.workbook,
    status: audit.status, pages: audit.pages.length, found: audit.found, titleRejected:audit.titlePrecheck?.skipped.length??0, issues: audit.issues, accessGate: audit.accessGate,
    stacks: Object.fromEntries(input.stacks.map(stack => [stack.id, input.collection.positions.filter(position => (position.sources ?? [position.source]).some(source => sourceKey(source) === sourceKey(audit.source)) && input.groups[stack.id]?.matchedIds.includes(position.id)).length]))  
}))
  const blockers = [...collectionIssues(input.collection), ...input.configurationIssues]
  const matched = new Set(input.stacks.flatMap(stack => input.groups[stack.id]?.matchedIds ?? []))
  const acceptedCount = input.collection.positions.filter(position => matched.has(position.id)).length
  const gaps = collectionCoverageGaps(input.collection),titleRejected=rows.reduce((count,row)=>count+row.titleRejected,0)
  const companies = new Set(input.collection.sources.map(s => s.database?.companyId ? 'db:' + s.database.companyId : 'name:' + s.name))
  for (const issue of input.collection.sourceIssues ?? []) { const id = /^company:(\d+):/.exec(issue)?.[1]; if (id) companies.add('db:' + id) }
  const vacancies = input.collection.positions.filter(position => matched.has(position.id)).map(position => ({
    id: position.id, company: position.company, title: position.title, url: position.url,
    market: position.market?.value ?? 'unknown',
    stacks: input.stacks.filter(stack => input.groups[stack.id]?.matchedIds.includes(position.id)).map(stack => stack.name),
    description: position.description, applicationDestinations: position.applicationDestinations ?? [],
    nextAction: [position.source, ...(position.sources ?? [])].some(s => s.database?.applicationRoute === 'notify_only') ? 'report_only' : telegramOnly(position) ? 'apply_later_telegram' : higherSeniorityGate(position.title).decision === 'excluded' ? 'student_seniority_exception_required' : 'later_application_stage',
    decisions: Object.fromEntries(input.stacks.map(stack => [stack.id, input.decisions[stack.id][position.id]])),
  }))
  const scope = input.collection.scope
  const coverage=companyCoverage(input.collection)
  const totals=classificationTotals(input)
  const evaluation=input.evaluation, traces=input.collection.audit.map(a=>({name:a.source.name,...a.trace,pausedMs:(a.trace?.actions??[]).filter(a=>a.operation==='proposal_loaded').reduce((n,a)=>{try{return n+(JSON.parse(a.detail??'{}').pausedMs??0)}catch{return n}},0)}))
  const lines = [`# Vacancy collection ${clean(input.collection.runId)}`, '', `Ready for applications: ${input.readyForApplications ? 'yes' : 'no'}. Companies: ${companies.size}. Sources: ${rows.length}. Unique discoveries: ${input.collection.positions.length}. Accepted vacancies: ${acceptedCount}. Title-rejected before detail/classification: ${titleRejected}.`, '',
    'Only vacancies passing global rules and matching at least one selected stack enter the vacancy directory. Review and excluded discoveries remain audit data.', '',
    `Selection outcomes: ${totals.accepted} accepted; ${totals.excluded} excluded; ${totals.review} require substantive/data review; ${totals.unassessed} not assessed. Readiness applies only to accepted targets, never to review cases.`,
    `Title rejections: ${totals.titleRejectedObservations} source observations covering ${totals.titleRejectedUniqueUrls} distinct evidence URLs. Unlinked job panels share their listing URL; repeated source observations are not distinct vacancies.`, '',
    ...(evaluation ? [`Classification: ${evaluation.pendingIds.length} pending; ${evaluation.hits} reused decisions; ${evaluation.calls} API assessor calls; ${evaluation.sessionReviews??0} newly consumed session reviews. Pending classification is not evidence of no suitable vacancies.`,
      `Decision origins: ${['api','human','assistant_session','pending'].map(origin=>origin+'='+Object.values(evaluation.records).filter(r=>r.origin===origin).length).join(', ')}.`, '',
      '| Source | Mode | Reader calls | Repair | Active ms | Waiting/review ms | Codex proposals | Engine / recipe |', '|---|---|---:|---|---:|---:|---|---|',
      ...traces.map(t=>`| ${clean(t.name)} | ${t.mode??'legacy'} | ${t.requests??0} | ${t.repairOutcome??(t.repaired?'attempted (legacy)':'no')} | ${t.activeMs??(t.finishedAt&&t.startedAt?Date.parse(t.finishedAt)-Date.parse(t.startedAt):0)} | ${t.pausedMs} | ${t.actions?.filter(a=>a.operation==='proposal_loaded').length??0} / ${t.investigation?.status??'none'} | ${clean(t.recipe?.engine?`${t.recipe.engine.id}@${t.recipe.engine.version}`:t.recipe?.revision??t.recipeRevision??'unverified')} |`), '',
      'Reader calls exclude browser asset requests. Codex-assisted investigation and classification use session allowance; their tokens and cost are unavailable unless reported by the session. Zero separate API calls does not mean zero AI usage.', '',
      ...evaluation.pendingIds.map(id=>'- Pending classification: '+clean(input.collection.positions.find(p=>p.id===id)?.title)+'; '+clean(evaluation.records[id]?.reason??'Required evidence/assessment unavailable')), ''] : []),
    ...(input.collection.scan ? ['Frozen companies: '+input.collection.scan.companies.map(c=>`${clean(c.name)} (${c.id})`).join(', '), ''] : []),
    ...(input.assessmentProvenance ? [`Assessment source: ${clean(input.assessmentProvenance.origin)}; reviewer: ${clean(input.assessmentProvenance.reviewedBy)}; reviewed at ${clean(input.assessmentProvenance.reviewedAt)}. This is an explicit reviewed assessment, not an unattended API classification.`, ''] : []),
    ...(input.selectionRules ? [`Selection rules: ${clean(input.selectionRules.source)}; SHA-256 ${input.selectionRules.sha256}.`, `Global decisions: ${['eligible', 'review', 'excluded'].map(status => `${status}=${Object.values(input.globalDecisions ?? {}).filter(d => d.decision === status).length}`).join(', ')}.`, ''] : ['Historical/offline classification: no global selection rule snapshot.', '']),
    ...(scope ? [`Database campaign: ${clean(scope.database)}; ${scope.stacks.length} populated stacks; ${scope.excluded.length} stacks without students excluded.`, '', ...scope.stacks.map(s => `- ${clean(s.name)} (DB ${clean(s.databaseId)}): ${s.studentIds.length} students.`), ''] : ['Offline collection: database campaign scope is absent; live submissions are disabled.', '']),
    '| Stack | Matched | Needs review | Excluded |', '| --- | ---: | ---: | ---: |',
  ...input.stacks.map(stack => `| ${clean(stack.name)} | ${input.groups[stack.id]?.matchedIds.length ?? 0} | ${input.groups[stack.id]?.reviewIds.length ?? 0} | ${input.groups[stack.id]?.excludedIds.length ?? 0} |`), '',
    ...(coverage.length?['| Company ID | Company | Coverage | Sources | Reader calls |','|---|---|---|---:|---:|',...coverage.map(c=>`| ${c.id} | ${clean(c.name)} | ${c.status} | ${c.sourceCount} | ${c.readerCalls} |`),'',`Completely inspected companies for the selected stack/title-policy scope: ${coverage.filter(c=>c.status==='complete').length}/${coverage.length}. Title-rejected roles do not require detail reads; unsupported and blocked companies stay in this denominator.`, '']:[]),
    '| Company | Coverage | Pages | Retained discoveries | Title-rejected | Workbook | Issues |', '| --- | --- | ---: | ---: | ---: | --- | --- |',
  ...rows.map(row => `| ${clean(row.company)} | ${row.status} | ${row.pages} | ${row.found} | ${row.titleRejected} | ${row.workbook ? clean(row.workbook.sheet + '!' + row.workbook.companyCell) : ''} | ${clean(row.issues.join('; '))} |`),
    '', ...blockers.map(issue => '- Blocker: ' + clean(issue)), '',
    '## Coverage gaps', '', ...gaps.map(issue => '- ' + clean(issue)), '',
    '## Source access — human review', '', ...rows.filter(row => row.accessGate).map(row => `- ${clean(row.company)}: ${clean(row.accessGate!.kind)}; ${clean(row.accessGate!.url)}; ${clean(row.accessGate!.evidence)}`), '',
    '## Accepted vacancies', '', '| Company | Role | Posting | Stacks | Market | Next action |', '| --- | --- | --- | --- | --- | --- |',
    ...vacancies.map(v => `| ${clean(v.company)} | ${clean(v.title)} | ${clean(v.url)} | ${clean(v.stacks.join(', '))} | ${v.market} | ${v.nextAction} |`), '',
    '## Vacancies requiring review', '',
    ...input.collection.positions.filter(p=>totals.reviewIds.includes(p.id)).map(p=>`- ${clean(p.company)} — ${clean(p.title)}: ${clean(p.url)}; ${clean([...new Set([...(input.globalDecisions?.[p.id]?.decision==='review'?input.globalDecisions[p.id].reasons:[]),...input.stacks.flatMap(s=>input.decisions[s.id][p.id]?.decision==='review'?input.decisions[s.id][p.id].reasons:[])])].join('; '))}`), '',
    '## Vacancies with Telegram — apply later', '',
    ...vacancies.filter(v => v.applicationDestinations.some(route => route.channel === 'telegram')).map(v => `- ${clean(v.company)} — ${clean(v.title)}: ${v.applicationDestinations.filter(route => route.channel === 'telegram').map(route => clean(route.address)).join(', ')}. Saved for later Telegram processing${v.nextAction === 'report_only' ? '; company remains report-only' : ''}.`), '',
    '## Deferred sources', '', ...(input.collection.deferredSources ?? []).map(s => `- Source ${clean(s.id)}: ${clean(s.reason)}${s.companyId ? '; company ' + clean(s.companyId) : ''}`), '',
    '## Report-only companies', '', ...[...new Set(input.collection.sources.filter(s => s.database?.applicationRoute === 'notify_only').map(s => s.name))].map(name => '- ' + clean(name)), '']
  const quote = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"'
  const csv = [['Company', 'URL', 'Coverage', 'Pages', 'Retained discoveries', 'Title-rejected', 'Workbook', 'Issues'].map(quote).join(','), ...rows.map(row => [row.company, row.url, row.status, row.pages, row.found, row.titleRejected, row.workbook ? row.workbook.sheet + '!' + row.workbook.companyCell : '', row.issues.join('; ')].map(quote).join(','))].join('\n')
  const vacancyCsv = [['Company', 'Role', 'URL', 'Stacks', 'Market', 'Next action', 'Application destinations'].map(quote).join(','), ...vacancies.map(v => [v.company, v.title, v.url, v.stacks.join('; '), v.market, v.nextAction, v.applicationDestinations.map(route => route.address).join('; ')].map(quote).join(','))].join('\n')
  const report={ markdown: lines.join('\n'), csv, rows, blockers, gaps, vacancies, vacancyCsv, coverage, totals, collectionDigest: input.digest }
  return redact(report) as typeof report
}
