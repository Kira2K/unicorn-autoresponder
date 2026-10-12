import { SOL_MODEL } from '../infrastructure/sol-model.ts'
import { mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { atomicJson, createFileStore } from '../infrastructure/store.ts'
import type { VacancyCollection } from '../vacancy_collection/index.ts'
import type { SelectionRules } from './rules.ts'
import type { ExchangeRates } from './salary.ts'
import { buildAssessmentPacket } from './session-packet.ts'
import { buildAssessmentBatches, classificationInstructions } from './assessment-batches.ts'
import { runClassificationBatches, type AssessmentRecord, type AssessmentStore, type ClassificationTransport } from './classification-runner.ts'
import { createAssessmentPrecheck } from './precheck.ts'
import { classifyWithReuse, semanticCacheHit, type CachedAssessment } from './reuse.ts'

export type SessionClassificationPolicy={version:1;model:typeof SOL_MODEL;effort:'medium';promptHash:string;initialBytes:number;expandedBytes:number;maxBatches:number;maxOutputTokens:number;outputLimitMode:'observed';retries:0;tools:'none';approvedBy:string;approvedAt:string;approvalReference:string;sha256:string}
// Packet protocol is stable across FX availability. Relevant rate evidence is bound per posting.
export const sessionPolicyKey=(policy:SessionClassificationPolicy,_rates?:ExchangeRates)=>'session-batch-v2:'+policy.sha256
export function validateSessionPolicy(policy:SessionClassificationPolicy){
  const {sha256,...content}=policy
  if(policy.outputLimitMode!=='observed')throw Error('session_output_limit_is_observed_not_provider_enforced')
  if(policy.version!==1||digest(content)!==sha256||policy.model!==SOL_MODEL||policy.effort!=='medium'||policy.promptHash!==digest(classificationInstructions)||policy.tools!=='none'||policy.retries!==0||policy.initialBytes!==65536||policy.expandedBytes!==131072||!Number.isSafeInteger(policy.maxBatches)||policy.maxBatches<1||!Number.isSafeInteger(policy.maxOutputTokens)||policy.maxOutputTokens<1||!policy.approvedBy?.trim()||!policy.approvalReference?.trim()||!Number.isFinite(Date.parse(policy.approvedAt)))throw Error('approved_session_classification_policy_required')
}

/** Durable intent is separate from result, so failed result persistence never frees dispatch allowance. */
export function createAssessmentStore(directory:string):AssessmentStore {
  const load=async(path:string)=>{try{return JSON.parse(await readFile(path,'utf8')) as AssessmentRecord}catch(error:any){if(error.code==='ENOENT')return undefined;throw error}}
  const file=(id:string,suffix:string)=>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('invalid_assessment_batch_id');return join(directory,id+suffix)}
  return {
    load:async id=>await load(file(id,'.result.json'))??await load(file(id,'.intent.json')),
    claim:async(id,value)=>{await mkdir(directory,{recursive:true});let handle;try{handle=await open(file(id,'.intent.json'),'wx',0o600)}catch(error:any){if(error.code==='EEXIST')return false;throw error}try{await handle.writeFile(JSON.stringify(value));await handle.sync()}finally{await handle.close()}return true},
    save:(id,value)=>atomicJson(file(id,'.result.json'),value),
  }
}

/** Collection -> cache/prechecks -> bounded session batches -> existing validated classification. No SQL here. */
export async function classifyWithSessionBatches(input:{collection:VacancyCollection;rules:SelectionRules;cache:Record<string,CachedAssessment>;fallbackCache?:Record<string,CachedAssessment>;policy:SessionClassificationPolicy;exchangeRates?:ExchangeRates},deps:{transport:ClassificationTransport;store:AssessmentStore;admit():Promise<void>;now?:()=>Date;signal?:AbortSignal}){
  validateSessionPolicy(input.policy)
  const policyKey=sessionPolicyKey(input.policy,input.exchangeRates), stacks=input.collection.scope?.stacks??[]
  const check=createAssessmentPrecheck(input.rules,input.collection.scope,deps.now?.(),input.exchangeRates)
  const packets=[],pending:{positionId:string;reason:string}[]=[]
  for(const p of input.collection.positions){
    if(check(p)||semanticCacheHit(p,stacks,input.rules,policyKey,[input.cache[p.id],input.fallbackCache?.[p.id]],input.exchangeRates))continue
    let packet=buildAssessmentPacket({collectionRunId:input.collection.runId,position:p,stacks,rules:input.rules,exchangeRates:input.exchangeRates})
    if(packet.status==='pending')packet=buildAssessmentPacket({collectionRunId:input.collection.runId,position:p,stacks,rules:input.rules,expanded:true,exchangeRates:input.exchangeRates})
    if(packet.status==='ready')packets.push(packet.packet);else pending.push({positionId:p.id,reason:packet.reason})
  }
  const plan=buildAssessmentBatches(packets,{initial:input.policy.initialBytes,expanded:input.policy.expandedBytes})
  pending.push(...plan.pending)
  const selected=plan.batches.slice(0,input.policy.maxBatches)
  for(const batch of plan.batches.slice(input.policy.maxBatches))for(const p of batch.payload.vacancies)pending.push({positionId:p.positionId,reason:'approved_batch_limit'})
  const result=await runClassificationBatches(selected,{...deps,now:()=> (deps.now?.()??new Date()).toISOString(),policyHash:input.policy.sha256,settings:{model:input.policy.model,effort:input.policy.effort,maxOutputTokens:input.policy.maxOutputTokens,signal:deps.signal}}).catch(error=>{
    if(error.message!=='verified_tool_free_classification_transport_required'&&!error.message.startsWith('codex_classification_wire_preflight_failed')&&!/^sol_(model_not_listed:|reasoning_effort_not_listed:|catalog_preflight_failed$)/.test(error.message))throw error
    return {completed:[],responses:[],reused:0,pending:selected.map(b=>({batchId:b.id,positionIds:b.payload.vacancies.map(p=>p.positionId),reason:error.message}))}
  })
  for(const batch of result.pending)for(const positionId of batch.positionIds)pending.push({positionId,reason:batch.reason})
  const decisions=Object.assign({},...result.completed.map(r=>r.decisions))
  const assessmentProvenance=result.completed.length?{origin:'assistant_session' as const,reviewedBy:`${input.policy.model} / constrained session classifier / medium`,reviewedAt:(deps.now?.()??new Date()).toISOString(),reviewHash:digest({policy:input.policy.sha256,batches:result.completed.map(r=>r.batchId),decisions})}:undefined
  const assessment=await classifyWithReuse({...input,policy:policyKey,assessmentProvenance},{now:deps.now,pendingReasons:Object.fromEntries(pending.map(p=>[p.positionId,p.reason])),assess:result.completed.length?async p=>{if(!decisions[p.id])throw Error('assessment_pending');return decisions[p.id]}:undefined})
  return {...assessment,batches:result,packetPending:pending}
}

/** Whole-run lock prevents parallel invocations from dispatching different batches concurrently. */
export async function withSessionClassificationLock<T>(directory:string,runId:string,work:(store:AssessmentStore)=>Promise<T>) {
  const release=await createFileStore(directory).lock('classification-'+digest(runId).slice(0,32))
  try{return await work(createAssessmentStore(directory))}finally{await release()}
}
