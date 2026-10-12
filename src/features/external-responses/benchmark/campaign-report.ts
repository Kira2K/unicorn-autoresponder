import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { atomicJson } from '../infrastructure/store.ts'

const optional = async (path: string): Promise<any> => { try { return JSON.parse(await readFile(path, 'utf8')) } catch (error: any) { if (error.code !== 'ENOENT') throw error } }
const escape = (text: unknown) => String(text ?? '').replace(/[\r\n|]/g, ' ')

/** Deterministic stop/report path. Reads saved evidence only; no model/browser/SQL call. */
export async function benchmarkCampaignReport(campaign: string) {
  const root = resolve(campaign), budget = await optional(join(root, 'budget.json')), frozen = await optional(join(root, 'frozen-scope.json'))
  if (!budget || !frozen) throw Error('benchmark_report_scope_missing')
  const batches: any[] = [], companies: any[] = [], failures: any[] = [], tokens: any[] = []
  const observations: number[] = [budget.baseline.usedPercent]
  for (const path of ['budget-status.json','batch-budget-status.json']) { const state = await optional(join(root,path)); if (state?.observation) observations.push(state.observation.usedPercent) }
  for (let batch = 1; batch <= 6; batch++) {
    const directory = join(root,'batches',String(batch)), run = `${budget.campaignId}-b${batch}-initial`, output = join(directory,'isolated',run)
    const analysis = await optional(join(directory,'initial-analysis.json')), checkpoint = await optional(join(output,'benchmark-checkpoint.json'))
    const review = await optional(join(output,'review','summary.json')), sql = await optional(join(output,'review','sql-receipt.json'))
    const state = await optional(join(directory,'budget-status.json')), task = await optional(join(directory,'tasks','classification','result.json'))
    const replay = await optional(join(directory,'replay-analysis.json'))
    const replayReport = replay ? await optional(join(directory,'isolated',`${budget.campaignId}-b${batch}-replay`,'benchmark-report.json')) : undefined
    if (state?.observation) observations.push(state.observation.usedPercent)
    const ids = frozen.catalog.companyIds.slice((batch-1)*5,batch*5)
    const positions = Object.values(checkpoint?.sourceResults ?? {}).flatMap((s: any) => s.positions)
    const unique = new Set(positions.map((p: any) => p.id)).size
    batches.push({batch,companyIds:ids,completed:checkpoint?.completedCompanyIds.length??0,complete:checkpoint?.successfulCompanyCount??0,
      reads:Object.values(checkpoint?.sourceBudgets??{}).reduce((sum:number,b:any)=>sum+b.reads,0),observations:unique,
      accepted:review?.accepted??0,excluded:review?.excluded??0,pending:review?unique-review.accepted-review.excluded:unique,
      classification:review?'validated':task?.status==='failed_or_uncertain'&&state?.reason==='quota_hard_stop'?'blocked_by_budget':task?.status??'not_started',sqlVerified:!!sql,sqlVacancies:sql?.accepted??[],
      batchUsedPoints:state?.observation&&analysis?state.observation.usedPercent-analysis.batchBudget.baseline.usedPercent:null,
      stopReason:state?.reason??checkpoint?.stopReason??'unattempted',replay:replay?{complete:replay.completeCompanies.length,reads:replay.readerCalls,...replayReport?.classification}:null})
    for(const id of ids){
      const company=frozen.catalog.companies.find((c:any)=>c.id===id), rows=Object.values(checkpoint?.sourceResults??{}).filter((s:any)=>s.audit.source.database.companyId===id) as any[]
      const done=checkpoint?.completedCompanyIds.includes(id),complete=checkpoint?.successfulCompanyIds.includes(id)
      const issues=[...rows.flatMap(s=>s.audit.issues),...frozen.catalog.issues.filter((s:string)=>s.startsWith(`company:${id}:`))]
      const row={batch,id,name:company.name,status:complete?'complete':done?'partial_or_unsupported':rows.length?'interrupted':'unattempted',sourceCount:rows.length,completeSources:rows.filter(s=>s.audit.status==='complete').length,observations:new Set(rows.flatMap(s=>s.positions.map((p:any)=>p.id))).size,issues}
      companies.push(row);if(!complete)failures.push(row)
    }
    if(task?.tokenUsage)tokens.push({batch,task:'classification',usage:task.tokenUsage,kind:'cumulative_thread_snapshot'})
  }
  const engine=await optional(join(root,'tasks','engine-readers','result.json'));if(engine?.tokenUsage)tokens.push({phase:'implementation',usage:engine.tokenUsage,kind:'cumulative_thread_snapshot'})
  const sqlAudit=await optional(join(root,'audit-sql-receipt.json'))
  const tokenTotals=tokens.reduce((a,t)=>{const u=t.usage.total;return {total:a.total+u.totalTokens,input:a.input+u.inputTokens,cachedInput:a.cachedInput+u.cachedInputTokens,output:a.output+u.outputTokens}}, {total:0,input:0,cachedInput:0,output:0})
  const latestPercent=Math.max(...observations),complete=companies.filter(c=>c.status==='complete').length
  const report={version:1,generatedAt:new Date().toISOString(),campaignId:budget.campaignId,companyCount:30,
    attempted:companies.filter(c=>c.status!=='unattempted').length,complete,coverageTarget:29,targetPassed:complete>=29,
    observations:batches.reduce((n,b)=>n+b.observations,0),accepted:batches.reduce((n,b)=>n+b.accepted,0),pending:batches.reduce((n,b)=>n+b.pending,0),
    budget:{baseline:budget.baseline.usedPercent,latestObservedPercent:latestPercent,usedPoints:latestPercent-budget.baseline.usedPercent,limitPoints:5,overshootPoints:Math.max(0,latestPercent-budget.stopAtPercent),measurement:'account-wide rounded/delayed weekly percentage'},
    batches,companies,tokens,tokenTotals,sqlAudit,aiCompanyRepairs:0,paidApiCalls:0,applications:0,knownLimitations:['Half-point repair cap cannot be measured by whole-point meter; no AI company repair was dispatched.','Pending classification is not exclusion.','A source-level complete result does not imply all sources for that company were complete.','No savings claim without equivalent completed replay/classification.','Thread token snapshots exclude unreported coordinator usage; cached input is included in input, not additional to it.']}
  await atomicJson(join(root,'REPORT.json'),report);await atomicJson(join(root,'failures.json'),failures)
  await atomicJson(join(root,'robot-rejections.json'),failures.filter(r=>r.issues.some((s:string)=>/robot|captcha/i.test(s))))
  await writeFile(join(root,'companies.csv'),['batch,company_id,company,status,observations,issues',...companies.map(c=>[c.batch,c.id,c.name,c.status,c.observations,c.issues.join('; ')].map(x=>`"${String(x).replace(/"/g,'""')}"`).join(','))].join('\n')+'\n')
  await writeFile(join(root,'REPORT.md'),[
    '# Controlled 30-company benchmark','',`Attempted ${report.attempted}/30; complete ${complete}/30. Target 29/30: ${report.targetPassed?'passed':'not met'}.`,
    `Captured ${report.observations} distinct per-batch observations; accepted ${report.accepted}; pending/review ${report.pending}.`,
    `Weekly allowance: ${budget.baseline.usedPercent}% → ${latestPercent}% (${report.budget.usedPoints}/5 points observed). Separate paid API calls: 0. Applications: 0.`,
    '', '| Batch | Finalized | Complete | Reads | Observations | Accepted | Pending/review | Classification |', '|---|---:|---:|---:|---:|---:|---:|---|',
    ...batches.map(b=>`| ${b.batch} | ${b.completed}/5 | ${b.complete}/5 | ${b.reads} | ${b.observations} | ${b.accepted} | ${b.pending} | ${escape(b.classification)} |`),
    '', '## Per-company coverage', '', '| Batch / company | Status | Complete sources | Observations | Issues |','|---|---|---:|---:|---|',
    ...companies.map(c=>`| ${c.batch}: ${c.id} ${escape(c.name)} | ${c.status} | ${c.completeSources}/${c.sourceCount} | ${c.observations} | ${escape(c.issues.join('; '))} |`),
    '', '## SQL and replay', '',
    `Verified SQL run audits: ${sqlAudit?.runs?.length??0}. Accepted vacancy rows: ${batches.reduce((n,b)=>n+b.sqlVacancies.length,0)}. Pending observations remain audit data.`,
    ...batches.flatMap(b=>b.sqlVacancies.map((v:any)=>`- SQL vacancy ${v.id}: [${escape(v.title)}](${v.canonical_url}); stacks ${v.stack_ids.join(', ')}; saved description ${v.description_characters} characters.`)),
    ...batches.filter(b=>b.replay).map(b=>`- Batch ${b.batch} replay: ${b.replay.complete}/5 complete, ${b.replay.reads} reader calls (initial ${b.reads}), ${b.replay.cacheHits??'unknown'} decision cache hits, ${b.replay.sessionReviews??'unknown'} new session assessments. Equal reads do not show crawling savings.`),
    '', '## Measured worker usage', '',
    `Reported worker snapshots: ${tokenTotals.total} total tokens, including ${tokenTotals.cachedInput} cached input tokens; ${tokenTotals.input-tokenTotals.cachedInput} uncached input and ${tokenTotals.output} output. These are cumulative across model/tool turns, not unique document sizes.`,
    ...tokens.map(t=>`- ${t.phase??'Batch '+t.batch+' '+t.task}: ${t.usage.total.totalTokens} total; ${t.usage.total.cachedInputTokens} cached input.`),
    'Coordinator tokens are unavailable here. No exact conversion from these token counts to weekly allowance is available.',
    '', '## Limits and evidence', '', ...report.knownLimitations.map(s=>'- '+s),
    '- Batch directories retain page snapshots, action checkpoints, budget ledgers and review artifacts. SQL receipts identify any promoted rows.',
    '- See REPORT.json for measured thread token snapshots. Missing usage is unknown, not zero. Cached/reasoning tokens are subsets and must not be added twice.',
    '- No dedicated Workday/Workable/Huntflow reader was established in this implementation; public generic extraction remains subject to its evidence checks.', ''
  ].join('\n'))
  console.log(JSON.stringify({report:join(root,'REPORT.md'),attempted:report.attempted,complete,observations:report.observations,accepted:report.accepted,pending:report.pending,quota:report.budget}))
  return report
}
