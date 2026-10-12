import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { createWebsiteStrategy } from './discover.ts'
import { assertAllowedUrl } from '../infrastructure/navigation-policy.ts'
import { CollectionPersistenceError } from './persistence-error.ts'
import type { Source, SourceAudit, PageReader, PageDocument, Position } from '../types.ts'
import type { SourceMemory, SourceAction, SourceTrace, SourceRecipe } from './source-memory.ts'
import { individualPostingGate, sourceUnavailable } from './source-memory.ts'
import { vacancyLinks } from './navigation.ts'
import { descriptionIssue } from './description-quality.ts'
import type { TitlePrecheck } from './title-precheck.ts'
import { mergePublicationDateOutcomes } from './title-precheck.ts'
import { positionId } from '../infrastructure/identity.ts'
import { sourceRecoveryEntry } from './source-recovery.ts'

/** One source, one bounded repair. Navigation preserves the original SQL source identity. */
export async function executeSource(input: { source: Source; memory: SourceMemory; maxPages: number; maxSourceMs?: number; hintUrls?: string[]; previousPositions?: Position[]; retryReview?: boolean; titlePrecheck?:TitlePrecheck }, deps: { reader: PageReader; action: (action:SourceAction)=>Promise<void> }) {
  const maxSourceMs=input.maxSourceMs??300000
  if(!Number.isInteger(maxSourceMs)||maxSourceMs<1000||maxSourceMs>1800000)throw Error('invalid_source_time_budget')
  const { source, memory } = input, startedAt = new Date().toISOString(), actions: SourceAction[] = [], documents = new Map<string,PageDocument>()
  let reads = 0, replay = !!memory.recipe, repaired = false
  const trace: SourceTrace = { mode:replay?'replay':'fresh', startedAt, finishedAt:startedAt, actions, requests:0, recipeRevision:memory.recipe?.revision }
  const emit = async (action: SourceAction) => { actions.push(action); try { await deps.action(action) } catch(cause) { throw new CollectionPersistenceError('action_checkpoint_failed',{cause}) } }
  if (sourceUnavailable(memory.state) && !input.retryReview) {
    trace.mode='paused'; trace.finishedAt=new Date().toISOString()
    const reason=memory.state.operatorAvailability?.reason?.trim()
    return { positions:[] as Position[], audit:{source,status:'unavailable' as const,pages:[],found:0,issues:[reason?`Source marked unavailable by operator: ${reason}`:'Source marked unavailable; explicit retry review is required.'],trace} }
  }
  if (memory.state.review?.status === 'pending' && !input.retryReview && !individualPostingGate(source,memory.state.review.gate)) {
    trace.mode='paused'; return { positions:[] as Position[], audit:{source,status:'unavailable' as const,pages:[],found:0,issues:['Source access awaits human review; not retried.'],accessGate:memory.state.review.gate,trace} }
  }
  if(memory.state.review?.status==='pending'&&individualPostingGate(source,memory.state.review.gate))await emit({operation:'individual_posting_gate_preserved',url:memory.state.review.gate.url,at:new Date().toISOString(),outcome:'ok',detail:'Historical internal-posting login gate is not evidence of a blocked public board; inspect the public listing only.'})
  const reader: PageReader = { read: async url => {
    assertAllowedUrl(url)
    if (reads >= input.maxPages || Date.now()-Date.parse(startedAt)>=maxSourceMs) throw Error('source_shared_page_or_time_budget_exhausted')
    reads++
    const start=Date.now()
    try {
      // A filtered position set cannot reconstruct the original complete ATS feed after HTTP 304.
      const validator=!input.titlePrecheck && memory.state.snapshot?.status==='complete' && memory.state.validator?.url===url ? memory.state.validator.http : undefined
      const previous:PageDocument|undefined=validator && input.previousPositions ? {url,jobs:input.previousPositions,links:[],text:input.previousPositions.map(p=>p.title).join('\n'),explicitlyEmpty:!input.previousPositions.length,httpValidator:validator}:undefined
      const page=await deps.reader.read(url,{...(replay && memory.recipe?.controls[url] ? {steps:memory.recipe.controls[url]} : {}),...(memory.recipe?.extraction?{extraction:memory.recipe.extraction}:{}),...(previous?{previous}:{}),onAction:emit})
      documents.set(url,page)
      await emit({operation:'page_read',url:page.url,at:new Date().toISOString(),durationMs:Date.now()-start,outcome:'ok',detail:page.method??'reader'})
      return page
    } catch(error) {
      if(error instanceof CollectionPersistenceError) throw error
      await emit({operation:'page_read',url,at:new Date().toISOString(),durationMs:Date.now()-start,outcome:'failed',detail:error instanceof Error?error.message:'read_failed'})
      throw error
    }
  } }
  const run = async (entries:string[]) => {
    for(const url of entries) assertAllowedUrl(url)
    return createWebsiteStrategy({reader,concurrency:1,maxPages:Math.max(1,input.maxPages-reads),entryUrls:()=>entries,titlePrecheck:input.titlePrecheck}).discover([source])
  }
  const valid = (result:Awaited<ReturnType<typeof run>>) => result.audit[0].status==='complete' && (result.positions.length ? result.positions.every(p=>!descriptionIssue(p.description)) : [...documents.values()].some(p=>p.explicitlyEmpty) || !!result.audit[0].titlePrecheck?.skipped.length || !!result.audit[0].publicationDatePrecheck?.outcomes.some(row=>row.decision==='excluded'))
  let result = await run(memory.recipe?.listingUrls ?? input.hintUrls ?? [source.url,...source.listingUrls??[]])
  // Repair entries have no titles. Keep first-pass exclusions so rediscovery cannot
  // turn rejected listing links into unlabelled detail reads.
  const rejected=new Set([...result.audit[0].titlePrecheck?.skipped??[],...(result.audit[0].publicationDatePrecheck?.outcomes??[]).filter(row=>row.decision==='excluded')].map(row=>positionId(row.url)))
  const originEntry=sourceRecoveryEntry(source,[...documents.values()])
  const alternatives=[...new Set([source.url,...input.hintUrls??[],...source.listingUrls??[],...[...documents.values()].flatMap(page=>vacancyLinks(page.links,page.url,source.name).map(l=>l.url)),...(originEntry?[originEntry]:[])])]
    .filter(url=>!rejected.has(positionId(url)) && (!documents.has(url) || replay && !!memory.recipe?.controls[url]?.length))
  if (!valid(result) && !result.audit[0].accessGate && reads<input.maxPages && Date.now()-Date.parse(startedAt)<maxSourceMs && alternatives.length) {
    repaired=true; replay=false
    await emit({operation:'repair_started',url:alternatives[0],at:new Date().toISOString(),outcome:'ok',detail:'Use an unvisited listing or rediscover without the failed saved controls'})
    const first=result
    result=await run(alternatives)
    const seenAgain=new Set(result.positions.map(p=>p.id)),missingFirst=first.positions.filter(p=>!seenAgain.has(p.id))
    result.positions=[...new Map([...first.positions,...result.positions].map(p=>[p.id,p])).values()]
    result.audit[0].found=result.positions.length
    if(missingFirst.length){result.audit[0].status='partial';result.audit[0].issues.push('Alternate source did not reconcile all previously inspected postings; prior results and coverage gaps retained')}
    if(first.audit[0].titlePrecheck&&result.audit[0].titlePrecheck)result.audit[0].titlePrecheck.skipped=[...new Map([...first.audit[0].titlePrecheck.skipped,...result.audit[0].titlePrecheck.skipped].map(skip=>[JSON.stringify([skip.url,skip.title,skip.ruleId]),skip])).values()]
    if(input.titlePrecheck?.publication)result.audit[0].publicationDatePrecheck=mergePublicationDateOutcomes(first.audit[0].publicationDatePrecheck,result.audit[0].publicationDatePrecheck?.outcomes??[],input.titlePrecheck.publication.policyHash)
    trace.repairOutcome=valid(result)?'succeeded':'failed'
    await emit({operation:'repair_finished',url:alternatives[0],at:new Date().toISOString(),outcome:valid(result)?'ok':'failed',detail:trace.repairOutcome})
    if (!valid(result)) {
      // Preserve fully inspected jobs from the first path when rediscovery is also partial.
      result.positions=[...new Map([...first.positions,...result.positions].map(p=>[p.id,p])).values()]
      result.audit[0].status='partial'; result.audit[0].pages=[...new Set([...first.audit[0].pages,...result.audit[0].pages])]; result.audit[0].found=result.positions.length
      result.audit[0].issues=[...new Set([...first.audit[0].issues,...result.audit[0].issues,'Recipe validation failed; bounded rediscovery exhausted'])]
    }
  } else if (!valid(result) && !result.audit[0].accessGate) {
    trace.repairOutcome='not_attempted'
    await emit({operation:'repair_skipped',url:source.url,at:new Date().toISOString(),outcome:'ok',detail:alternatives.length?'Shared source budget exhausted':'No new navigation or extraction approach; identical checkpoint replay is not repair'})
  }
  const audit=result.audit[0]
  if (valid(result)) {
    const validatedPages=[...documents.values()].filter(page=>(!page.partial||page.listingInventoryComplete)&&result.audit[0].pages.includes(page.url))
    const entry = validatedPages.find(page=>page.completeListing||page.listingInventoryComplete)?.url ?? validatedPages.find(page=>page.jobs.length>1 || page.links.some(l=>/\/(?:jobs?|j|o)\/[^/?]+/i.test(l.url)))?.url ?? result.audit[0].pages[0]
    const content={version:1 as const,listingUrls:[entry],methods:[...new Set([...documents.values()].map(p=>p.method??'reader'))],controls:Object.fromEntries([...documents.entries()].filter(([,p])=>p.controls?.length).map(([url,p])=>[url,p.controls!])),checks:{substantiveDescriptions:true as const,paginationComplete:true as const},origin:'observed' as const}
    trace.recipe={...content,revision:digest(content),verifiedAt:new Date().toISOString()}
    // A validator is reusable only for a single self-contained ATS response, not a paginated HTML shell.
    if(documents.size===1){const page=[...documents.values()][0];if(page.httpValidator)trace.validator={url:page.url,http:page.httpValidator}}
  } else if(audit.status==='complete') { audit.status='partial'; audit.issues.push('Descriptions or empty-state evidence did not validate') }
  if (audit.status==='complete') {
    const current=new Set(result.positions.map(p=>p.url))
    for(const previous of input.previousPositions??[]) {
      if(input.titlePrecheck?.evaluate(previous.title).decision==='excluded')continue
      if(current.has(previous.url)||reads>=input.maxPages) continue
      try {
        const page=await reader.read(previous.url)
        if(page.closedEvidence) (trace.closed??=[]).push({url:previous.url,at:page.fetchedAt??new Date().toISOString(),evidence:page.closedEvidence})
      } catch(error) { if(error instanceof CollectionPersistenceError) throw error; audit.issues.push('Previously observed posting could not be reconciled: '+previous.url) }
    }
  }
  trace.requests=Math.min(reads,input.maxPages); trace.finishedAt=new Date().toISOString(); trace.repaired=repaired
  if(repaired && memory.recipe) trace.previousRecipe=memory.recipe
  audit.trace=trace
  return {positions:result.positions,audit}
}
