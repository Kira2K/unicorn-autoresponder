/** Explicit read-only acceptance run. Connection is supplied over stdin; prints only counts. */
import assert from 'node:assert/strict';
import { createPostgresPool } from './pg-pool.mts';
import { createPostgresReadClient } from './client.mts';
import { PostgresReadError } from './contracts.mts';
import type { ConnectionOptions } from './contracts.mts';
import { isCrmTable } from './catalog.mts';
import { openSnapshot } from '../noco/full-backup/postgres-copy/snapshot.mts';
async function main() {
  if (!process.argv[2]) throw new Error('snapshot_required');
  const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const connection = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ConnectionOptions;
  const snapshot = await openSnapshot(process.argv[2]);
  const expected = snapshot.tables.filter(t => !isCrmTable(t));
  const pool = createPostgresPool(connection);
  try {
    const db = await createPostgresReadClient(pool, connection.database);
    assert.deepEqual(db.listTables().map(t => t.id).sort(), expected.map(t => t.id).sort());
    let records = 0, pages = 0, relationFields = 0, relatedRecords = 0;
    for (const table of expected) {
      let after: string[] | null = null; const seen = new Set<string>();
      do {
        const page = await db.listRecords(table.id, { limit: 100, ...(after ? { after } : {}) }); pages++;
        for (const record of page.records) {
          const id = JSON.stringify(record.key); assert.ok(!seen.has(id)); seen.add(id); records++;
        }
        if (!after && page.records[0]) assert.deepEqual(await db.getRecord(table.id, page.records[0].key), page.records[0]);
        after = page.nextKey;
      } while (after);
      assert.equal(seen.size, snapshot.data.get(table.id)!.length);
      for (const field of table.columns.filter(c => ['Links', 'LinkToAnotherRecord'].includes(c.uidt))) {
        const groups = new Map<string, Set<string>>();
        for (const edge of snapshot.edges.filter(e => e.field === field.id)) {
          if (!groups.has(edge.source)) groups.set(edge.source, new Set()); groups.get(edge.source)!.add(edge.target);
        }
        const largest = [...groups].sort((a, b) => b[1].size - a[1].size)[0]; if (!largest) continue;
        const [key, targets] = largest; const found = new Set<string>(); let cursor: string[] | null = null;
        do {
          const page = await db.listRelated(table.id, field.id, JSON.parse(key) as string[],
            { limit: 100, ...(cursor ? { after: cursor } : {}) });
          for (const row of page.records) { const id = JSON.stringify(row.key); assert.ok(!found.has(id)); found.add(id); }
          cursor = page.nextKey;
        } while (cursor);
        assert.deepEqual([...found].sort(), [...targets].sort()); relationFields++; relatedRecords += found.size;
      }
    }
    const excluded = snapshot.tables.filter(isCrmTable);
    for (const table of excluded) await assert.rejects(db.listRecords(table.id), /table_not_allowed/);
    console.log(JSON.stringify({ status: 'passed', tables: expected.length, records, pages,
      relationFields, relatedRecords, crmTablesBlocked: excluded.length, writes: 0 }));
  } finally { await pool.end(); }
}
main().catch(error => {
  console.error(JSON.stringify({ status: 'failed', code: error instanceof PostgresReadError ? error.code : 'smoke_check_failed' }));
  process.exitCode = 1;
});
