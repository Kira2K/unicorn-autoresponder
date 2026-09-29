import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { linkLabDisplayFields, linkLabIntakeDisplayFields, linkLabResultDisplayFields, linkLabDateDisplay, linkLabCrmDisplayField, linkLabColumnOrder, planNocoDisplay, validateNocoCatalog, type NocoColumn } from './noco-display.mts';

const column = (name: string): NocoColumn => ({ id: 'artificial', column_name: name,
  title: name, uidt: 'LongText', dt: 'text', rqd: 1, cdf: 'Новый', pk: 0, ai: 0,
  un: 0, dtx: 'specificType', dtxp: null, dtxs: null, unique: false, meta: null });

for (const field of linkLabDisplayFields) {
  test(`${field.name}: preserve physical metadata and input`, () => {
    const before = column(field.name), saved = structuredClone(before);
    const patch = planNocoDisplay(before, field)!;
    assert.deepEqual(before, saved);
    const allowed = new Set(['title', ...(field.options ? ['uidt', 'dtxp', 'colOptions'] : [])]);
    for (const key of Object.keys(before)) if (!allowed.has(key)) assert.deepEqual(patch[key], before[key]);
    assert.equal(patch.title, field.title);
    if (field.options) {
      assert.equal(patch.dt, 'text'); assert.equal(patch.uidt, 'SingleSelect');
      assert.equal(patch.colOptions, null);
      assert.equal(patch.dtxp, field.options.map(v => `'${v}'`).join(','));
    }
  });
  test(`${field.name}: repeat does not update metadata or option values`, () => {
    const applied = planNocoDisplay(column(field.name), field)!;
    if (field.options) applied.colOptions = { options: field.options.map(title => ({ title })) };
    assert.equal(planNocoDisplay(applied, field), null);
  });
}
test('refuse incomplete metadata, another column and incompatible physical type', () => {
  const field = linkLabDisplayFields[0];
  for (const key of ['rqd', 'cdf', 'pk', 'ai', 'un', 'dtx', 'dtxp', 'dtxs']) {
    const bad = column('status'); delete bad[key];
    assert.throws(() => planNocoDisplay(bad, field), /metadata_incomplete/);
  }
  assert.throws(() => planNocoDisplay(column('id'), field), /column_mismatch/);
  assert.throws(() => planNocoDisplay({ ...column('status'), dt: 'jsonb' }, field), /column_mismatch/);
  assert.throws(() => planNocoDisplay({ ...column('status'), uidt: 'SingleLineText' }, field), /type_not_supported/);
});
test('different existing select is not silently rewritten', () => {
  assert.throws(() => planNocoDisplay({ ...column('status'), uidt: 'SingleSelect',
    colOptions: { options: [{ title: 'Other' }] } }, linkLabDisplayFields[0]), /existing_select_differs/);
});
test('display choices match SQL constraints exactly', () => {
  const first = fs.readFileSync(new URL('./sql/001-status.up.sql', import.meta.url), 'utf8');
  const second = fs.readFileSync(new URL('./sql/002-crm-results.up.sql', import.meta.url), 'utf8');
  for (const field of linkLabDisplayFields) {
    if (!field.options) continue;
    const match = (first + second).match(new RegExp(`${field.name} IN \\(([^)]+)\\)`));
    assert.ok(match, field.name);
    assert.deepEqual([...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]), field.options);
  }
});

test('intake display reads only existing SQL fields and exposes no credentials', () => {
  const migration = fs.readFileSync(new URL('./sql/003-intake.up.sql', import.meta.url), 'utf8');
  for (const field of linkLabIntakeDisplayFields) {
    assert.equal(field.uidt, 'Formula');
    for (const [, source] of field.formula_raw.matchAll(/\{([^}]+)\}/g)) {
      assert.match(migration, new RegExp(`ADD COLUMN ${source}\\b`));
      assert.ok(['en_approved_at', 'credentials_issue'].includes(source));
      assert.ok(!linkLabColumnOrder.includes(source as never));
    }
    assert.ok(linkLabColumnOrder.includes(field.title));
  }
  assert.equal(linkLabIntakeDisplayFields[0].formula_raw, '{en_approved_at}');
  assert.doesNotMatch(linkLabIntakeDisplayFields[1].formula_raw, /\{(?:login|password)\}/);
});

test('column order keeps the agreed business fields before service information', () => {
  assert.equal(new Set(linkLabColumnOrder).size, linkLabColumnOrder.length);
  assert.deepEqual(linkLabColumnOrder.slice(0, 6), ['Ученик', 'client_role', 'Стек', 'LinkedIn', 'status', 'Дата финализированного CV']);
  assert.ok(linkLabColumnOrder.indexOf('Данные аккаунта') > linkLabColumnOrder.indexOf('proxy_state'));
});

test('formula metadata uses explicit Moscow time; calendar dates have no timezone shift', () => {
  const time = linkLabDateDisplay();
  assert.equal(time.display_type, 'DateTime');
  assert.equal(time.display_column_meta.meta.timezone, 'Europe/Moscow');
  assert.equal(time.display_column_meta.meta.useSameTimezoneForAll, true);
  assert.equal(time.display_column_meta.meta.date_format, 'DD.MM.YYYY');
  const date = linkLabDateDisplay(true);
  assert.equal(date.display_type, 'Date');
  assert.equal(date.display_column_meta.meta.timezone, undefined);
  assert.deepEqual(linkLabIntakeDisplayFields[0].meta, time);
});
test('empty progress stays empty, while 0 uses the percent branch', () => {
  assert.equal(linkLabResultDisplayFields[0].formula_raw,
    "IF({profile_percent} == BLANK(), '', CONCAT({profile_percent}, '%'))");
  for (const field of linkLabResultDisplayFields) assert.ok(linkLabColumnOrder.includes(field.title as never));
});
test('CRM link is empty without a binding and uses only the configured origin', () => {
  const field = linkLabCrmDisplayField('https://crm.example.invalid/');
  assert.equal(field.uidt, 'Formula');
  assert.equal(field.meta.display_type, 'URL');
  assert.equal(field.formula_raw,
    "IF({crm_student_id} == BLANK(), '', CONCAT('https://crm.example.invalid/manager/students/', {crm_student_id}, '/'))");
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.invalid',
    'https://example.invalid/path', 'https://example.invalid/?secret=1', 'https://example.invalid/#x']) {
    assert.throws(() => linkLabCrmDisplayField(url), /linklab_crm_url_invalid/);
  }
});
const catalog = (): Array<{ id: string; table_name: string; columns: NocoColumn[] }> => [
  { id: 'clients', table_name: 'clients', columns: [
    { ...column('id'), id: 'client-id' }, { ...column('name'), id: 'name' },
  ] },
  { id: 'linklab', table_name: 'linklab', columns: [
    { ...column('client_id'), id: 'fk' },
    { ...column('field'), id: 'rel', uidt: 'LinkToAnotherRecord', colOptions: {
      type: 'bt', fk_related_model_id: 'clients', fk_child_column_id: 'fk', fk_parent_column_id: 'client-id',
    } },
    { ...column('field1'), id: 'lookup', uidt: 'Lookup', colOptions: {fk_relation_column_id: 'rel', fk_lookup_column_id: 'name'} },
  ] },
];
test('complete catalog passes without mutating it', () => {
  const data=catalog(),before=structuredClone(data);validateNocoCatalog(data);assert.deepEqual(data,before);
});
test('duplicate tables or columns stop setup instead of deleting metadata', () => {
  const data=catalog();assert.throws(()=>validateNocoCatalog([...data,data[0]]),/duplicate_table/);
  data[0].columns.push({...data[0].columns[0],id:'different'});
  assert.throws(()=>validateNocoCatalog(data),/duplicate_column/);
});
test('partial import and wrong key ownership stop setup', () => {
  for(const key of ['fk_related_model_id','fk_child_column_id','fk_parent_column_id']) {
    const data=catalog();(data[1].columns[1].colOptions as Record<string,string>)[key]='missing';
    assert.throws(()=>validateNocoCatalog(data),/broken_relation/);
  }
  const data=catalog();(data[1].columns[1].colOptions as Record<string,string>).fk_parent_column_id='fk';
  assert.throws(()=>validateNocoCatalog(data),/broken_relation/);
});
test('lookup cannot point to another table or a deleted field', () => {
  for(const key of ['fk_relation_column_id','fk_lookup_column_id']) {
    const data=catalog();(data[1].columns[2].colOptions as Record<string,string>)[key]='missing';
    assert.throws(()=>validateNocoCatalog(data),/broken_lookup/);
  }
});
