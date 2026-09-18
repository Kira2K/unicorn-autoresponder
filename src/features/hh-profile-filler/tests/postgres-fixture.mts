import { makeFixture, TABLES } from '../../../platform/db/postgres/test-fixture.mts';
import type { AppDbRow } from '../../../platform/db/postgres/record-source.mts';

export function makeHhFixture() {
  const f = makeFixture();
  Object.assign(f.data.clients[0], { client_status: 'on en market', english_levels_id: 1,
    UpdatedAt: '2026-09-05T12:00:00+00:00', birth_date: '1990-01-01', fio: 'Fake Author', education: '' });
  Object.assign(f.data.clients[1], { client_status: 'on ru market', english_levels_id: null,
    UpdatedAt: '2026-09-05T12:00:00+00:00' });
  f.data.platformAccounts.push({ Id: 15, clients_id: 1, platforms_id: 23, nickname: '@fake' });
  f.data.platformAccounts.push({ Id: 16, clients_id: 2, platforms_id: 11, login: 'other', password: 'fake' });
  f.data.cvProcessing = [
    { Id: 20, clients_id: 1, status: 'filled', en_version_url: 'fake-old', UpdatedAt: '2026-09-04T00:00:00+00:00' },
    { Id: 21, clients_id: 1, status: 'moved to filling', en_version_url: 'fake-en', UpdatedAt: '2026-09-06T12:00:00+00:00' },
    { Id: 22, clients_id: 2, status: 'filled', ru_version_url: 'fake-ru', UpdatedAt: null }
  ];
  f.data.englishLevels = [{ Id: 1, name: 'B2' }];
  f.data.platforms = [{ Id: 10, name: 'hh en' }, { Id: 11, name: 'hh ru' }, { Id: 23, name: 'telegram en' }];
  for (const [name, rows] of Object.entries(f.data)) {
    let table = f.tables.find(t => t.id === TABLES[name].id);
    if (!table) {
      table = { id: TABLES[name].id, title: TABLES[name].title, table_name: name, columns: [] };
      f.tables.push(table);
    }
    for (const title of new Set(rows.flatMap(Object.keys))) if (!table.columns.some(c => c.title === title)) {
      table.columns.push({ id: `${name}_${title}`, title, dataKey: title, sqlName: title,
        sqlType: title === 'UpdatedAt' ? 'timestamptz' : 'text', pk: title === 'Id' });
    }
  }
  for (const [name, title, fk, target] of [
    ['clients', 'English level', 'english_levels_id', 'englishLevels'],
    ['platformAccounts', 'rel_platformAccounts_platform', 'platforms_id', 'platforms']]) {
    f.tables.find(t => t.id === TABLES[name].id)!.columns.push({ id: title, title, dataKey: title,
      sqlName: title, sqlType: 'jsonb', uidt: 'Links', colOptions: { type: 'bt',
        fk_child_column_id: `${name}_${fk}`, fk_parent_column_id: `${target}_Id`, fk_related_model_id: TABLES[target].id } });
  }
  const old = f.records.fetchRecords;
  f.records.fetchRecords = async (id: string): Promise<AppDbRow[]> => (await old(id)).map(row => {
    if (id === TABLES.clients.id) row['English level'] = f.data.englishLevels.find(r => r.Id === row.english_levels_id) ?? null;
    if (id === TABLES.platformAccounts.id) row.rel_platformAccounts_platform = f.data.platforms.find(r => r.Id === row.platforms_id) ?? null;
    if (typeof row.UpdatedAt === 'string') row.UpdatedAt = row.UpdatedAt.replace('T', ' ');
    return row;
  });
  return f;
}
