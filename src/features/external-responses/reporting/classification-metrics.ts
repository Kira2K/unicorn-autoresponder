import type { ClassifiedCollection } from '../stack_classification/index.ts'
import type { ClassificationResponse } from '../stack_classification/classification-runner.ts'

export function classificationTotals(value:ClassifiedCollection){
  const accepted=new Set(value.stacks.flatMap(s=>value.groups[s.id].matchedIds)),unassessed=new Set<string>(),review=new Set<string>(),excluded=new Set<string>()
  for(const p of value.collection.positions){
    if(accepted.has(p.id))continue
    if(value.evaluation?.records[p.id]?.origin==='pending'||(!value.evaluation&&value.globalDecisions?.[p.id]?.decision==='review'&&!value.globalDecisions[p.id].evidence.length))unassessed.add(p.id)
    else if(value.globalDecisions?.[p.id]?.decision==='review'||value.stacks.some(s=>value.groups[s.id].reviewIds.includes(p.id)))review.add(p.id)
    else excluded.add(p.id)
  }
  const skips=value.collection.audit.flatMap(a=>a.titlePrecheck?.skipped??[])
  return {accepted:accepted.size,excluded:excluded.size,review:review.size,unassessed:unassessed.size,reviewIds:[...review],unassessedIds:[...unassessed],titleRejectedObservations:skips.length,titleRejectedUniqueUrls:new Set(skips.map(s=>s.url)).size}
}

/** Consume final response snapshots, never sum cumulative update notifications. Unknown stays unknown. */
export function classificationUsage(records:{batchId:string;response:ClassificationResponse}[]){
  const seen=new Set<string>();let inputTokens=0,cachedInputTokens=0,uncachedInputTokens=0,outputTokens=0,reasoningTokens=0,unknown=0,duplicates=0
  for(const r of records){const key=r.response.responseId??r.batchId;if(seen.has(key)){duplicates++;continue}seen.add(key)
    const u=r.response.usage, valid=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0
    if(!u){unknown++;continue}
    const input=valid(u.inputTokens),output=valid(u.outputTokens),cached=input&&valid(u.cachedInputTokens)&&u.cachedInputTokens!<=u.inputTokens!,reasoning=output&&valid(u.reasoningTokens)&&u.reasoningTokens!<=u.outputTokens!
    if(!input||!output||!cached||!reasoning)unknown++
    if(input)inputTokens+=u.inputTokens!
    if(output)outputTokens+=u.outputTokens!
    if(cached){cachedInputTokens+=u.cachedInputTokens!;uncachedInputTokens+=u.inputTokens!-u.cachedInputTokens!}
    if(reasoning)reasoningTokens+=u.reasoningTokens!
  }
  return {responses:seen.size,duplicates,unknown,inputTokens,cachedInputTokens,uncachedInputTokens,outputTokens,reasoningTokens,coordinatorTokens:null}
}
