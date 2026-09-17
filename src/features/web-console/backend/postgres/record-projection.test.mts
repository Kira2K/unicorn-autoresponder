import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowFixture } from './workflow-fixture.mts';
import { consoleRecords } from './records.mts';
import { tableIds } from './tables.mts';

test('login projection reads all pages without loading every student relation', async () => {
  const f = workflowFixture(), data = Array.from({ length: 501 }, (_, i) => ({
    key: [String(i + 1)], data: { Id: i + 1, calendar_email: i ? '' : null, nc_order: String(502 - i) }, sourceJson: ''
  }));
  let pages = 0, relations = 0;
  f.db.listRecords = async (_id, options) => {
    pages++; const start = Number(options?.after?.[0] ?? 0), limit = options?.limit ?? 100;
    return { records: structuredClone(data.slice(start, start + limit)),
      nextKey: start + limit < data.length ? [String(start + limit)] : null };
  };
  f.db.listRelated = async () => { relations++; throw Error('unexpected relation'); };
  f.db.findRecords = async () => { throw Error('unexpected FK lookup'); };
  const before = structuredClone(data);
  const rows = await consoleRecords(f.db).fetchRecords(tableIds.clients, 100, { fields: 'Id,calendar_email', sort: 'Id' });
  assert.equal(pages, 6); assert.equal(relations, 0);
  assert.deepEqual(rows, data.map(r => ({ Id: r.data.Id, calendar_email: r.data.calendar_email })));
  assert.deepEqual(data, before);
});

test('selected relations are fresh; full records and default order retain their contract', async () => {
  const f = workflowFixture(); let related = 0;
  f.db.listRelated = async () => { related++; return { records: [], nextKey: null }; };
  const source = consoleRecords(f.db);
  const projected = await source.fetchRecords(tableIds.clients, 100, { where: '(Id,eq,7)', fields: 'Id,market' });
  assert.deepEqual(projected, [{ Id: 7, market: { Id: 1, name: 'En' } }]); assert.equal(related, 0);
  f.set(tableIds.market, 1, { name: 'Ru' });
  assert.equal(((await source.fetchRecords(tableIds.clients))[0].market as { name: string }).name, 'Ru');
  assert.equal(related, 1);
  await assert.rejects(source.fetchRecords(tableIds.clients, 100, { sort: 'unsupported' }), /query_unsupported/);
});
