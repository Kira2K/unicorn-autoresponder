import { SOL_MODEL } from '../infrastructure/sol-model.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { validateBatchResponse, type AssessmentBatch } from './assessment-batches.ts'
import type { Assessment } from './reuse.ts'
import { redact } from '../infrastructure/store.ts'

export type ClassificationUsage={inputTokens?:number;cachedInputTokens?:number;outputTokens?:number;reasoningTokens?:number}
export type ClassificationResponse={value:unknown;toolCalls:number;usage?:ClassificationUsage;responseId?:string;failure?:{message:string;status?:string}}
export type ClassificationSettings={model:typeof SOL_MODEL;effort:'medium';maxOutputTokens:number;signal?:AbortSignal}
export type ClassificationTransport={
  preflight():Promise<{toolExecution:'disabled'|'unverified';structuredOutput:boolean;reason?:string}>
  generate(batch:AssessmentBatch,settings?:ClassificationSettings):Promise<ClassificationResponse>
}
export type AssessmentRecord={binding:string;status:'intent'|'completed'|'pending';startedAt:string;finishedAt?:string;reason?:string;response?:ClassificationResponse;revalidation?:{at:string;previousReason:string;validator:'whitespace-span-v1'}}
export type AssessmentStore={load(id:string):Promise<AssessmentRecord|undefined>;claim(id:string,value:AssessmentRecord):Promise<boolean>;save(id:string,value:AssessmentRecord):Promise<void>}

/** Sequential, at-most-once dispatch. Existing intent without completion is reconciliation work. */
export async function runClassificationBatches(batches:AssessmentBatch[],deps:{transport:ClassificationTransport;store:AssessmentStore;admit():Promise<void>;now?:()=>string;policyHash?:string;settings?:ClassificationSettings}) {
  const completed:{batchId:string;decisions:Record<string,Assessment>;response:ClassificationResponse}[]=[],pending:{batchId:string;positionIds:string[];reason:string}[]=[]
  const responses:{batchId:string;response:ClassificationResponse}[]=[]
  let reused=0,preflighted=false
  const now=deps.now??(()=>new Date().toISOString())
  for(const batch of batches){
    const binding=digest({batch,policy:deps.policyHash}),old=await deps.store.load(batch.id)
    const defer=(reason:string)=>pending.push({batchId:batch.id,positionIds:batch.payload.vacancies.map(v=>v.positionId),reason})
    if(old){
      if(old.binding!==binding)throw Error('assessment_resume_binding_changed')
      if(old.response)responses.push({batchId:batch.id,response:old.response})
      if(old.status==='completed'&&old.response){
        if(old.response.toolCalls!==0)throw Error('assessment_tool_execution_forbidden')
        completed.push({batchId:batch.id,decisions:validateBatchResponse(batch,old.response.value),response:old.response});reused++
      }else if(old.status==='pending'&&old.reason==='assessment_evidence_invalid'&&old.response&&!old.response.failure&&old.response.toolCalls===0){
        let decisions:Record<string,Assessment>
        try {decisions=validateBatchResponse(batch,old.response.value)} catch {defer(old.reason);continue}
        await deps.store.save(batch.id,{...old,status:'completed',revalidation:{at:now(),previousReason:old.reason,validator:'whitespace-span-v1'}})
        completed.push({batchId:batch.id,decisions,response:old.response});reused++
      }else defer(old.reason??'assessment_intent_uncertain_no_automatic_retry')
      continue
    }
    if(deps.settings?.signal?.aborted)throw Error('classification_cancelled')
    await deps.admit()
    if(!preflighted){const p=await deps.transport.preflight();if(p.toolExecution!=='disabled'||!p.structuredOutput)throw Error(p.reason??'verified_tool_free_classification_transport_required');preflighted=true}
    await deps.admit()
    const record:AssessmentRecord={binding,status:'intent',startedAt:now()}
    if(!await deps.store.claim(batch.id,record)){defer('assessment_claimed_by_other_invocation');continue}
    let response:ClassificationResponse|undefined
    try{
      response=await deps.transport.generate(batch,deps.settings)
      responses.push({batchId:batch.id,response})
      if(response.toolCalls!==0)throw Error('assessment_tool_execution_forbidden')
      const decisions=validateBatchResponse(batch,response.value)
      // Save failure must not be interpreted as permission to regenerate.
      await deps.store.save(batch.id,{...record,status:'completed',finishedAt:now(),response})
      completed.push({batchId:batch.id,decisions,response})
    }catch(error){
      if(!response&&error instanceof Error&&'classificationResponse' in error){response=(error as Error&{classificationResponse:ClassificationResponse}).classificationResponse;responses.push({batchId:batch.id,response})}
      const reason=redact(error instanceof Error?error.message:'assessment_failed_or_uncertain') as string
      await deps.store.save(batch.id,{...record,status:'pending',finishedAt:now(),reason,...(response?{response}:{})})
      defer(reason)
    }
  }
  return {completed,pending,reused,responses}
}

export { createCodexClassificationTransport } from './codex-classification.ts'
