import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import type { SqlOperation } from '../infrastructure/postgres.ts'
import type { VacancyCollection } from './index.ts'

/** Discovery is audit/checkpoint data. Canonical vacancies are created only by accepted classification. */
export function saveCollection(collection: VacancyCollection, write: SqlOperation) {
  return write(async session => {
    if (!collection.scope) throw new PostgresReadError('database_campaign_scope_required')
    const hash = digest(collection)
    await session.query('SELECT pg_advisory_xact_lock(1789941002,hashtext($1))', [collection.runId])
    const previous = (await session.query('SELECT checksum,collection,classification FROM noco.collection_runs WHERE id=$1', [collection.runId])).rows[0]
    if (previous) {
      if(previous.checksum===hash)return
      const old=previous.collection as VacancyCollection
      if(old.scan && old.scan.status!=='complete' && !previous.classification && collection.scan?.configHash===old.scan.configHash) {
        await session.query('UPDATE noco.collection_runs SET collection=$2::json,checksum=$3 WHERE id=$1',[collection.runId,JSON.stringify(collection),hash]);return
      }
      throw new PostgresReadError('collection_run_immutable')
    }
    await session.query('INSERT INTO noco.collection_runs(id,collection,checksum) VALUES($1,$2::json,$3)', [collection.runId, JSON.stringify(collection), hash])
  })
}
export const loadCollection = (id: string, read: SqlOperation) => read(async s => {
  const row = (await s.query('SELECT collection,classification FROM noco.collection_runs WHERE id=$1', [id])).rows[0]
  if (!row) throw new PostgresReadError('collection_run_not_found')
  return row as { collection: VacancyCollection; classification: import('../stack_classification/index.ts').ClassifiedCollection | null }
})
