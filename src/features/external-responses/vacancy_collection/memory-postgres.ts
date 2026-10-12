import { SOL_MODEL } from '../infrastructure/sol-model.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import type { RuntimeDatabase, SqlOperation } from '../infrastructure/postgres.ts'
import type { Source, SourceAudit } from '../types.ts'
import type { SourceMemory, SourceState } from './source-memory.ts'
import { sourceConfigHash } from './source-memory.ts'
import type { CachedAssessment } from '../stack_classification/reuse.ts'
import { canonicalUrl } from '../infrastructure/identity.ts'
import { validateSourceDescriptions } from './source-quality.ts'

export const sourceMemorySql = `ALTER TABLE noco.sources
 ADD COLUMN IF NOT EXISTS collection_recipe jsonb,
 ADD COLUMN IF NOT EXISTS collection_state jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN IF NOT EXISTS last_search_attempt_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_complete_search_at timestamptz;
COMMENT ON COLUMN noco.sources.collection_recipe IS 'Verified, bounded public-listing collection instructions; no executable scripts or credentials.';
COMMENT ON COLUMN noco.sources.collection_state IS 'Latest source audit references, exact reusable decisions and access review. Not a second vacancy directory.';`
export const sourceMemoryChecksum = digest(sourceMemorySql)
/** Explicit migration only; runtime never creates columns. Uses the established checked transaction. */
export async function migrateSourceMemory(db: Pick<RuntimeDatabase,'read'|'write'|'database'>, expected?: string) {
  const columns=await db.read(async s=>(await s.query("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='noco' AND table_name='sources' AND column_name IN ('collection_recipe','collection_state','last_search_attempt_at','last_complete_search_at') ORDER BY column_name")).rows)
  const types:Record<string,string>={collection_recipe:'jsonb',collection_state:'jsonb',last_search_attempt_at:'timestamp with time zone',last_complete_search_at:'timestamp with time zone'}
  if(columns.some(c=>types[String(c.column_name)]!==c.data_type)) throw Error('source_memory_column_conflict')
  if(expected) { if(expected!==sourceMemoryChecksum) throw Error('source_memory_checksum_mismatch'); await db.write(s=>s.query(sourceMemorySql)) }
  return {database:db.database,checksum:sourceMemoryChecksum,existingColumns:columns,applied:!!expected,sql:sourceMemorySql}
}
export async function loadSourceMemory(sources:Source[],read:SqlOperation) {
  const ids=sources.map(s=>s.database!.sourceId)
  const rows=await read(async s=>(await s.query('SELECT id::text,collection_recipe,collection_state,last_search_attempt_at,last_complete_search_at FROM noco.sources WHERE id=ANY($1::bigint[])',[ids])).rows)
  const memories=new Map<string,SourceMemory>()
  for(const r of rows) memories.set(String(r.id),{recipe:r.collection_recipe as any,state:r.collection_state as any,lastAttempt:r.last_search_attempt_at?new Date(String(r.last_search_attempt_at)).toISOString():null,lastComplete:r.last_complete_search_at?new Date(String(r.last_complete_search_at)).toISOString():null})
  if(ids.some(id=>!memories.has(id))) throw Error('source_memory_missing')
  return memories
}
/** One source-level handoff checkpoint, not a SQL write for every browser click. */
export async function checkpointInvestigation(input:{sourceId:string;runId:string;requestId:string;memory:SourceMemory},write:SqlOperation) {
  const state={...input.memory.state,investigation:{status:'pending' as const,runId:input.runId,requestId:input.requestId,model:SOL_MODEL}}
  const rows=await write(async session=>(await session.query('UPDATE noco.sources SET collection_state=$2::jsonb WHERE id=$1 AND collection_state=$3::jsonb RETURNING id',[input.sourceId,JSON.stringify(state),JSON.stringify(input.memory.state)])).rows)
  if(!rows.length)throw Error('source_memory_concurrently_changed')
  input.memory.state=state
}
export async function saveSourceMemory(input:{runId:string;audits:SourceAudit[];memories:Map<string,SourceMemory>;decisions:Record<string,CachedAssessment>;positionSources:Map<string,string[]>;decisionsOnly?:boolean;collectionOnly?:boolean},write:SqlOperation) {
  if(input.collectionOnly&&(input.decisionsOnly||Object.keys(input.decisions).length))throw Error('collection_memory_cannot_save_assessments')
  await write(async session=>{
    const run=(await session.query('SELECT collection,classification FROM noco.collection_runs WHERE id=$1',[input.runId])).rows[0]
    if(!run?.collection)throw Error('saved_collection_required_before_source_memory')
    if(!input.collectionOnly&&!run.classification) throw Error('saved_classification_required_before_source_memory')
    for(const audit of validateSourceDescriptions(input.audits,(run.collection as any).positions).sort((a,b)=>a.source.database!.sourceId.localeCompare(b.source.database!.sourceId))) {
      const id=audit.source.database!.sourceId, previous=input.memories.get(id)!, trace=audit.trace
      const current=(await session.query('SELECT collection_state,collection_recipe FROM noco.sources WHERE id=$1 FOR UPDATE',[id])).rows[0]
      const sameRun=(current.collection_state as SourceState)?.lastAttemptRun===input.runId
      if(sameRun&&!Object.keys(input.decisions).length) continue
      if(digest(current.collection_state)!==digest(previous.state)||digest(current.collection_recipe)!==digest(previous.recipe)) throw Error('source_memory_concurrently_changed')
      const decisions={...previous.state.decisions}
      for(const [position,entry] of Object.entries(input.decisions)) if(input.positionSources.get(position)?.includes(id)) decisions[position]=entry
      if(input.decisionsOnly||sameRun){
        await session.query('UPDATE noco.sources SET collection_state=$2::jsonb WHERE id=$1',[id,JSON.stringify({...previous.state,decisions})]);continue
      }
      const fresh=trace && !['reused','paused'].includes(trace.mode), recipe=trace?.recipe??previous.recipe
      const state:SourceState={...previous.state,version:1,decisions,lastAttemptRun:input.runId,
        ...(fresh?{investigation:trace.investigation?{status:trace.investigation.status,runId:input.runId,requestId:trace.investigation.request.id,model:trace.investigation.request.model,attempts:trace.investigation.attempts}:undefined}:{}),
        ...(fresh?{snapshot:{runId:input.runId,configHash:sourceConfigHash(audit.source,audit.titlePrecheck?.scopeHash),status:audit.status,searchedAt:trace.finishedAt,recipeRevision:recipe?.revision},health:audit.status,validator:trace.validator}:{}),
        ...(audit.accessGate?{review:{status:'pending',gate:audit.accessGate} as const}:fresh && previous.state.review?.status==='pending'?{review:{...previous.state.review,status:'resolved' as const}}:{})}
      await session.query('UPDATE noco.sources SET collection_recipe=$2::jsonb,collection_state=$3::jsonb,last_search_attempt_at=$4,last_complete_search_at=$5 WHERE id=$1',
        [id,JSON.stringify(recipe),JSON.stringify(state),fresh?trace.startedAt:previous.lastAttempt,fresh && audit.status==='complete'?trace.finishedAt:previous.lastComplete])
      for(const closed of trace?.closed??[]) await session.query("UPDATE noco.vacancies SET availability='closed',last_checked_at=$3,updated_at=now() WHERE company_id=$1 AND canonical_url=$2 AND (last_checked_at IS NULL OR last_checked_at<=$3)",[audit.source.database!.companyId,canonicalUrl(closed.url),closed.at])
    }
  })
}
