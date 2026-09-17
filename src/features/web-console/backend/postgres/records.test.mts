import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consoleRecords } from './records.mts';
import { tableIds } from './tables.mts';
import type { ConsoleSql } from './contracts.mts';
test('SQL console hydrates current FK/MM values without archive JSON or cross-call cache', async () => {
  const r = (id: number, data: Record<string, unknown> = {}) => ({ key: [String(id)], data: { Id: String(id), ...data }, sourceJson: '{"stale":true}' });
  const fields = [{ id: 'cid', title: 'Id', dataKey: 'Id' }, ...['stack', 'market', 'english'].map(key =>
    ({ id: key, title: key, dataKey: key }))];
  const descriptions = [['rel_clients_primary_stack', 'stack', tableIds.stacks], ['market', 'market', tableIds.market],
    ['English level', 'english', tableIds.english], ['Mentors', 'mentor', tableIds.mentors]];
  const tables = [{ id: tableIds.clients, columns: [...fields, ...descriptions.map(([title, key, target]) => ({
    id: 'r_' + key, title, dataKey: title, colOptions: { type: key === 'mentor' ? 'mm' : 'bt',
      fk_child_column_id: key, fk_parent_column_id: 'pk_' + key, fk_related_model_id: target }
  }))] }, ...descriptions.map(([, key, target]) => ({ id: target, columns: [{ id: 'pk_' + key, title: 'Id', dataKey: 'Id' }] }))];
  // Duplicate physical/virtual display title 'market' is not part of the actual schema.
  fields.find(c => c.id === 'market')!.title = 'market_id';
  let name = 'Current';
  const db = { listTables: () => tables, async listRecords(id: string) {
    return { records: id === tableIds.clients ? [r(2, { stack: '9', market: '9', english: null })] : [r(9, { name })], nextKey: null };
  }, async getRecord() { return r(2, { stack: '9', market: '9', english: null }); },
  async findRecords(_id: string, _field: string, values: string[]) {
    return { records: values.includes('9') ? [r(9, { name })] : [], nextKey: null };
  },
  async listRelated() { return { records: [r(11, { name: 'Mentor' })], nextKey: null }; } } as unknown as ConsoleSql;
  const source = consoleRecords(db), first = (await source.fetchRecords(tableIds.clients, 1, { where: '(Id,eq,2)' }))[0];
  assert.equal(first.Id, 2); assert.equal((first.rel_clients_primary_stack as { name: string }).name, 'Current');
  assert.equal(first['English level'], null); assert.equal((first.Mentors as unknown[]).length, 1);
  name = 'Changed'; assert.equal(((await source.fetchRecords(tableIds.clients))[0].market as { name: string }).name, 'Changed');
  await assert.rejects(source.fetchRecords('crm'), /table_not_allowed/);
  tables[0].columns = []; await assert.rejects(consoleRecords(db).fetchRecords(tableIds.clients), /relation_required/);
});
