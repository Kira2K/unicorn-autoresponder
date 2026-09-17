import { createRequire } from 'node:module';
import { createSqlConsoleRepository } from './repository.mts';
import { tableIds as t, relations } from './tables.mts';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import type { CopyRecord } from '../../../../integrations/postgres/contracts.mts';
import type { WebConsoleRepository } from '../types.ts';
import { legacyFixtureRows } from './legacy-query-fixture.mts';
const { createWebConsoleRepository } = createRequire(import.meta.url)('../repository.ts') as {
  createWebConsoleRepository(options: { nocoClient: unknown }): WebConsoleRepository;
};
export function workflowFixture(market = 'En') {
  const rows = new Map<string, Map<string, Record<string, unknown>>>();
  const rowset = (id: string) => { if (!rows.has(id)) rows.set(id, new Map()); return rows.get(id)!; };
  const set = (id: string, key: number, data: Record<string, unknown>) => rowset(id).set(String(key), { Id: key, ...data });
  const copy = (r: Record<string, unknown>): CopyRecord => ({ key: [String(r.Id)], data: structuredClone(r), sourceJson: '{"archive":true}' });
  const fk = (title: string) => ({ rel_clients_primary_stack: 'stacks_id', market: 'market_id',
    'English level': 'english_levels_id', rel_platformAccounts_platform: 'platforms_id' }[title] ?? 'clients_id');
  const tables = Object.values(t).map(id => ({ id, title: id, columns: [{ id: id + '_pk', title: 'Id', dataKey: 'Id', pk: true },
    ...Object.entries(relations[id] ?? {}).flatMap(([title, target]) => [
      { id: id + '_' + fk(title), title: fk(title), dataKey: fk(title) },
      { id: id + '_rel_' + title, title, dataKey: title, colOptions: { type: title === 'Mentors' ? 'mm' : 'bt',
        fk_related_model_id: target, fk_child_column_id: id + '_' + fk(title), fk_parent_column_id: target + '_pk' } }
    ])] }));
  set(t.market, 1, { name: market }); set(t.english, 1, { name: 'B2' }); set(t.stacks, 1, { name: 'Go' });
  set(t.clients, 7, { client_name: 'SQL fixture', calendar_email: 'sql-fixture@example.invalid', client_status: 'studying',
    telegram_general_chat_id: '-7007', telegram_personal_chat_id: '@sql_student', market_id: 1, stacks_id: 1,
    english_levels_id: 1, education_entries: '[{"uni":"Test University"}]', real_age: 25,
    real_location: 'Test city', desired_location: 'Remote', google_folder: 'https://example.invalid/root' });
  ['github', 'linkedin', 'telegram_ru', 'telegram_en'].forEach((name, index) => {
    const platformId = [29, 16, 24, 23][index];
    set(t.platforms, platformId, { platform: name }); set(t.accounts, index + 20, {
      clients_id: 7, platforms_id: platformId, account_label: name, nickname: '@sql_student',
      login: 'fixture', linkedin_url: 'https://example.invalid/' + name, telegram_session_status: 'disconnected' });
  });
  let nextId = 100, mutations = 0, failWrite = false, failRead = false, failAfterWrite = false;
  let readError = Error('readback failed');
  const db = { listTables: () => tables,
    async getRecord(id: string, key: string[]) { if (failRead) throw readError; const r = rowset(id).get(key[0]); return r ? copy(r) : null; },
    async listRecords(id: string) { if (failRead) throw readError; return { records: [...rowset(id).values()].map(copy), nextKey: null }; },
    async findRecords(id: string, field: string, values: string[], options?: { trim?: boolean }) {
      if (failRead) throw readError;
      const found = [...rowset(id).values()].filter(row => options?.trim
        ? values.includes(String(row[field] ?? '').trim()) : row[field] != null && values.includes(String(row[field])));
      return { records: found.map(copy), nextKey: null };
    },
    async listRelated() { return { records: [], nextKey: null }; },
    async createRecord(id: string, data: Record<string, unknown>) {
      mutations++; if (failWrite) throw Error('write failed');
      set(id, ++nextId, data); return copy(rowset(id).get(String(nextId))!);
    },
    async patchRecord(id: string, key: string[], data: Record<string, unknown>) {
      mutations++; if (failWrite) throw Error('write failed');
      if (Object.values(data).some(v => v === undefined)) throw Error('undefined SQL parameter');
      const r = rowset(id).get(key[0]); if (!r) throw Error('missing row');
      Object.assign(r, data); if (failAfterWrite) throw Error('write result unknown'); return copy(r);
    }, async transaction<T>(fn: (tx: unknown) => Promise<T>) { return fn(db); }
  } as unknown as ConsoleSql;
  const grant: ConsoleWrites = { clientIds: new Set([7]), create: (tx, id, data) => tx.createRecord(id, data) };
  const legacy = createWebConsoleRepository({ nocoClient: {
    async fetchRecords(id: string, _size?: number, query?: { where?: string }) {
      if (failRead) throw readError;
      const data = [...rowset(id).values()].map(r => ({ ...r }));
      for (const r of data) for (const [title, target] of Object.entries(relations[id] ?? {}))
        r[title] = title === 'Mentors' ? [] : rowset(target).get(String(r[fk(title)])) ?? null;
      return legacyFixtureRows(data, query?.where);
    }, fetchTableMeta: async (id: string) => tables.find(m => m.id === id),
    createRecord: async (id: string, data: Record<string, unknown>) => (await db.createRecord(id, JSON.parse(JSON.stringify(data)))).data,
    patchRecord: async (id: string, key: number, data: Record<string, unknown>) => (await db.patchRecord(id, [String(key)], JSON.parse(JSON.stringify(data)))).data
  } });
  return { db, grant, legacy, sql: createSqlConsoleRepository(db, grant), rows, set,
    assertReadable: () => { if (failRead) throw readError; },
    count: () => mutations, failWrite: (v = true) => { failWrite = v; },
    failRead: (v = true, error = Error('readback failed')) => { failRead = v; readError = error; },
    failAfterWrite: (v = true) => { failAfterWrite = v; } };
}
