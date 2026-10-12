import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { classifyWithSessionBatches, sessionPolicyKey, type SessionClassificationPolicy } from './session-classification.ts'
import type { AssessmentStore } from './classification-runner.ts'
import type { ClassifiedCollection } from './index.ts'
import { classifyWithReuse } from './reuse.ts'
import { decisionRulesHash, type SelectionRules } from './rules.ts'
import type { StackProfile } from '../stack_catalog/index.ts'

/** Recover saved, bound responses only. No browser, generation, or policy bypass. */
export async function revalidateSession(input:{saved:ClassifiedCollection;rules:SelectionRules;stacks:StackProfile[];policy:SessionClassificationPolicy;runId:string;store:AssessmentStore;revalidationAt?:string}) {
  const {saved,rules,policy,runId}=input
  const stackHash=(stacks:StackProfile[])=>digest([...stacks].sort((a,b)=>a.id.localeCompare(b.id)))
  if(runId===saved.collection.runId||!saved.selectionRules||decisionRulesHash(rules)!==decisionRulesHash(saved.selectionRules)||stackHash(input.stacks)!==stackHash(saved.stacks))throw Error('revalidation_scope_or_rules_changed')
  const forbidden=async():Promise<never>=>{throw Error('revalidation_never_generates')}
  // Original inputs reconstruct the original response binding; no current cache may alter batch membership.
  const recovered=await classifyWithSessionBatches({collection:saved.collection,rules:saved.selectionRules,cache:{},policy,exchangeRates:saved.exchangeRates},{store:input.store,transport:{preflight:forbidden,generate:forbidden},admit:forbidden,now:input.revalidationAt?()=>new Date(input.revalidationAt!):undefined})
  const collection={...saved.collection,runId}
  const result=await classifyWithReuse({collection,rules,cache:recovered.updates,policy:sessionPolicyKey(policy,saved.exchangeRates),exchangeRates:saved.exchangeRates,assessmentProvenance:recovered.classified.assessmentProvenance})
  return {...result,recovery:{fromRun:saved.collection.runId,validator:'whitespace-span-v1',newAiCalls:0,reusedBatches:recovered.batches.reused,pending:recovered.packetPending}}
}
