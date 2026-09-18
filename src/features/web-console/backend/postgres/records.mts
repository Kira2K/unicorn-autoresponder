import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import type { CopyRecord } from '../../../../integrations/postgres/contracts.mts';
import { readPages } from '../../../../platform/db/postgres/pages.mts';
import { nocoRecordOrder } from '../../../../platform/db/postgres/record-order.mts';
import type { ConsoleRow, ConsoleSql } from './contracts.mts';
import { readable, relations, tableIds } from './tables.mts';
import { filterRows, consoleClauses } from './query.mts';
export function consoleRow(record: CopyRecord): ConsoleRow {
  const id = Number(record.data.Id);
  if (!Number.isSafeInteger(id) || id <= 0 || record.key.length !== 1 || String(id) !== record.key[0])
    throw new PostgresReadError('sql_console_id_mismatch');
  return { ...record.data, Id: id };
}
export function consoleRecords(db: ConsoleSql) {
  const tables = db.listTables();
  function table(id: string) {
    const found = tables.find(t => t.id === id);
    if (!readable.has(id) || !found) throw new PostgresReadError('table_not_allowed');
    return found;
  }
  const readAll = (id: string) => { table(id); return readPages(after => db.listRecords(id, { limit: 100, after })); };
  const find = (id: string, field: string, values: string[], trim = false) => {
    table(id); return readPages(after => db.findRecords(id, field, values, { limit: 100, after, trim }));
  };
  return {
    async fetchClientReferences() {
      return nocoRecordOrder((await readAll(tableIds.clients)).map(consoleRow))
        .map(row => ({ Id: row.Id, chat: row.telegram_general_chat_id }));
    },
    async fetchTableMeta(id: string) { return structuredClone(table(id)); },
    async fetchRecords(id: string, _pageSize?: number, query?: { where?: string; fields?: string; sort?: string }): Promise<ConsoleRow[]> {
      const definition = table(id);
      if (query?.sort && query.sort !== 'Id') throw new PostgresReadError('sql_console_query_unsupported');
      const selected = query?.fields ? new Set(['Id', ...query.fields.split(',').map(field => field.trim())]) : undefined;
      const byId = /^\(Id,eq,([1-9]\d*)\)$/.exec(query?.where ?? '');
      const record = byId ? await db.getRecord(id, [byId[1]]) : undefined;
      let raw = byId ? (record ? [record] : []) : query?.where ? [] : await readAll(id);
      if (!byId && query?.where) {
        const found = new Map<string, CopyRecord>();
        for (const { field, value } of consoleClauses(query.where))
          for (const row of await find(id, field, [value], true)) found.set(JSON.stringify(row.key), row);
        raw = [...found.values()];
      }
      const filtered = filterRows(raw.map(consoleRow), query?.where);
      const rows = query?.sort === 'Id' ? filtered.sort((a, b) => a.Id - b.Id) : nocoRecordOrder(filtered);
      for (const [title, targetId] of Object.entries(relations[id] ?? {})) {
        if (selected && !selected.has(title)) continue;
        const fields = definition.columns.filter(c => c.title === title), field = fields[0], o = field?.colOptions;
        if (fields.length !== 1 || !o || o.fk_related_model_id !== targetId)
          throw new PostgresReadError('sql_console_relation_required');
        const target = table(targetId);
        if (o.type === 'bt') {
          const child = definition.columns.find(c => c.id === o.fk_child_column_id);
          const parent = target.columns.find(c => c.id === o.fk_parent_column_id);
          if (!child || !parent) throw new PostgresReadError('sql_console_relation_required');
          const values = [...new Set(rows.flatMap(row => row[child.dataKey] == null ? [] : [String(row[child.dataKey])]))];
          const linked: CopyRecord[] = [];
          for (let i = 0; i < values.length; i += 500) linked.push(...await find(targetId, parent.dataKey, values.slice(i, i + 500)));
          const byId = new Map(linked.map(r => [String(r.data[parent.dataKey]), consoleRow(r)]));
          for (const row of rows) row[title] = row[child.dataKey] == null ? null : byId.get(String(row[child.dataKey])) ?? null;
        } else if (o.type === 'mm') {
          for (const row of rows) row[title] = (await readPages(after => db.listRelated(id, field.id, [String(row.Id)],
            { limit: 100, after }))).map(consoleRow);
        } else throw new PostgresReadError('sql_console_relation_unsupported');
      }
      return selected ? rows.map(row => ({ ...Object.fromEntries(Object.entries(row).filter(([key]) => selected.has(key))), Id: row.Id })) : rows;
    }
  };
}
