import { SOL_MODEL } from '../infrastructure/sol-model.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { atomicJson } from '../infrastructure/store.ts'
import { assertAllowedUrl } from '../infrastructure/navigation-policy.ts'
import type { PageDocument, Source, SourceAudit } from '../types.ts'
import type { ControlStep, ExtractionSelectors, SourceAction } from './source-memory.ts'

export type RepairPlan = { entryUrls: string[]; reads?: {url:string;steps?:ControlStep[]}[]; extraction?:ExtractionSelectors }
export type Investigation = { version:1; id:string; runId:string; sourceId:string; source:Source; audit:SourceAudit; observations:PageDocument[]; remainingReads:number; remainingMs:number; attempt:number; model:typeof SOL_MODEL;reasoningEffort:'high';packet?:{limitBytes:number;expanded:boolean;bytes:number;complete:boolean;referencesOnly?:boolean;omissionNotice?:string} }
export type RepairProposal = { version:1; requestId:string; sourceId:string; model:typeof SOL_MODEL; origin:'assistant_session'; action:'repair'|'defer'; reason:string; plan?:RepairPlan; engine?:{id:string;version:number;sha256:string}; verifiedLinks?:{url:string;from:string;evidence:string}[] }
export type CollectionReasoner = { investigate(request:Investigation):Promise<RepairProposal|undefined>; inspections?(request:Investigation):Promise<{calls:number;activeMs:number;observations:PageDocument[];actions:SourceAction[]}> }

export function investigation(input:Omit<Investigation,'version'|'id'|'sourceId'|'model'|'reasoningEffort'>):Investigation {
  const bound={...input,sourceId:input.source.database?.sourceId??input.source.url,model:SOL_MODEL,reasoningEffort:'high' as const}
  return {version:1,...bound,id:digest(bound)}
}
export const INVESTIGATION_PACKET_LIMITS={initial:32*1024,expanded:64*1024} as const
export function assertInvestigation(request:Investigation) {
  const {version,id,...body}=request
  if(version!==1||digest(body)!==id)throw Error('inspection_request_hash_invalid')
}
function sealFocusedRequest(request:Investigation) {
  // bytes is derived but included in the binding: stabilize its digit count before hashing.
  for(let i=0;i<4;i++){
    const bytes=Buffer.byteLength(JSON.stringify(request))
    if(request.packet!.bytes===bytes)break
    request.packet!.bytes=bytes
  }
  const {version,id,...body}=request
  request.id=digest(body)
  if(request.packet!.bytes!==Buffer.byteLength(JSON.stringify(request)))throw Error('investigation_packet_size_unstable')
  return request
}
/** References every observed page by exact hash/path and adds bounded excerpts for source diagnosis. */
export function focusedInvestigation(input:Omit<Investigation,'version'|'id'|'sourceId'|'model'|'reasoningEffort'|'observations'|'packet'>,documents:PageDocument[],expanded=false):Investigation {
  const limitBytes=expanded?INVESTIGATION_PACKET_LIMITS.expanded:INVESTIGATION_PACKET_LIMITS.initial
  // The full run audit stays on disk. Exclusion lists and prior traces are not the current failure.
  const compactAudit:SourceAudit={source:input.source,status:input.audit.status,found:input.audit.found,
    pages:input.audit.pages.slice(-6),issues:input.audit.issues.slice(-8),terminal:input.audit.terminal,accessGate:input.audit.accessGate}
  const reference=(page:PageDocument,textBytes:number,linkCount:number,jobCount:number):PageDocument=>({
    url:page.url,text:page.text.slice(0,textBytes),links:page.links.slice(0,linkCount),jobs:page.jobs.slice(0,jobCount).map(job=>({...job,description:job.description.slice(0,expanded?1200:600)})),
    completeListing:page.completeListing,partial:page.partial,fetchedAt:page.fetchedAt,accessGate:page.accessGate,method:page.method,controls:page.controls,
    explicitlyEmpty:page.explicitlyEmpty,closedEvidence:page.closedEvidence,diagnostics:page.diagnostics?{...page.diagnostics,cards:page.diagnostics.cards?.slice(0,expanded?20:8),listingRequests:page.diagnostics.listingRequests?.slice(0,expanded?20:8)}:undefined,
    evidenceRef:page.evidenceRef,evidenceHash:page.evidenceHash??digest({...page,evidenceRef:undefined,evidenceHash:undefined})})
  const variants:[[number,number,number],[number,number,number],[number,number,number]] = expanded?[[2400,40,16],[1000,15,8],[300,4,2]]:[[1200,20,8],[500,8,4],[200,3,1]]
  for(const [textBytes,links,jobs] of variants) {
    const observations=documents.map(page=>reference(page,textBytes,links,jobs)),request=investigation({...input,audit:compactAudit,observations,packet:{limitBytes,expanded,bytes:0,complete:documents.every(page=>!!page.evidenceRef)}})
    sealFocusedRequest(request)
    if(request.packet!.bytes<=limitBytes)return request
  }
  const observations=documents.map(page=>({url:page.url,text:'',links:[],jobs:[],evidenceRef:page.evidenceRef,
    evidenceHash:page.evidenceHash??digest({...page,evidenceRef:undefined,evidenceHash:undefined}),fetchedAt:page.fetchedAt})),request=investigation({...input,audit:compactAudit,observations,packet:{limitBytes,expanded,bytes:0,complete:documents.every(page=>!!page.evidenceRef),referencesOnly:true,omissionNotice:'Observation text, links, jobs and diagnostics are OMITTED here. Empty arrays are structural placeholders, not observed absence. Read the hash-bound evidence or leave the diagnosis pending.'}})
  sealFocusedRequest(request)
  if(request.packet!.bytes>limitBytes)throw Error('investigation_packet_insufficient_explicit_pending')
  return request
}
/** The CLI publishes requests; a Codex session supplies proposals. No hidden API/model invocation. */
export function createSessionReasoner(directory:string):CollectionReasoner {
  return {async investigate(request) {
    const expected=request.attempt>1?INVESTIGATION_PACKET_LIMITS.expanded:INVESTIGATION_PACKET_LIMITS.initial
    if(Buffer.byteLength(JSON.stringify(request))>expected||request.packet?.limitBytes!==expected)throw Error('collection_investigation_packet_limit_invalid')
    await atomicJson(join(directory,request.id+'.request.json'),request)
    let value:RepairProposal
    try {value=JSON.parse(await readFile(join(directory,request.id+'.proposal.json'),'utf8'))}
    catch(error:any){if(error.code==='ENOENT')return;throw error}
    if(value.version!==1||request.sourceId!==request.source.database?.sourceId||request.model!==SOL_MODEL||request.reasoningEffort!=='high'||value.requestId!==request.id||value.sourceId!==request.sourceId||value.model!==SOL_MODEL||value.origin!=='assistant_session'||!['repair','defer'].includes(value.action)||!value.reason?.trim())throw Error('collection_proposal_binding_invalid')
    if(value.action==='repair'&&!value.plan&&!value.engine)throw Error('collection_repair_plan_required')
    return value
  },async inspections(request) {
    const {loadInspections}=await import('./source-inspection.ts')
    const ledger=await loadInspections(join(directory,request.id+'.inspections.json'),request)
    return {calls:ledger.reads.length,activeMs:ledger.reads.reduce((n,r)=>n+r.activeMs,0),observations:ledger.reads.flatMap(r=>r.page?[r.page]:[]),actions:ledger.reads.flatMap(r=>[...r.actions,{operation:'codex_diagnostic_read',url:r.page?.url??request.source.url,at:r.startedAt,outcome:r.status==='complete'?'ok' as const:'failed' as const,durationMs:r.activeMs,detail:r.error??request.id}])}
  }}
}
/** Future provider plugs into the same port. It cannot become active implicitly. */
export function createApiReasoner(input:{approved:boolean;generate?:(request:Investigation)=>Promise<RepairProposal>}):CollectionReasoner {
  if(!input.approved||!input.generate)throw Error('collection_api_reasoner_not_configured_or_approved')
  return {investigate:input.generate}
}
export function validateRepairPlan(plan:RepairPlan,request:Investigation,proposal:RepairProposal) {
  if(!Array.isArray(plan.entryUrls)||!plan.entryUrls.length||plan.entryUrls.length>12|| (plan.reads?.length??0)>32)throw Error('collection_repair_plan_invalid')
  const observed=new Set([request.source.url,...request.source.listingUrls??[],...request.observations.flatMap(p=>[p.url,...p.links.map(l=>l.url)])])
  const allowedHosts=new Set([...observed].map(url=>new URL(url).hostname))
  for(const link of proposal.verifiedLinks??[]) {
    const from=new URL(link.from),url=new URL(link.url)
    assertAllowedUrl(from.href);assertAllowedUrl(url.href)
    if(!/^https?:$/.test(url.protocol)||url.username||url.password||/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname)||!allowedHosts.has(from.hostname)||!link.evidence.trim())throw Error('official_source_link_evidence_required')
    // These are explicit session-reviewed alternative official source links; preserve provenance.
    observed.add(url.href);allowedHosts.add(url.hostname)
  }
  for(const url of [...plan.entryUrls,...plan.reads?.map(r=>r.url)??[]]) {
    const parsed=new URL(url);assertAllowedUrl(url)
    if(!/^https?:$/.test(parsed.protocol)||parsed.username||parsed.password||!allowedHosts.has(parsed.hostname))throw Error('collection_repair_url_outside_source')
    if(/\/(?:apply|login|register|sign-?in|sign-?up)(?:\/|$)/i.test(parsed.pathname)&&!observed.has(url))throw Error('collection_repair_non_listing_destination')
  }
}
