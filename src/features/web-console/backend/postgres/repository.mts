import { createRequire } from 'node:module';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import type { WebConsoleRepository } from '../types.ts';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import { consoleRecords } from './records.mts';
import { consoleWrites } from './writes.mts';
import { tableIds } from './tables.mts';
import { selectedClientReads } from './selected-clients.mts';
const { createWebConsoleRepository } = createRequire(import.meta.url)('../repository.ts') as {
  createWebConsoleRepository(options: { nocoClient: unknown }): WebConsoleRepository;
};
// Reuse the established DTO/ownership/validation rules; no Noco transport is constructed.
export function createSqlConsoleRepository(db: ConsoleSql, writes?: ConsoleWrites): WebConsoleRepository {
  const raw = { ...consoleRecords(db), ...consoleWrites(db, writes) };
  const port = Object.fromEntries(Object.entries(raw).map(([name, method]) => [name, async (...args: unknown[]) => {
    try { return await (method as (...a: unknown[]) => Promise<unknown>)(...args); }
    catch (error) {
      if (error instanceof PostgresReadError) throw Object.assign(new Error('SQL data service unavailable'),
        { code: error.code, response: { status: 503 } });
      throw error;
    }
  }]));
  const repository = createWebConsoleRepository({ nocoClient: port });
  return { ...repository, ...selectedClientReads(port), async createDolphinProfileBinding(input) {
    // SQL FK creates the binding in the same transaction; Noco's second link POST is unnecessary.
    return port.createRecord(tableIds.profiles, { client_name: input.clientName, locale: input.locale,
      dolphin_profile_id: String(input.dolphinProfileId), clients_id: input.clientId });
  } };
}
