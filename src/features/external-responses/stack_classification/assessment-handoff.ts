import { join } from 'node:path'
import { atomicJson } from '../infrastructure/store.ts'
import type { VacancyCollection } from '../vacancy_collection/index.ts'
import type { SelectionRules } from './rules.ts'
import { buildAssessmentPacket } from './session-packet.ts'
import { createAssessmentPrecheck } from './precheck.ts'
import type { ExchangeRates } from './salary.ts'
import { buildAssessmentBatches } from './assessment-batches.ts'
import type { AssessmentPacket } from './session-packet.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'

/** Writes only complete bounded tasks or an explicit pending marker; it never invokes a model. */
export async function writeAssessmentHandoff(directory:string,collection:VacancyCollection,rules:SelectionRules,positionIds?:Set<string>,exchangeRates?:ExchangeRates) {
  const ready:string[]=[],expanded:string[]=[],pending:{positionId:string;reason:string;bytes:number;limitBytes:number}[]=[]
  const packets:AssessmentPacket[]=[]
  const precheck=createAssessmentPrecheck(rules,collection.scope,undefined,exchangeRates),automatic:Record<string,unknown>={}
  for(const position of collection.positions.filter(position=>!positionIds||positionIds.has(position.id))) {
    const decision=precheck(position)
    if(decision){automatic[position.id]=decision;continue}
    let packet=buildAssessmentPacket({collectionRunId:collection.runId,position,stacks:collection.scope?.stacks??[],rules,exchangeRates})
    if(packet.status==='pending'&&packet.reason==='assessment_packet_expansion_required')packet=buildAssessmentPacket({collectionRunId:collection.runId,position,stacks:collection.scope?.stacks??[],rules,expanded:true,exchangeRates})
    if(packet.status==='ready') {await atomicJson(join(directory,position.id+'.request.json'),packet.packet);packets.push(packet.packet);ready.push(position.id);if(packet.expanded)expanded.push(position.id)}
    else {const marker={positionId:position.id,reason:packet.reason,bytes:packet.bytes,limitBytes:packet.limitBytes};await atomicJson(join(directory,position.id+'.pending.json'),marker);pending.push(marker)}
  }
  const plan=buildAssessmentBatches(packets)
  await atomicJson(join(directory,'batches.json'),{version:1,collectionRunId:collection.runId,collectionDigest:digest(collection),rulesHash:rules.sha256,...plan})
  const manifest={version:1,collectionRunId:collection.runId,ready,expanded,pending,automatic,batches:plan.batches.map(b=>({id:b.id,bytes:b.bytes,expanded:b.expanded,positions:b.payload.vacancies.length})),batchPending:plan.pending,...(exchangeRates?{exchangeRates}:{})}
  await atomicJson(join(directory,'manifest.json'),manifest);return manifest
}
