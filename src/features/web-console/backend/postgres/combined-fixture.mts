import { linkedInFixture } from './linkedin-fixture.mts';
import { featureFixture } from '../../../linkedin-automation/storage-postgres/fixture.mts';
import { tableIds } from './tables.mts';
import { CONNECTION_SEARCH_CATALOG } from '../../../linkedin-automation/connection-inviter/catalog.ts';
export function combinedFixture() {
  const f = linkedInFixture();
  f.db.listTables().push(...featureFixture().db.listTables());
  for (const table of f.db.listTables()) if (!f.rows.has(table.id)) f.rows.set(table.id, new Map());
  f.db.deleteRecord = async (id, key) => f.rows.get(id)?.delete(key[0]) ?? false;
  Object.assign(f.rows.get(tableIds.accounts)!.get('21')!, { unipile_account_status: 'running',
    linkedin_verified_provider_id: 'provider-1', linkedin_verified_profile_url: 'https://www.linkedin.com/in/sql-test/' });
  f.set(tableIds.cv, 40, { clients_id: 7, market: 'En', status: 'filled',
    en_version_url: 'https://example.invalid/cv.pdf', UpdatedAt: '2026-09-01 00:00:00.000Z' });
  CONNECTION_SEARCH_CATALOG.forEach((item, index) => f.set('linkedin_connection_search_catalog', index + 1, {
    source_key: item.sourceKey, audience: item.audience, city: item.city,
    keyword_template: item.keywordTemplate, priority: item.priority, enabled: item.enabled }));
  return f;
}
