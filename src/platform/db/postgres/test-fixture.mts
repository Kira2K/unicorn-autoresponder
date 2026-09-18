import { createRequire } from 'node:module';
import type { CopyRecord, PageOptions, RecordPage } from '../../../integrations/postgres/contracts.mts';
import type { WorkingTable } from '../../../integrations/postgres/working-catalog.mts';
import type { AppDbReader, AppDbRow } from './record-source.mts';
export const { TABLES } = createRequire(import.meta.url)('../../../integrations/noco/core/schema.ts') as {
  TABLES: Record<string, { id: string; title: string }>;
};
export const unusedSheets = {
  async getStudentTelegramRecords(): Promise<never> { throw new Error('unexpected_sheets_call'); },
  async getProxyRequiredClients(): Promise<never> { throw new Error('unexpected_sheets_call'); }
};
export function makeFixture() {
  const data: Record<string, AppDbRow[]> = {
    clients: [{ Id: 1, client_name: 'Fake', telegram_general_chat_id: '-1', stacks_id: 3, stop_list_company: ' Local Ltd; ' },
      { Id: 2, client_name: 'Second', telegram_general_chat_id: '-2', stacks_id: 4 }],
    stacks: [{ Id: 3, name: 'Go', hh_scenario_url_ru: 'fake-ru', hh_scenario_url_en: 'fake-en' }, { Id: 4, name: 'Python' }],
    hhAutoresponses: [{ Id: 5, clients_id: 1, stacks_id1: null, Делаем_отклики_Ru: true, Делаем_отклики_En: true,
      Сопровод_Ru: ' Привет ', Сопровод_En: ' Hello ' }, { Id: 6, clients_id: 2, stacks_id1: 3, Делаем_отклики_Ru: true }],
    dolphinProfiles: [{ Id: 7, clients_id: 1, locale: 'Ru', dolphin_profile_id: '101' },
      { Id: 8, clients_id: 1, locale: 'En', dolphin_profile_id: '201' }, { Id: 9, clients_id: 2, locale: 'Ru', dolphin_profile_id: '301' }],
    platformAccounts: [{ Id: 10, clients_id: 1, platforms_id: 11, phone: '123', email: 'fake@example.invalid', password: ' fixture ' },
      { Id: 11, clients_id: 1, platforms_id: 10, login: '456', email: 'fake-en@example.invalid', password: ' fixture-en ' }],
    restrictions: [{ Id: 12, clients_id: 1, market: 'En' }],
    companies: [{ Id: 13, company_name: 'Blocked One' }, { Id: 14, company_name: 'Blocked Two' }]
  };
  const tables: WorkingTable[] = Object.entries(data).map(([key, rows]) => ({
    id: TABLES[key].id, title: TABLES[key].title, table_name: key,
    columns: [...new Set(rows.flatMap(Object.keys))].map(title => ({ id: `${key}_${title}`, title, dataKey: title,
      sqlName: title, sqlType: 'text', pk: title === 'Id' }))
  }));
  for (const [key, title, fk, type, target] of [
    ['clients', 'rel_clients_primary_stack', 'stacks_id', 'bt', 'stacks'],
    ['hhAutoresponses', 'Stack Override', 'stacks_id1', 'bt', 'stacks'],
    ['restrictions', 'rel_restrictions_blocked_companies', '', 'mm', 'companies']]) {
    tables.find(t => t.table_name === key)!.columns.push({ id: title, title, dataKey: title, sqlName: title,
      sqlType: 'jsonb', uidt: 'Links', colOptions: { type, fk_child_column_id: `${key}_${fk}`,
        fk_parent_column_id: `${target}_Id`, fk_related_model_id: TABLES[target].id } });
  }
  const requests: string[] = [];
  function page(rows: AppDbRow[], options: PageOptions = {}): RecordPage {
    const sorted = [...rows].sort((a, b) => JSON.stringify([String(a.Id)]).localeCompare(JSON.stringify([String(b.Id)])));
    const start = options.after ? sorted.findIndex(r => String(r.Id) === options.after![0]) + 1 : 0;
    const selected = sorted.slice(start, start + 1).map(r => ({ key: [String(r.Id)], data: structuredClone(r),
      sourceJson: '{"Id":999,"client_name":"ARCHIVE MUST NOT BE READ"}' } satisfies CopyRecord));
    return { records: selected, nextKey: start + 1 < sorted.length ? selected.at(-1)!.key : null };
  }
  const reader: AppDbReader = {
    listTables: () => structuredClone(tables),
    async listRecords(id, options) { requests.push(id); return page(data[tables.find(t => t.id === id)!.table_name], options); },
    async listRelated(_id, _field, _key, options) { requests.push('relation'); return page(data.companies, options); }
  };
  const records = { async fetchRecords(id: string): Promise<AppDbRow[]> {
    const name = tables.find(t => t.id === id)!.table_name;
    return data[name].map(r => {
      const copy = structuredClone(r);
      if (name === 'clients') copy.rel_clients_primary_stack = data.stacks.find(s => s.Id === r.stacks_id) ?? null;
      if (name === 'hhAutoresponses') copy['Stack Override'] = data.stacks.find(s => s.Id === r.stacks_id1) ?? null;
      if (name === 'restrictions') copy.rel_restrictions_blocked_companies = structuredClone(data.companies);
      return copy;
    });
  } };
  return { reader, records, data, tables, requests };
}
