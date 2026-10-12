import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { canonicalUrl } from '../infrastructure/identity.ts'
import type { SqlOperation } from '../infrastructure/postgres.ts'
import type { ClassifiedCollection } from './index.ts'
import { assertClassificationIntegrity } from './index.ts'
import type { SqlSession } from '../../../integrations/postgres/contracts.mts'
import type { Position } from '../types.ts'
import { evaluatePublicationDate } from '../vacancy_collection/publication-date-precheck.ts'
import { postingIdentity } from '../infrastructure/posting-identity.ts'

/** Private SQL projection: only saveClassification may promote a passing discovery. */
async function upsertAcceptedVacancy(session: SqlSession, position: Position) {
  const origins = [...new Map([position.source, ...(position.sources ?? [])].map(s => [digest(s), s])).values()], ids = [...new Set(origins.map(s => s.database?.companyId).filter(Boolean))]
  const identity = postingIdentity(position.url)
  if (ids.length !== 1) throw new PostgresReadError('vacancy_company_binding_required')
  for (const origin of origins.filter(s => s.database)) {
    const found = (await session.query('SELECT id FROM noco.sources WHERE id=$1 AND company_id=$2 AND url=$3', [origin.database!.sourceId, ids[0], origin.url])).rows
    if (!found.length) throw new PostgresReadError('vacancy_source_binding_changed')
  }
  const row = (await session.query(`INSERT INTO noco.vacancies(company_id,title,canonical_url,apply_url,description,location,last_checked_at,sources,availability,platform,external_namespace,external_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'open',$9,$10,$11) ON CONFLICT(canonical_url) DO UPDATE SET
    platform=COALESCE(noco.vacancies.platform,excluded.platform),
    external_namespace=COALESCE(noco.vacancies.external_namespace,excluded.external_namespace),
    external_id=COALESCE(noco.vacancies.external_id,excluded.external_id),
    availability=CASE WHEN noco.vacancies.last_checked_at IS NULL OR excluded.last_checked_at>noco.vacancies.last_checked_at THEN 'open' ELSE noco.vacancies.availability END,
    title=CASE WHEN noco.vacancies.last_checked_at IS NULL OR excluded.last_checked_at>=noco.vacancies.last_checked_at THEN excluded.title ELSE noco.vacancies.title END,
    apply_url=CASE WHEN noco.vacancies.last_checked_at IS NULL OR excluded.last_checked_at>=noco.vacancies.last_checked_at THEN excluded.apply_url ELSE noco.vacancies.apply_url END,
    description=CASE WHEN (noco.vacancies.last_checked_at IS NULL OR excluded.last_checked_at>=noco.vacancies.last_checked_at OR NULLIF(btrim(noco.vacancies.description),'') IS NULL)
      AND NULLIF(btrim(excluded.description),'') IS NOT NULL THEN excluded.description ELSE noco.vacancies.description END,
    location=CASE WHEN (noco.vacancies.last_checked_at IS NULL OR excluded.last_checked_at>=noco.vacancies.last_checked_at) AND NULLIF(btrim(excluded.location),'') IS NOT NULL THEN excluded.location ELSE noco.vacancies.location END,
    last_checked_at=GREATEST(noco.vacancies.last_checked_at,excluded.last_checked_at),
    sources=(SELECT jsonb_agg(DISTINCT origin) FROM jsonb_array_elements(noco.vacancies.sources || excluded.sources) AS observations(origin))
    WHERE noco.vacancies.company_id=excluded.company_id RETURNING id::text,company_id::text`,
    [ids[0], position.title, canonicalUrl(position.url), position.applyUrl, position.description, position.location, position.retrievedAt, JSON.stringify(origins.map(origin => ({ ...origin, market: position.market, applicationDestinations: position.applicationDestinations ?? [],extraction:position.extraction }))),identity.platform,identity.namespace,identity.externalId])).rows[0]
  if (!row) throw new PostgresReadError('vacancy_company_conflict')
  return row as { id: string; company_id: string }
}
export function saveClassification(value: ClassifiedCollection, write: SqlOperation) {
  return write(async session => {
    if (!value.collection.scope) throw new PostgresReadError('database_campaign_scope_required')
    if (!value.selectionRules) throw new PostgresReadError('vacancy_selection_rules_required')
    try { assertClassificationIntegrity(value) }
    catch { throw new PostgresReadError('classification_invalid') }
    const run = (await session.query('SELECT checksum,classification FROM noco.collection_runs WHERE id=$1 FOR UPDATE', [value.collection.runId])).rows[0]
    if (!run || run.checksum !== digest(value.collection)) throw new PostgresReadError('saved_collection_required')
    if (run.classification) { if (digest(run.classification) !== digest(value)) throw new PostgresReadError('classification_immutable'); return }
    const acceptedIds = new Set(value.stacks.flatMap(stack => value.groups[stack.id].matchedIds))
    const accepted = value.collection.positions.filter(position => acceptedIds.has(position.id))
      .sort((a, b) => canonicalUrl(a.url).localeCompare(canonicalUrl(b.url)))
    for (const position of accepted) {
      const date=evaluatePublicationDate(position,value.selectionRules)
      if(date.decision!=='continue')throw new PostgresReadError('classification_date_verdict_not_current')
      if (!position.description.trim()) throw new PostgresReadError('accepted_vacancy_description_required')
      const vacancy = await upsertAcceptedVacancy(session, position)
      for (const stack of value.stacks) {
        const decision = value.decisions[stack.id][position.id]
        if (decision.decision !== 'eligible') continue
        await session.query(`INSERT INTO noco.vacancy_stacks(run_id,vacancy_id,stack_id,decision,evidence)
          VALUES($1,$2,$3,'matched',$4::jsonb)`,
          [value.collection.runId, vacancy.id, stack.databaseId, JSON.stringify(decision)])
      }
    }
    await session.query('UPDATE noco.collection_runs SET classification=$2::json WHERE id=$1', [value.collection.runId, JSON.stringify(value)])
  })
}
