export type CompanySourceOutcome={sourceId:string;status:'complete'|'partial'|'unavailable';terminal:boolean;verifiedEmpty?:boolean;repairAttempted?:boolean;repairSucceeded?:boolean}
export type CompanyFailureOutcome={kind?:'live'|'fixture';companyId:string;sources:CompanySourceOutcome[];unsupportedSources:number;matchedVacancies?:number}
export type CompanyFailureRecord={companyId:string;failed:boolean;reasons:string[];diagnosis?:{status:'pending'|'complete';attemptsAllowed:1;repaired?:boolean}}
export type CompanyFailureGateState={version:1;consecutiveFailures:number;hardStopped:boolean;records:CompanyFailureRecord[]}
export const emptyCompanyFailureGate=():CompanyFailureGateState=>({version:1,consecutiveFailures:0,hardStopped:false,records:[]})

export function recordCompanyOutcome(state:CompanyFailureGateState,outcome:CompanyFailureOutcome,quotaStatus:'ready'|'admission_stopped'|'hard_stopped'='ready') {
  if(quotaStatus!=='ready')return {state:structuredClone(state),action:'quota_stop' as const}
  if(state.hardStopped)return {state:structuredClone(state),action:'hard_stop' as const}
  if(outcome.kind==='fixture')return {state:structuredClone(state),action:'ignored_fixture' as const}
  if(state.records.some(record=>record.companyId===outcome.companyId))throw Error('company_failure_already_evaluated')
  if(state.records.some(record=>record.diagnosis?.status==='pending'))throw Error('company_failure_diagnosis_required_before_next_company')
  const reasons:string[]=[]
  if(outcome.unsupportedSources>0)reasons.push(`unsupported_sources:${outcome.unsupportedSources}`)
  if(!outcome.sources.length&&outcome.unsupportedSources===0)reasons.push('company_sources_unattempted')
  for(const source of outcome.sources) {
    if(source.status!=='complete'||!source.terminal)reasons.push(`source:${source.sourceId}:${source.status}${source.terminal?'':':unterminated'}`)
    if(source.repairAttempted)reasons.push(`source:${source.sourceId}:repair_attempted`)
  }
  const failed=!!reasons.length,next=structuredClone(state)
  if(!failed){next.consecutiveFailures=0;next.records.push({companyId:outcome.companyId,failed:false,reasons:[]});return {state:next,action:'continue' as const}}
  next.consecutiveFailures++;const record:CompanyFailureRecord={companyId:outcome.companyId,failed:true,reasons}
  if(next.consecutiveFailures>=3){next.hardStopped=true;next.records.push(record);return {state:next,action:'hard_stop' as const}}
  record.diagnosis={status:'pending',attemptsAllowed:1};next.records.push(record)
  return {state:next,action:'pause_for_diagnosis' as const}
}

export function recordCompanySuccessTargetOutcome(state:CompanyFailureGateState,outcome:CompanyFailureOutcome,quotaStatus:'ready'|'admission_stopped'|'hard_stopped'='ready') {
  if(quotaStatus!=='ready')return {state:structuredClone(state),action:'quota_stop' as const,successful:false}
  if(state.records.some(record=>record.companyId===outcome.companyId))throw Error('company_failure_already_evaluated')
  if(state.records.some(record=>record.diagnosis?.status==='pending'))throw Error('company_failure_diagnosis_required_before_next_company')
  const reasons:string[]=[]
  if(!outcome.sources.length)reasons.push(outcome.unsupportedSources>0?`unsupported_sources:${outcome.unsupportedSources}`:'company_sources_unattempted')
  for(const source of outcome.sources)if(source.status!=='complete'||!source.terminal)reasons.push(`source:${source.sourceId}:${source.status}${source.terminal?'':':unterminated'}`)
  const failed=!!reasons.length,next=structuredClone(state)
  next.consecutiveFailures=failed?next.consecutiveFailures+1:0
  next.records.push({companyId:outcome.companyId,failed,reasons})
  return {state:next,action:'continue' as const,successful:!failed}
}

export function recordCompanyDiagnosis(state:CompanyFailureGateState,companyId:string,repaired:boolean,quotaStatus:'ready'|'admission_stopped'|'hard_stopped'='ready') {
  if(quotaStatus!=='ready')return {state:structuredClone(state),action:'quota_stop' as const}
  if(state.hardStopped)return {state:structuredClone(state),action:'hard_stop' as const}
  const next=structuredClone(state),record=next.records.find(item=>item.companyId===companyId)
  if(!record?.diagnosis||record.diagnosis.status!=='pending')throw Error('company_failure_diagnosis_not_pending')
  record.diagnosis={status:'complete',attemptsAllowed:1,repaired}
  return {state:next,action:'continue' as const}
}

export function assertCompanyMayStart(state:CompanyFailureGateState) {
  if(state.hardStopped)throw Error('benchmark_company_failure_hard_stop_latched')
  if(state.records.some(record=>record.diagnosis?.status==='pending'))throw Error('benchmark_company_failure_diagnosis_pending')
}
