import { createRequire } from 'node:module';
import { linkedInRecords } from './linkedin-records.mts';
import { linkedInWrites } from './linkedin-writes.mts';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import type { AuthRepository, AuthHistory } from './linkedin-contracts.mts';
const require = createRequire(import.meta.url);
const { createLinkedInAuthNocoRepository } = require('../../../linkedin-automation/account-connection/noco-repository.ts') as {
  createLinkedInAuthNocoRepository(client: unknown, failureClient: unknown, link: ReturnType<typeof linkedInWrites>['link']): AuthRepository };
const { createLinkedInAuthHistoryStore } = require('../linkedin-auth-history-store.ts') as {
  createLinkedInAuthHistoryStore(client: unknown): AuthHistory };
export function createSqlLinkedInStorage(db: ConsoleSql, grant?: ConsoleWrites) {
  const records = linkedInRecords(db), writes = linkedInWrites(db, records.historyId, grant);
  const port = { ...records, patchRecord: writes.patchRecord, createRecord: writes.createRecord };
  return { repository: createLinkedInAuthNocoRepository(port, port, writes.link),
    history: createLinkedInAuthHistoryStore(port) };
}
