import { PostgresReadError } from './contracts.mts';
import type { CopyDatabase, SqlPool, SqlSession } from './contracts.mts';
import { createReadSession } from './read-session.mts';
import { createWorkingCatalog } from './working-catalog.mts';
import { workingReads } from './working-reads.mts';
import { workingCrud } from './working-crud.mts';
import { workingLinks } from './working-links.mts';
import { workingLocks } from './working-locks.mts';
import { writeTransaction } from './working-session.mts';
export type PostgresTransaction = ReturnType<typeof workingReads> & ReturnType<typeof workingCrud> &
  ReturnType<typeof workingLinks> & ReturnType<typeof workingLocks>;
export async function createPostgresClient(pool: SqlPool, database: CopyDatabase, options: { writable?: boolean } = {}) {
  const read = createReadSession(pool, database), writable = options.writable === true;
  const catalog = await read(async s => createWorkingCatalog((await s.query(
    "SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows));
  async function transaction<T>(operation: (tx: PostgresTransaction) => Promise<T>): Promise<T> {
    if (!writable) throw new PostgresReadError('writes_disabled');
    return writeTransaction(pool, database, async session => {
      let closed = false, failure: unknown, pending: Promise<unknown> | undefined;
      const operations = { ...workingReads(session, catalog), ...workingCrud(session, catalog),
        ...workingLinks(session, catalog), ...workingLocks(session, catalog) };
      const guarded = Object.fromEntries(Object.entries(operations).map(([name, fn]) => [name, (...args: unknown[]) => {
        if (closed) return Promise.reject(new PostgresReadError('transaction_closed'));
        if (pending || failure) {
          failure ??= new PostgresReadError('parallel_transaction_operation');
          return Promise.reject(failure);
        }
        const promise = (fn as (...values: unknown[]) => Promise<unknown>)(...args);
        pending = promise;
        void promise.then(() => { pending = undefined; }, e => { pending = undefined; failure = e; });
        return promise;
      }])) as PostgresTransaction;
      try {
        const result = await operation(guarded);
        if (pending) { await pending; throw new PostgresReadError('operation_not_awaited'); }
        if (failure) throw failure;
        return result;
      } finally { closed = true; if (pending) await pending.catch(() => {}); }
    });
  }
  const reading = <T,>(op: (s: SqlSession) => Promise<T>) => read(op);
  return {
    listTables: () => catalog.list().map(t => catalog.get(t.id)),
    findRecords: (...args: Parameters<PostgresTransaction['findRecords']>) => reading(s => workingReads(s, catalog).findRecords(...args)),
    getRecord: (...args: Parameters<PostgresTransaction['getRecord']>) => reading(s => workingReads(s, catalog).getRecord(...args)),
    listRecords: (...args: Parameters<PostgresTransaction['listRecords']>) => reading(s => workingReads(s, catalog).listRecords(...args)),
    listRelated: (...args: Parameters<PostgresTransaction['listRelated']>) => reading(s => workingReads(s, catalog).listRelated(...args)),
    createRecord: (...args: Parameters<PostgresTransaction['createRecord']>) => transaction(tx => tx.createRecord(...args)),
    patchRecord: (...args: Parameters<PostgresTransaction['patchRecord']>) => transaction(tx => tx.patchRecord(...args)),
    deleteRecord: (...args: Parameters<PostgresTransaction['deleteRecord']>) => transaction(tx => tx.deleteRecord(...args)),
    linkRecord: (...args: Parameters<PostgresTransaction['linkRecord']>) => transaction(tx => tx.linkRecord(...args)),
    unlinkRecord: (...args: Parameters<PostgresTransaction['unlinkRecord']>) => transaction(tx => tx.unlinkRecord(...args)),
    transaction
  };
}
