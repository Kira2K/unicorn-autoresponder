import { SOL_MODEL } from './sol-model.ts'

/** Catalog check only: no inference, alias resolution or automatic fallback. */
export async function requireSolAvailability(client:{readModels():Promise<unknown[]>},effort:'medium'|'high',model:string=SOL_MODEL) {
  const models=await client.readModels()
  const selected=models.find((entry:any)=>entry?.model===model) as any
  if(!selected)throw Error('sol_model_not_listed:'+model)
  if(!Array.isArray(selected.supportedReasoningEfforts)||!selected.supportedReasoningEfforts.some((entry:any)=>entry?.reasoningEffort===effort))throw Error('sol_reasoning_effort_not_listed:'+effort)
  return {model,effort,catalogVerifiedAt:new Date().toISOString()}
}
