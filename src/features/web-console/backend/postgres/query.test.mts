import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterRows } from './query.mts';
test('console filters preserve IDs, Unicode, exact values and combined statuses', () => {
  const rows = [{ Id: 1, status: 'Draft in process', name: 'Аудит' }, { Id: 2, status: 'filled', name: '' }];
  assert.deepEqual(filterRows(rows, '(Id,eq,2)'), [rows[1]]);
  assert.deepEqual(filterRows(rows, '(status,eq,filled)~or(status,eq,Draft in process)'), rows);
  assert.deepEqual(filterRows(rows, '(name,eq,Аудит)'), [rows[0]]);
  assert.deepEqual(filterRows(rows, '(name,eq,)'), [rows[1]]);
  assert.deepEqual(filterRows(rows), rows);
  assert.throws(() => filterRows(rows, '(Id,gt,1)'), /sql_console_query_unsupported/);
  assert.throws(() => filterRows(rows, '(constructor,eq,x)'), /sql_console_query_unsupported/);
});
