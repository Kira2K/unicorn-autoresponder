import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOctoPostgresStore } from './postgres-store.mts';
import { COPY_MARKER } from '../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../integrations/postgres/contracts.mts';
import type { NewProfile } from './contracts.mts';
import { createMemoryStore } from './testing.mts';

function input(locale: 'ru' | 'en' = 'ru', password = '12345'): NewProfile {
  return { clientId: 7, locale, operationId: 'op', password, original: { title: 'Client', description: '', tags: [], start_pages: [] },
    createdAt: 1, ownProxy: false, phase: 'queued' };
}
function fake() {
  const columns = [
    { id: 'pk', title: 'Id', sqlName: 'id', sqlType: 'bigint', pk: true },
    { id: 'client', title: 'clients_id', sqlName: '02_clients_id', sqlType: 'bigint' },
    { id: 'locale', title: 'locale', sqlName: 'locale', sqlType: 'text' }
  ];
  const definition = { id: 'm4thvbutfyb15qz', title: 'dolphin_profiles', table_name: 'dolphin_profiles',
    sqlName: 'dolphin_profiles', sqlTable: 'noco.dolphin_profiles', columns, mapping: columns.map(c => ({ ...c })) };
  const inventory = [{ definition }, { definition: { sqlOnlyFor: definition.id, columns: [{ name: 'browser', sqlType: 'text' }] } }];
  let profiles = new Map<number, Record<string, any>>(), common = new Map<number, any>(), events: any[] = [];
  let clients = new Map<number, Record<string, any>>();
  let cursor: unknown = null, coverage = 0, nextId = 10, seq = 0;
  const calls: Array<{ text: string; values: unknown[] }> = [], releases: boolean[] = [];
  let failure: { text: string; code?: string; constraint?: string } | undefined, held = true;
  let snapshot: any;
  const pool: SqlPool = { async end() {}, async connect() {
    return { release(destroy = false) { releases.push(destroy); }, async query(text, values = []) {
      calls.push({ text, values });
      if (failure && text.includes(failure.text)) throw Object.assign(Error('provider SQL PASSWORD SECRET'), failure);
      if (text.startsWith('BEGIN')) snapshot = structuredClone({ profiles, common, clients, events, cursor, coverage });
      if (text === 'ROLLBACK' && snapshot) { ({ profiles, common, clients, events, cursor, coverage } = snapshot); snapshot = undefined; }
      if (text === 'COMMIT') snapshot = undefined;
      if (text.includes('current_database()')) return { rows: [{ database: 'unicorn_noco_copy_restore', marker: COPY_MARKER }] };
      if (text.includes('copy_meta.inventory')) return { rows: structuredClone(inventory) };
      if (text.includes('AS ready')) return { rows: [{ ready: true }] };
      if (text.includes('nextval(')) return { rows: [{ id: String(++nextId) }] };
      if (text.startsWith('SELECT client_id,password,revision,state')) {
        let rows = [...clients.values()];
        if (text.includes('LIMIT 0')) rows = [];
        else if (text.includes('WHERE client_id')) rows = rows.filter(c => c.client_id===values[0]);
        return { rows: structuredClone(rows) };
      }
      if (text.startsWith('INSERT INTO noco.octo_clients')) {
        if ([...clients.values()].some(c => c.password === values[1]))
          throw Object.assign(Error('secret collision'), { code:'23505',constraint:'octo_clients_password_unique' });
        const row = { client_id:values[0],password:values[1],revision:1,state:JSON.parse(String(values[2])) };
        clients.set(Number(values[0]),row); return { rows: structuredClone([row]) };
      }
      if (text.startsWith('UPDATE noco.octo_clients')) {
        const row = clients.get(Number(values[0]));
        if (!row || row.revision!==values[1] || row.password!==values[2]) return { rows:[] };
        row.revision++; row.state=JSON.parse(String(values[3])); return { rows:structuredClone([row]) };
      }
      if (text.startsWith('INSERT INTO noco."dolphin_profiles"')) {
        const data = JSON.parse(String(values.at(-1))), id = Number(data.Id); common.set(id, { ...data, browser: 'octo' });
        return { rows: [{ record_key: JSON.stringify([String(id)]), source_json: JSON.stringify({ ...data, browser: 'octo' }) }] };
      }
      if (text.startsWith('INSERT INTO noco.octo_profiles')) {
        const state = JSON.parse(String(values[3]));
        if (clients.get(Number(values[1]))?.password !== state.password)
          throw Object.assign(Error('secret divergence'), { code:'23503',constraint:'octo_profiles_client_password_fk' });
        profiles.set(Number(values[0]), { profile_id: values[0], client_id: values[1], locale: values[2], revision: 1, state });
      }
      if (text.startsWith('SELECT profile_id')) {
        let rows = [...profiles.values()];
        if (text.includes('WHERE profile_id')) rows = rows.filter(p => p.profile_id === values[0]);
        else if (text.includes('WHERE client_id')) rows = rows.filter(p => p.client_id === values[0] && (values[1] === undefined || p.locale === values[1]));
        else if (text.includes("WHERE lower(replace(state->>'uuid'")) rows = rows.filter(p => String(p.state.uuid ?? '').replaceAll('-', '').toLowerCase() === values[0]);
        return { rows: structuredClone(rows) };
      }
      if (text.startsWith('UPDATE noco.octo_profiles')) {
        const p = profiles.get(Number(values[0]));
        if (!p || p.revision !== values[1] || p.client_id !== values[2] || p.locale !== values[3]) return { rows: [] };
        if (clients.get(p.client_id)?.password!==JSON.parse(String(values[4])).password)
          throw Object.assign(Error('secret divergence'), { code:'23503',constraint:'octo_profiles_client_password_fk' });
        p.revision++; p.state = JSON.parse(String(values[4])); return { rows: [{ profile_id: p.profile_id }] };
      }
      if (text.startsWith('UPDATE noco.dolphin_profiles')) {
        const p = common.get(Number(values[0])); if (!p) return { rows: [] };
        p.octo_profile_id = values[1]; return { rows: [{ id: values[0] }] };
      }
      if (text.startsWith('INSERT INTO noco.octo_event_inbox')) {
        if ([...profiles.values()].some(p => String(p.state.uuid ?? '').replaceAll('-', '').toLowerCase() === values[1]) && !events.some(e => e.event_id === values[0])) {
          events.push({ seq: ++seq, event_id: values[0], object_uuid: values[1], action: values[2], event_time: values[3], title: values[4] });
          return { rows: [{ seq }] };
        }
      }
      if (text.startsWith('DELETE FROM noco.octo_event_inbox')) events = events.filter(e => e.object_uuid !== values[0]);
      if (text.startsWith('DELETE FROM noco.octo_profiles')) profiles.delete(Number(values[0]));
      if (text.startsWith('DELETE FROM noco.dolphin_profiles')) {
        const p = common.get(Number(values[0]));
        if (!p || p.browser !== 'octo' || p.clients_id !== values[1] || String(p.octo_profile_id).replaceAll('-', '').toLowerCase() !== values[2]) return { rows: [] };
        common.delete(Number(values[0])); return { rows: [{ id: values[0] }] };
      }
      if (text.startsWith('SELECT seq')) return { rows: structuredClone(events.filter(e => e.object_uuid === values[0] && e.seq > Number(values[1]))) };
      if (text.startsWith('SELECT singleton')) return { rows: [{ singleton: true }] };
      if (text.startsWith('SELECT cursor')) return { rows: [{ cursor: structuredClone(cursor), coverage_since: coverage }] };
      if (text.startsWith('UPDATE noco.octo_stream SET cursor')) cursor = JSON.parse(String(values[0]));
      if (text.startsWith('UPDATE noco.octo_stream SET coverage')) { coverage = Math.max(coverage, Number(values[0])); return { rows: [{ singleton: true }] }; }
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ held }] };
      return { rows: [] };
    } };
  } };
  return { pool, calls, releases, store: createOctoPostgresStore(pool, 'unicorn_noco_copy_restore'),
    fail(value?: typeof failure) { failure = value; }, held(value: boolean) { held = value; }, common: () => common };
}

test('reservation creates binding with DB-generated identity, repeats existing locale, and allocates only missing locale', async () => {
  const f = fake(); await f.store.checkSchema();
  const first = (await f.store.reserve([input()]))[0];
  assert.equal(first.id, 11); assert.equal(first.revision, 1);
  assert.deepEqual(f.common().get(11), { Id: '11', clients_id: 7, locale: 'Ru', browser: 'octo' });
  const second = await f.store.reserve([input(), input('en', '67890')]);
  assert.deepEqual(second.map(p => p.id), [11,12]);
  assert.deepEqual(second.map(p => p.password), ['12345','12345']);
  assert.equal(f.calls.filter(c => c.text.startsWith('INSERT INTO noco."dolphin_profiles"')).length, 2);
  assert.ok(f.calls.some(c => c.text.includes('pg_advisory_xact_lock')));
  assert.equal(JSON.parse(String(f.calls.find(c => c.text.startsWith('INSERT INTO noco."dolphin_profiles"'))!.values.at(-1))).browser, undefined,
    'browser is a SQL-only discriminator, not a source Noco field');
});
test('duplicate password rolls back common binding and distinguishes regeneration conflict without exposing values', async () => {
  const f = fake(); await f.store.reserve([input()]);
  await assert.rejects(f.store.reserve([{ ...input('en'),clientId:8 }]), { code: 'octo_password_conflict', message: 'octo_password_conflict' });
  assert.equal(f.common().size, 1); assert.equal((await f.store.list()).length, 1);
});
for (const [name, create] of [['sql mock', () => fake().store], ['memory',createMemoryStore]] as const) {
  test(`${name}: client password reuse, isolated keys and revision CAS`, async () => {
    const store = create();
    assert.equal(await store.clientState(7),undefined);
    const first = await store.claimClientPassword(7,'12345');
    assert.deepEqual(await store.claimClientPassword(7,'55555'),first);
    await assert.rejects(store.claimClientPassword(8,'12345'), { code:'octo_password_conflict' });
    const other = await store.claimClientPassword(8,'22222');
    const saved = await store.saveClientState({ ...first,nodeMavenKey:'private-seven',
      setup:{ id:'setup',source:'nodemaven',phase:'checking',createdAt:1,confirmDolphin:false } });
    assert.equal(saved.revision,2);
    await assert.rejects(store.saveClientState({ ...first,nodeMavenKey:'stale' }), { code:'octo_stale_revision' });
    await assert.rejects(store.saveClientState({ ...saved,password:'55555' }), { code:'octo_stale_revision' });
    saved.nodeMavenKey='mutated-return';
    assert.equal((await store.clientState(7))?.nodeMavenKey,'private-seven');
    assert.deepEqual(await store.clientState(8),other);
    const pair = await store.reserve([input(),input('en','55555')]);
    assert.deepEqual(pair.map(p => p.password),['12345','12345']);
    await assert.rejects(store.save({ ...pair[0],password:'55555' }));
    assert.equal((await store.get(pair[0].id))?.password,'12345');
    assert.deepEqual((await store.clientStates()).map(c => c.clientId),[7,8]);
  });
}
test('save atomically advances revision and common Octo UUID; stale save and missing binding roll back', async () => {
  const f = fake(), p = (await f.store.reserve([input()]))[0];
  const saved = await f.store.save({ ...p, uuid: 'ab-cd', phase: 'ready' });
  assert.equal(saved.revision, 2); assert.equal(f.common().get(p.id).octo_profile_id, 'ab-cd');
  await assert.rejects(f.store.save({ ...p, uuid: 'other' }), { code: 'octo_stale_revision' });
  assert.equal((await f.store.get(p.id))?.uuid, 'ab-cd');
  f.common().delete(p.id);
  await assert.rejects(f.store.save(saved), { code: 'octo_binding_missing' });
  assert.equal((await f.store.get(p.id))?.revision, 2);
});
test('page deduplication, normalized object IDs, titles and insertion order persist atomically with cursor', async () => {
  const f = fake(), events = [
    { id: 'stop', profileId: 'AB-CD', action: 'profiles.stopped', time: 30, title: 'masked' },
    { id: 'start', profileId: 'abcd', action: 'profiles.started', time: 20 }
  ];
  await f.store.save({ ...(await f.store.reserve([input()]))[0], uuid: 'abcd' });
  await f.store.recordPage({ events, watermark: { uuid: 'page1', time: 30 } });
  await f.store.recordPage({ events, watermark: { uuid: 'page2', time: 40 } });
  const stored = await f.store.events('ab-cd');
  assert.deepEqual(stored.map(e => e.id), ['stop','start']); assert.equal(stored[0].title, 'masked');
  assert.deepEqual((await f.store.events('ABCD', stored[0].seq)).map(e => e.id), ['start']);
  assert.deepEqual((await f.store.stream()).cursor, { uuid: 'page2', time: 40 });
  f.fail({ text: 'SET cursor' });
  await assert.rejects(f.store.recordPage({ events: [{ ...events[0], id: 'new' }], watermark: { uuid: 'failed', time: 50 } }),
    { code: 'postgres_write_failed', message: 'postgres_write_failed' });
  f.fail(); assert.equal((await f.store.events('abcd')).length, 2);
  assert.equal((await f.store.stream()).cursor?.uuid, 'page2');
  await f.store.setCoverage(100); await f.store.setCoverage(50); assert.equal((await f.store.stream()).coverageSince, 100);
});

for (const [name, create] of [['sql mock', () => fake().store], ['memory', createMemoryStore]] as const) {
  test(`${name}: deletion event fences writes, purge removes related state, late events stay absent`, async () => {
    const store = create();
    const p = await store.save({ ...(await store.reserve([input()]))[0], uuid: 'AB-CD', phase: 'ready' });
    const c = (await store.clientState(7))!;
    const before = await store.saveClientState({ ...c, nodeMavenKey: 'retained', setup: { id: 'setup', source: 'own', phase: 'provisioning',
      createdAt: 1, confirmDolphin: false, profileIds: [p.id], input: { type: 'socks5', host: 'proxy.test', port: 1080, login: 'private', password: 'secret' } } });
    const page = { events: [{ id: 'deleted', profileId: 'abcd', action: 'profiles.deleted', time: 10 }], watermark: { uuid: 'watermark', time: 10 } };
    await store.recordPage(page); await store.recordPage(page);
    const current = (await store.get(p.id))!;
    assert.equal(current.revision, p.revision + 1); assert.equal(current.deletion?.phase, 'verify');
    await assert.rejects(store.save(p), { code: 'octo_stale_revision' });
    await assert.rejects(store.saveClientState(before), { code: 'octo_stale_revision' });
    const ready = await store.save({ ...current, deletion: { ...current.deletion!, phase: 'purge' } });
    await store.remove(ready); await store.remove(ready);
    assert.equal(await store.get(p.id), undefined); assert.deepEqual(await store.events('abcd'), []);
    assert.equal((await store.clientState(7))?.setup, undefined);
    assert.equal((await store.clientState(7))?.nodeMavenKey, 'retained');
    await store.recordPage({ events: [{ ...page.events[0], id: 'late' }], watermark: { uuid: 'late-page', time: 20 } });
    assert.deepEqual(await store.events('abcd'), []); assert.equal((await store.stream()).cursor?.uuid, 'late-page');
  });
}

test('purge failure rolls back all profile data, events and client setup', async () => {
  const f = fake(); let p = await f.store.save({ ...(await f.store.reserve([input()]))[0], uuid: 'abcd' });
  await f.store.recordPage({ events: [{ id: 'delete', profileId: 'abcd', action: 'profiles.trashed', time: 1 }], watermark: { uuid: 'page', time: 1 } });
  p = (await f.store.get(p.id))!;
  p = await f.store.save({ ...p, deletion: { ...p.deletion!, phase: 'purge' } });
  f.fail({ text: 'DELETE FROM noco.dolphin_profiles' });
  await assert.rejects(f.store.remove(p)); f.fail();
  assert.deepEqual(await f.store.get(p.id), p); assert.equal((await f.store.events('abcd')).length, 1);
  assert.equal(f.common().size, 1);
});
test('read failures and uncertain commits are sanitized and never retried', async () => {
  const f = fake(); f.fail({ text: 'SELECT profile_id', code: 'ECONNRESET' });
  await assert.rejects(f.store.list(), { code: 'postgres_read_unavailable', message: 'postgres_read_unavailable' });
  f.fail({ text: 'COMMIT' }); await assert.rejects(f.store.reserve([input()]), { code: 'commit_uncertain' });
  assert.equal(f.calls.filter(c => c.text === 'COMMIT').length, 1);
});
test('leader uses the supplied separate pool, closes safety transaction before session lock, and destroys lost connection', async () => {
  const main = fake(), lock = fake();
  const store = createOctoPostgresStore(main.pool, 'unicorn_noco_copy_restore', lock.pool);
  const leader = await store.leader(); assert.ok(leader); assert.equal(main.calls.length, 0);
  const rollback = lock.calls.findIndex(c => c.text === 'ROLLBACK'), acquisition = lock.calls.findIndex(c => c.text.includes('pg_try_advisory_lock'));
  assert.ok(rollback >= 0 && acquisition > rollback); assert.equal(lock.releases.length, 0);
  await leader.check(); lock.fail({ text: 'SELECT 1' });
  await assert.rejects(leader.check(), { code: 'octo_leadership_lost' });
  await leader.release(); assert.deepEqual(lock.releases, [true]);
  await assert.rejects(leader.check(), { code: 'octo_leadership_lost' });
});
test('unsuccessful leadership releases normally and successful release unlocks exactly once', async () => {
  const f = fake(); f.held(false); assert.equal(await f.store.leader(), undefined); assert.deepEqual(f.releases, [false]);
  f.held(true); const leader = (await f.store.leader())!; await leader.release(); await leader.release();
  assert.equal(f.calls.filter(c => c.text.includes('pg_advisory_unlock')).length, 1);
});
test('migration limits common inventory to browser and grants private identity sequence', async () => {
  const sql = await readFile(new URL('./sql/001-octo.up.sql', import.meta.url), 'utf8');
  assert.match(sql, /WHERE browser='octo'/); assert.match(sql, /GRANT USAGE,SELECT ON SEQUENCE noco\.octo_event_inbox_seq_seq/);
  assert.doesNotMatch(sql, /UPDATE noco\.dolphin_profiles/);
  const extension = sql.match(/extension := '([^']+)'::jsonb/)![1];
  assert.deepEqual(JSON.parse(extension).columns, [{ name: 'browser', sqlType: 'text' }]);
});
