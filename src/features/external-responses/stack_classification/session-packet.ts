import { SOL_MODEL } from '../infrastructure/sol-model.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import type { Position } from '../types.ts'
import type { StackProfile } from '../stack_catalog/index.ts'
import type { SelectionRules } from './rules.ts'
import { semanticRules } from './rules.ts'
import { createTitleStackSelector } from '../vacancy_collection/title-precheck.ts'
import type { ExchangeRates } from './salary.ts'
import { checkSalary, recordedSalaryContext } from './salary-precheck.ts'

export const ASSESSMENT_PACKET_LIMITS={initial:64*1024,expanded:128*1024} as const
export type AssessmentPacket={
  version:1;kind:'semantic_vacancy_assessment';requestId:string;collectionRunId:string;positionId:string;sourceIds:string[]
  model:typeof SOL_MODEL;reasoningEffort:'medium';inputHash:string
  requirements:{selectionRules:string;stacks:{id:string;description:string}[]}
  vacancy:{company:string;title:string;description:string;location:string;url:string;applyUrl:string;market:Position['market'];compensation:Position['compensation'];applicationDestinations:Position['applicationDestinations'];exchangeRates?:ExchangeRates;salaryCheck?:ReturnType<typeof checkSalary>}
}
export type AssessmentPacketResult={status:'ready';expanded:boolean;bytes:number;packet:AssessmentPacket}|{status:'pending';expanded:boolean;bytes:number;limitBytes:number;reason:'assessment_packet_expansion_required'|'assessment_packet_too_large'}

/** Full description and all shared/stack requirements are indivisible; callers may expand exactly once. */
export function buildAssessmentPacket(input:{collectionRunId:string;position:Position;stacks:StackProfile[];rules:SelectionRules;expanded?:boolean;exchangeRates?:ExchangeRates}):AssessmentPacketResult {
  const selected=createTitleStackSelector(input.rules,input.stacks)(input.position.title)
  const salaryContext=recordedSalaryContext(input.position,input.rules,input.exchangeRates)
  const semantic={requirements:{selectionRules:semanticRules(input.rules),stacks:selected.map(s=>({id:s.id,description:s.description??''}))},vacancy:{
    company:input.position.company,title:input.position.title,description:input.position.description,location:input.position.location,url:input.position.url,applyUrl:input.position.applyUrl,
    market:input.position.market,compensation:input.position.compensation,applicationDestinations:input.position.applicationDestinations,
    ...(salaryContext??{})}}
  const binding={collectionRunId:input.collectionRunId,positionId:input.position.id,sourceIds:[...new Set((input.position.sources??[input.position.source]).map(s=>s.database?.sourceId??s.url))].sort(),inputHash:digest(semantic)}
  const packet:AssessmentPacket={version:1,kind:'semantic_vacancy_assessment',requestId:digest(binding),...binding,model:SOL_MODEL,reasoningEffort:'medium',...semantic}
  const bytes=Buffer.byteLength(JSON.stringify(packet)),limitBytes=input.expanded?ASSESSMENT_PACKET_LIMITS.expanded:ASSESSMENT_PACKET_LIMITS.initial
  if(bytes<=limitBytes)return {status:'ready',expanded:!!input.expanded,bytes,packet}
  return {status:'pending',expanded:!!input.expanded,bytes,limitBytes,reason:input.expanded?'assessment_packet_too_large':'assessment_packet_expansion_required'}
}
