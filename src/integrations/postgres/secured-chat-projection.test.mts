import test from 'node:test';
import assert from 'node:assert/strict';
import { projection, fields } from './working-records.mts';
import { sourceFields } from './local-columns.mts';
import type { WorkingTable } from './working-catalog.mts';

const clients: WorkingTable = { id: 'mxza381054ldlza', title: 'clients', table_name: 'clients', columns: [
  { id: 'id', title: 'Id', dataKey: 'Id', sqlName: 'id', sqlType: 'bigint', pk: true },
  { id: 'chat', title: 'telegram_general_chat_id', dataKey: 'telegram_general_chat_id', sqlName: 'old_chat', sqlType: 'text' }
] };

test('optional secured projection is whitelisted, safe when missing, and leaves raw IDs intact', () => {
  const before = structuredClone(clients), sql = projection(clients);
  assert.match(sql, /'telegram_general_chat_id',t\."old_chat"/);
  assert.match(sql, /'secured_general_chat_id',to_jsonb\(t\)->'secured_general_chat_id'/);
  assert.match(projection(clients, 'r'), /to_jsonb\(r\)->'secured_general_chat_id'/);
  assert.doesNotMatch(sql, /invitation|password|\|\| to_jsonb/);
  assert.doesNotMatch(projection({ ...clients, id: 'other' }), /secured_general_chat_id/);
  assert.deepEqual(clients, before, 'read projection does not register or mutate columns');
  assert.throws(() => fields(clients, { secured_general_chat_id: '-34' }), { code: 'field_not_writable' });
  assert.deepEqual(sourceFields(clients.columns, { Id: 1, telegram_general_chat_id: '-12', secured_general_chat_id: '-34' }),
    { Id: 1, telegram_general_chat_id: '-12' });
});

test('registered secured fields are projected once using their catalog mapping', () => {
  const sql = projection({ ...clients, columns: [...clients.columns, {
    id: 'secured', title: 'secured_general_chat_id', dataKey: 'secured_general_chat_id', sqlName: 'secured_chat', sqlType: 'text'
  }] });
  assert.match(sql, /'secured_general_chat_id',t\."secured_chat"/);
  assert.doesNotMatch(sql, /to_jsonb/);
});
