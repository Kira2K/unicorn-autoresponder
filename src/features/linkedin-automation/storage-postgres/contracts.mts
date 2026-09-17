import type { createPostgresClient, PostgresTransaction } from '../../../integrations/postgres/working-client.mts';
import type { CopyRecord } from '../../../integrations/postgres/contracts.mts';
export type FeatureSql = Awaited<ReturnType<typeof createPostgresClient>>;
export type FeatureRow = Record<string, unknown> & { Id: number };
// Tests are scoped to artificial accounts. The application opts into all accounts explicitly.
export interface FeatureWrites {
  accountIds: ReadonlySet<number>;
  allAccounts?: true;
  create(tx: PostgresTransaction, table: string, data: Readonly<Record<string, unknown>>): Promise<CopyRecord>;
}
