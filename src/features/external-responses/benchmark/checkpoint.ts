import { readFile } from 'node:fs/promises'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { atomicJson } from '../infrastructure/store.ts'
import { emptyCompanyFailureGate } from './company-failure-gate.ts'
import type { CompanyFailureGateState } from './company-failure-gate.ts'
import type { Position, SourceAudit } from '../types.ts'
import type { SourceAction } from '../vacancy_collection/source-memory.ts'

export type SourceBudget={reads:number;activeMs:number;engineCandidates:number}
export type BenchmarkSourceResult={positions:Position[];audit:SourceAudit;reuse:'cold'|'tested_binding'|'recipe_replay'|'unavailable'}
export type BenchmarkCheckpoint={version:1;campaignId:string;mode:'cold'|'transfer';configHash:string;status:'preflight_pending'|'running'|'paused'|'hard_stopped'|'complete';createdAt:string;updatedAt:string;sourceBudgets:Record<string,SourceBudget>;sourceActions:Record<string,SourceAction[]>;sourceResults:Record<string,BenchmarkSourceResult>;failureGate:CompanyFailureGateState;completedCompanyIds:string[];successfulCompanyIds:string[];successfulCompanyCount:number;stopReason?:string}

const validBudget=(value:SourceBudget)=>[value.reads,value.activeMs,value.engineCandidates].every(n=>Number.isSafeInteger(n)&&n>=0)

async function optional(path:string){try{return JSON.parse(await readFile(path,'utf8'))}catch(error:any){if(error.code==='ENOENT')return undefined;throw error}}
export async function openBenchmarkCheckpoint(input:{path:string;campaignId:string;mode:'cold'|'transfer';configuration:unknown;resume:boolean;now?:()=>Date}) {
  const now=input.now??(()=>new Date()),configHash=digest(input.configuration),saved=await optional(input.path) as BenchmarkCheckpoint|undefined
  if(saved&&!input.resume)throw Error('benchmark_checkpoint_exists_use_resume')
  if(!saved&&input.resume)throw Error('benchmark_checkpoint_missing')
  if(saved&&(saved.version!==1||saved.campaignId!==input.campaignId||saved.mode!==input.mode||saved.configHash!==configHash))throw Error('benchmark_checkpoint_scope_changed')
  if(saved?.failureGate.hardStopped||saved?.status==='hard_stopped')saved.status='hard_stopped'
  let state=saved??{version:1 as const,campaignId:input.campaignId,mode:input.mode,configHash,status:'preflight_pending' as const,createdAt:now().toISOString(),updatedAt:now().toISOString(),sourceBudgets:{},sourceActions:{},sourceResults:{},failureGate:emptyCompanyFailureGate(),completedCompanyIds:[],successfulCompanyIds:[],successfulCompanyCount:0}
  state.sourceActions??={};state.sourceResults??={};state.successfulCompanyIds??=[];state.successfulCompanyCount??=state.successfulCompanyIds.length
  if(new Set(state.successfulCompanyIds).size!==state.successfulCompanyIds.length||state.successfulCompanyCount!==state.successfulCompanyIds.length||state.successfulCompanyIds.some(id=>!state.completedCompanyIds.includes(id)))throw Error('benchmark_success_count_invalid')
  if(Object.values(state.sourceBudgets).some(value=>!validBudget(value)))throw Error('benchmark_source_budget_invalid')
  const save=async()=>{state.updatedAt=now().toISOString();await atomicJson(input.path,state)}
  await save()
  return {get:()=>structuredClone(state),save,replace:async(next:BenchmarkCheckpoint)=>{
    if(state.failureGate.hardStopped&&!next.failureGate.hardStopped)throw Error('benchmark_hard_stop_cannot_be_erased')
    for(const [sourceId,current] of Object.entries(state.sourceBudgets)) {
      const candidate=next.sourceBudgets[sourceId]
      if(!candidate||!validBudget(candidate)||candidate.reads<current.reads||candidate.activeMs<current.activeMs||candidate.engineCandidates<current.engineCandidates)throw Error('benchmark_source_budget_not_monotonic')
    }
    if(Object.values(next.sourceBudgets).some(value=>!validBudget(value)))throw Error('benchmark_source_budget_invalid')
    if(state.completedCompanyIds.some(id=>!next.completedCompanyIds.includes(id)))throw Error('benchmark_completed_company_cannot_be_erased')
    if(state.successfulCompanyIds.some(id=>!next.successfulCompanyIds.includes(id)))throw Error('benchmark_successful_company_cannot_be_erased')
    if(new Set(next.successfulCompanyIds).size!==next.successfulCompanyIds.length||next.successfulCompanyCount!==next.successfulCompanyIds.length||next.successfulCompanyIds.some(id=>!next.completedCompanyIds.includes(id)))throw Error('benchmark_success_count_invalid')
    if(state.stopReason==='successful_company_target_reached'&&next.stopReason!==state.stopReason)throw Error('benchmark_success_target_stop_cannot_be_erased')
    if(Object.keys(state.sourceResults).some(id=>!next.sourceResults[id]))throw Error('benchmark_source_result_cannot_be_erased')
    state=structuredClone(next);await save()
  },consumeSourceBudget:async(sourceId:string,delta:Partial<SourceBudget>)=>{
    if(Object.values(delta).some(value=>value!==undefined&&(!Number.isSafeInteger(value)||value<0)))throw Error('benchmark_source_budget_delta_invalid')
    const current=state.sourceBudgets[sourceId]??{reads:0,activeMs:0,engineCandidates:0},next={reads:current.reads+(delta.reads??0),activeMs:current.activeMs+(delta.activeMs??0),engineCandidates:current.engineCandidates+(delta.engineCandidates??0)}
    if(next.reads>200||next.activeMs>900000||next.engineCandidates>2)throw Error('benchmark_source_budget_exhausted')
    state.sourceBudgets[sourceId]=next;await save();return structuredClone(next)
  },recordSourceAction:async(sourceId:string,action:SourceAction)=>{(state.sourceActions[sourceId]??=[]).push(structuredClone(action));await save()},saveSourceResult:async(sourceId:string,result:BenchmarkSourceResult)=>{state.sourceResults[sourceId]=structuredClone(result);await save()}}
}
