import { atomicJson, safeId } from '../infrastructure/store.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cvHash } from '../application_preparation/tailoring.ts'
export type Campaign = { id: string; studentId: string; candidateId: string; initialBatch: string; initialTargets: string[]; companyBatches: string[][]; stackIds: string[]; aggressiveTestAnswers: boolean; approvedAt: string; approvalReference: string }
export type CampaignState = { scope: Campaign; initialConfirmed: boolean; initialContinuation?: { initialBatch: string; approvedAt: string; approvalReference: string }; batches: { runId: string; batchId: string; companyIds: string[]; targets: string[]; completed: boolean }[] }
/** An explicit instruction to move on does not turn an unconfirmed application into success. */
export function canStartFollowup(state: CampaignState) {
  const approval = state.initialContinuation
  return state.initialConfirmed || !!(approval && approval.initialBatch === state.scope.initialBatch && approval.approvalReference.trim() && Number.isFinite(Date.parse(approval.approvedAt)))
}
/** Freeze the complete matching result after a whole company batch was inspected. No replacements. */
export function recordCampaignCollection(state: CampaignState, input: { runId: string; batchId: string; companyIds: string[]; stackIds: string[]; targets: string[]; collectionComplete: boolean }) {
  const step = nextCampaignStep(state)
  const existing = state.batches.find(b => b.runId === input.runId)
  const row = { runId: input.runId, batchId: input.batchId, companyIds: input.companyIds, targets: input.targets, completed: !input.targets.length }
  if (existing) {
    if (JSON.stringify({ ...existing, completed: row.completed }) !== JSON.stringify(row)) throw Error('campaign_targets_immutable')
    return
  }
  if (step.stage !== 'collection' || JSON.stringify(step.companyIds) !== JSON.stringify(input.companyIds)) throw Error('campaign_collection_out_of_order')
  if (!input.collectionComplete || JSON.stringify(state.scope.stackIds) !== JSON.stringify(input.stackIds)) throw Error('complete_three_stack_collection_required')
  if (new Set(input.targets).size !== input.targets.length || input.targets.some(id => state.scope.initialTargets.includes(id))) throw Error('duplicate_campaign_target')
  safeId(input.runId); safeId(input.batchId)
  state.batches.push(structuredClone(row))
}
export function nextCampaignStep(state: CampaignState) {
  if (!canStartFollowup(state)) return { stage: 'initial_application' as const }
  if (state.batches.some(b => b.targets.length)) return { stage: state.batches.some(b => b.targets.length && !b.completed) ? 'applications' as const : 'complete' as const }
  const n = state.batches.length
  if (n && !state.batches[n - 1].completed) return { stage: 'collection' as const, companyIds: state.batches[n - 1].companyIds }
  return n < state.scope.companyBatches.length ? { stage: 'collection' as const, companyIds: state.scope.companyBatches[n] } : { stage: 'complete' as const }
}
export async function openCampaign(directory: string, scope: Campaign, persistence?: { load(): Promise<CampaignState | undefined>; save(state: CampaignState): Promise<void> }) {
  if (!scope.approvalReference || !Number.isFinite(Date.parse(scope.approvedAt)) || scope.companyBatches.length > 3 || scope.companyBatches.some(b => b.length !== 5) || new Set(scope.companyBatches.flat()).size !== scope.companyBatches.flat().length) throw Error('invalid_campaign_scope')
  const path = join(directory, `${safeId(scope.id)}.json`)
  let state: CampaignState
  try { state = await persistence?.load() ?? JSON.parse(await readFile(path, 'utf8')); if (cvHash(JSON.stringify(state.scope)) !== cvHash(JSON.stringify(scope))) throw Error('campaign_scope_immutable') }
  catch (e: any) { if (e.code !== 'ENOENT') throw e; state = { scope, initialConfirmed: false, batches: [] }; await atomicJson(path, state) }
  return { state, save: async () => { await persistence?.save(state); await atomicJson(path, state) } }
}
