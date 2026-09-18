import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGeneratedIds } from './identity-preflight.mts';
import { createWorkingCatalog } from './working-catalog.mts';
import { metadata, workingFake } from './working-fixture.mts';
const table = () => createWorkingCatalog(metadata.map(definition => ({ definition }))).get('mpeople');

test('startup preflight only reads; missing allocator cannot run DDL or allocate an ID', async () => {
  for (const ready of [false, true]) {
    const { pool, state } = workingFake(), original = pool.connect;
    pool.connect = async () => {
      const s = await original();
      return { ...s, async query(text, values) {
        const r = await s.query(text, values);
        return text.includes('has_sequence_privilege') ? { rows: [{ ready }] } : r;
      } };
    };
    if (ready) await assertGeneratedIds(pool, 'unicorn_noco_copy_restore', [table()]);
    else await assert.rejects(assertGeneratedIds(pool, 'unicorn_noco_copy_restore', [table()]), /postgres_id_allocator_required/);
    assert.equal(state.calls.at(-1)?.text, 'ROLLBACK');
    assert.ok(!state.calls.some(c => /INSERT|UPDATE|ALTER|nextval/.test(c.text)));
  }
});
