import { createRequire } from 'node:module';
import type { AppDb } from '../types.ts';
import { createPostgresRecordSource } from './record-source.mts';
import type { AppDbReader, AppDbRow } from './record-source.mts';
import type { hhPolicy } from '../../../features/company-client-management/restrictions/hh.mts';
type PolicyLoader = () => Promise<ReturnType<typeof hhPolicy> | undefined>;
const { createNocoDb } = createRequire(import.meta.url)('../noco/noco-db.ts') as {
  createNocoDb(options: { nocoClient: { fetchRecords(tableId: string): Promise<AppDbRow[]> }; loadRestrictionPolicy?: PolicyLoader }): AppDb;
};

export type SheetsReads = Pick<AppDb, 'getStudentTelegramRecords' | 'getProxyRequiredClients'>;
export function createPostgresAppDb(load: () => Promise<AppDbReader>, sheets: SheetsReads, loadRestrictionPolicy?: PolicyLoader): AppDb {
  return {
    ...createNocoDb({ nocoClient: createPostgresRecordSource(load), loadRestrictionPolicy }),
    getStudentTelegramRecords: () => sheets.getStudentTelegramRecords(),
    getProxyRequiredClients: market => sheets.getProxyRequiredClients(market)
  };
}
