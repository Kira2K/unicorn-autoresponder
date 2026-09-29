import type { createPostgresClient, PostgresTransaction } from '../../../../integrations/postgres/working-client.mts';
import type { CopyRecord } from '../../../../integrations/postgres/contracts.mts';
import type { LinkLabIntake } from '../../../linkedin-automation/linklab/intake.mts';
export type ConsoleSql = Awaited<ReturnType<typeof createPostgresClient>>;
export type ConsoleRow = Record<string, unknown> & { Id: number };
export interface ConsoleWrites {
  linklab?: LinkLabIntake;
  clientIds: ReadonlySet<number>;
  // Only application composition can opt out of the artificial-student test scope.
  allClients?: true;
  // PostgreSQL allocates new IDs; copy/import tests may supply reserved IDs.
  create(tx: PostgresTransaction, table: string, data: Readonly<Record<string, unknown>>): Promise<CopyRecord>;
}
