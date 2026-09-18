import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import { tableIds } from './tables.mts';
import { consoleRow } from './records.mts';
export function consoleWrites(db: ConsoleSql, options?: ConsoleWrites) {
  async function allow(table: string, id?: number, input?: Readonly<Record<string, unknown>>) {
    if (!options || ![tableIds.clients, tableIds.accounts, tableIds.profiles, tableIds.cv].includes(table))
      throw Object.assign(new Error('Запись в этом разделе тестовой копии запрещена.'), { code: 'forbidden' });
    const record = id === undefined ? undefined : await db.getRecord(table, [String(id)]);
    const clientId = table === tableIds.clients ? id : Number(record?.data.clients_id ?? input?.clients_id);
    if (!clientId || (!options.allClients && !options.clientIds.has(clientId)))
      throw Object.assign(new Error('Запись разрешена только для тестового ученика.'), { code: 'forbidden' });
    return options;
  }
  return {
    async createRecord(table: string, input: Readonly<Record<string, unknown>>) {
      const granted = await allow(table, undefined, input);
      if (table === tableIds.clients) throw new PostgresReadError('sql_console_create_client_disabled');
      const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      // Legacy Noco payload duplicates the platform label; the current schema stores its FK only.
      if (table === tableIds.accounts && !db.listTables().find(t => t.id === table)?.columns.some(c => c.dataKey === 'platform')) {
        if (!Number.isSafeInteger(Number(data.platforms_id)) || !data.platforms_id)
          throw new PostgresReadError('sql_console_platform_required');
        delete data.platform;
      }
      return consoleRow(await db.transaction(tx => granted.create(tx, table, data)));
    },
    async patchRecord(table: string, id: number, input: Readonly<Record<string, unknown>>) {
      await allow(table, id);
      if (Object.hasOwn(input, 'clients_id')) throw new PostgresReadError('sql_console_owner_immutable');
      // Noco's JSON transport omits undefined; preserve that contract without clearing SQL values.
      const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      if (!Object.keys(data).length) {
        const record = await db.getRecord(table, [String(id)]);
        if (!record) throw new PostgresReadError('record_not_found');
        return consoleRow(record);
      }
      // Clearing the date input means absence, not an empty string in a SQL date column.
      if (table === tableIds.clients && data.birth_date === '' && db.listTables().find(t => t.id === table)
        ?.columns.some(c => c.dataKey === 'birth_date' && c.sqlType === 'date')) data.birth_date = null;
      return consoleRow(await db.patchRecord(table, [String(id)], data));
    },
    async deleteRecord(table: string, id: number) {
      await allow(table, id);
      if (table !== tableIds.accounts) throw new PostgresReadError('sql_console_delete_disabled');
      return db.deleteRecord(table, [String(id)]);
    }
  };
}
