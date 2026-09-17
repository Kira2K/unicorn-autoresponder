import test from 'node:test';
import assert from 'node:assert/strict';
import type { SqlSession } from './contracts.mts';
import { createWorkingCatalog } from './working-catalog.mts';
import { workingCrud } from './working-crud.mts';
import { relation } from './working-relations.mts';
import { checkKey, parameter } from './working-records.mts';
function fixture(kind = 'mm') {
  const scalar = (id: string, title: string, pk = false) => ({ id, title, pk, uidt: pk ? 'ForeignKey' : 'SingleLineText' });
  const definitions = [
    { id: 'mleft', title: 'Left', table_name: 'left', columns: [{ ...scalar('cleft', 'Id', true), uidt: 'ID' },
      { id: 'clink', title: 'Right', uidt: 'Links', colOptions: { type: kind, fk_related_model_id: 'mright',
        fk_child_column_id: 'cleft', fk_parent_column_id: 'cright', fk_mm_model_id: 'mjoin',
        fk_mm_child_column_id: 'cjleft', fk_mm_parent_column_id: 'cjright' } }] },
    { id: 'mright', title: 'Right', table_name: 'right', columns: [{ ...scalar('cright', 'Id', true), uidt: 'ID' }] },
    { id: 'mjoin', title: 'Junction', table_name: 'junction', columns: [scalar('cjleft', 'LeftId', true), scalar('cjright', 'RightId', true)] }
  ];
  const catalog = createWorkingCatalog(definitions.map(d => ({ definition: { ...d,
    mapping: d.columns.map(c => ({ id: c.id, title: c.title, sqlName: c.id, sqlType: c.uidt === 'Links' ? 'jsonb' : 'bigint' })) } })));
  const calls: { text: string; values: unknown[] }[] = [];
  const state = { conflict: false, parentExists: true };
  const session: SqlSession = { release() {}, async query(text, values = []) {
    calls.push({ text, values });
    if (text.startsWith('SELECT 1')) return { rows: text.includes('_copy_id<>')
      ? state.conflict ? [{}] : [] : state.parentExists ? [{}] : [] };
    if (text.startsWith('INSERT')) return { rows: [{ record_key: '["1","2"]', source_json: '{"LeftId":1,"RightId":2}' }] };
    return { rows: [] };
  } };
  return { catalog, session, state, calls };
}
test('many-to-many uses original junction; composite key and parent checks are preserved', async () => {
  const { catalog, session, calls } = fixture();
  assert.match(relation(catalog, 'mleft', 'clink').join, /noco\."mjoin"/);
  const row = await workingCrud(session, catalog).createRecord('mjoin', { LeftId: '1', RightId: '2' });
  assert.deepEqual(row.key, ['1', '2']);
  assert.equal(calls.filter(c => c.text.startsWith('SELECT 1')).length, 2);
  assert.ok(calls.find(c => c.text.startsWith('INSERT'))!.values.includes('["1","2"]'));
});
test('missing junction parent aborts before insert, even without physical FK constraints', async () => {
  const { catalog, session, state, calls } = fixture(); state.parentExists = false;
  await assert.rejects(workingCrud(session, catalog).createRecord('mjoin', { LeftId: '1', RightId: '2' }), /invalid_reference/);
  assert.ok(!calls.some(c => c.text.startsWith('INSERT')));
});
test('om/mo junctions cannot attach a second parent through direct CRUD', async () => {
  for (const kind of ['om', 'mo']) {
    const { catalog, session, state, calls } = fixture(kind); state.conflict = true;
    await assert.rejects(workingCrud(session, catalog).createRecord('mjoin', { LeftId: '1', RightId: '2' }), /relation_already_linked/);
    const limited = kind === 'om' ? 'cjright' : 'cjleft';
    assert.ok(calls.some(c => c.text.includes(`"${limited}"=$1`) && c.text.includes('_copy_id<>')));
    assert.ok(!calls.some(c => c.text.startsWith('INSERT')));
  }
});
test('current PK and saved key must agree; nested unsafe JSON numbers are rejected', () => {
  const { catalog } = fixture(); const t = catalog.get('mjoin');
  assert.throws(() => checkKey(t, { key: ['01', '2'], data: { LeftId: 1, RightId: 2 }, sourceJson: '{}' }), /record_key_mismatch/);
  assert.throws(() => parameter({ ...t.columns[0], sqlType: 'jsonb' }, { n: 9007199254740992 }), /invalid_json_value/);
  assert.throws(() => parameter({ ...t.columns[0], sqlType: 'jsonb' }, { n: undefined }), /invalid_json_value/);
});
