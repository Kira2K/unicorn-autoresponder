import { PostgresReadError } from '../../integrations/postgres/contracts.mts';
import type { CopyDatabase, SqlPool, SqlSession } from '../../integrations/postgres/contracts.mts';
import { assertCopyDatabase, createReadSession } from '../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../integrations/postgres/working-session.mts';
import { createWorkingCatalog } from '../../integrations/postgres/working-catalog.mts';
import { workingCrud } from '../../integrations/postgres/working-crud.mts';
import type { ManagedProfile, NewProfile, OctoStore, StoredEvent, StreamState } from './contracts.mts';
import type { ActionPage } from '../octo-access-test/action-log.mts';
import { clientState, claimClientPassword, saveClientState } from './postgres-clients.mts';
import { initialDeletion, isDeletionEvent, setupUsesProfile } from './deletion-state.mts';

const PROFILE_TABLE = 'm4thvbutfyb15qz';
// Session lock differs from the per-client transaction locks used by reservation.
const LEADER_KEY = '730643996001';
const normalize = (uuid: string) => uuid.replaceAll('-', '').toLowerCase();
function integer(value: unknown, zero = false): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1)) throw new PostgresReadError('octo_invalid_state');
  return n;
}
function profile(row: Record<string, unknown>): ManagedProfile {
  const state = row.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new PostgresReadError('octo_invalid_state');
  return { ...structuredClone(state as ManagedProfile), id: integer(row.profile_id), revision: integer(row.revision) };
}
async function passwordConflict<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    const e = error as { code?: unknown; constraint?: unknown };
    // Inspect only the known constraint name; never expose SQL or provider values.
    if (e?.code === '23505' && e.constraint === 'octo_profiles_password_unique')
      throw new PostgresReadError('octo_password_conflict');
    throw error;
  }
}
function validateNew(input: NewProfile) {
  integer(input.clientId);
  if (!['ru', 'en'].includes(input.locale) || typeof input.password !== 'string' || !/^\d{5}$/.test(input.password))
    throw new PostgresReadError('octo_invalid_state');
}
export function createOctoPostgresStore(pool: SqlPool, database: CopyDatabase, lockPool: SqlPool = pool): OctoStore {
  const read = createReadSession(pool, database);
  const write = <T,>(operation: (s: SqlSession) => Promise<T>) => writeTransaction(pool, database, operation);
  return {
    async checkSchema() {
      await read(async s => {
        const result = await s.query(`SELECT
          to_regclass('noco.octo_profiles') IS NOT NULL AND
          to_regclass('noco.octo_clients') IS NOT NULL AND
          has_table_privilege(current_user,to_regclass('noco.octo_clients'),'SELECT') AND
          has_table_privilege(current_user,to_regclass('noco.octo_clients'),'INSERT') AND
          has_table_privilege(current_user,to_regclass('noco.octo_clients'),'UPDATE') AND
          to_regclass('noco.octo_event_inbox') IS NOT NULL AND
          to_regclass('noco.octo_stream') IS NOT NULL AND
          has_table_privilege(current_user,to_regclass('noco.octo_profiles'),'DELETE') AND
          has_table_privilege(current_user,to_regclass('noco.octo_event_inbox'),'DELETE') AND
          has_table_privilege(current_user,to_regclass('noco.dolphin_profiles'),'DELETE') AND
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='noco'
            AND table_name='dolphin_profiles' AND column_name='browser' AND data_type='text'
            AND is_nullable='NO' AND column_default='''dolphin''::text') AND
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='noco'
            AND table_name='dolphin_profiles' AND column_name='octo_profile_id' AND data_type='text') AND
          (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='noco' AND i.indisvalid AND i.indisunique
            AND c.relname IN ('octo_clients_password_unique','octo_clients_client_password_unique',
              'octo_profiles_proxy_unique','octo_profiles_uuid_unique',
              'octo_common_client_locale_unique','octo_common_uuid_unique'))=6 AND
          to_regclass('noco.octo_profiles_password_unique') IS NULL AND
          EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('noco.octo_profiles')
            AND conname='octo_profiles_client_password_fk' AND contype='f' AND convalidated
            AND confrelid=to_regclass('noco.octo_clients')) AND
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='noco'
            AND table_name='octo_profiles' AND column_name='password' AND data_type='text'
            AND is_generated='ALWAYS' AND is_nullable='NO') AND
          (SELECT count(*) FROM information_schema.columns WHERE table_schema='noco' AND table_name='octo_clients'
            AND is_nullable='NO' AND ((column_name IN ('client_id','revision') AND data_type='bigint')
            OR (column_name='password' AND data_type='text') OR (column_name='state' AND data_type='jsonb')))=4 AND
          (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('noco.octo_clients') AND convalidated
            AND conname IN ('octo_clients_pkey','octo_clients_client_id_fkey','octo_clients_password_check',
              'octo_clients_revision_check','octo_clients_state_check'))=5 AND
          EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('noco.octo_profiles')
            AND conname='octo_profiles_client_locale_unique' AND contype='u') AND
          EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('noco.octo_event_inbox')
            AND contype='u')
          AS ready`);
        if (result.rows[0]?.ready !== true) throw new PostgresReadError('octo_schema_required');
        const catalog = createWorkingCatalog((await s.query(
          "SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
        if (!catalog.get(PROFILE_TABLE).columns.some(c => c.dataKey === 'browser' && c.sqlName === 'browser'))
          throw new PostgresReadError('octo_schema_required');
        // These bounded reads also verify grants and the actual column names/types.
        await s.query('SELECT profile_id, client_id, locale, revision, state FROM noco.octo_profiles LIMIT 0');
        await s.query('SELECT client_id,password,revision,state FROM noco.octo_clients LIMIT 0');
        await s.query('SELECT seq, event_id, object_uuid, action, event_time, title FROM noco.octo_event_inbox LIMIT 0');
        const stream = await s.query('SELECT cursor, coverage_since FROM noco.octo_stream WHERE singleton=true');
        if (stream.rows.length !== 1) throw new PostgresReadError('octo_schema_required');
      });
    },
    async clientState(id) {
      integer(id);
      return read(async s => {
        const row = (await s.query('SELECT client_id,password,revision,state FROM noco.octo_clients WHERE client_id=$1', [id])).rows[0];
        return row && clientState(row);
      });
    },
    async clientStates() {
      return read(async s => (await s.query('SELECT client_id,password,revision,state FROM noco.octo_clients ORDER BY client_id')).rows.map(clientState));
    },
    async claimClientPassword(id, candidate) { return write(s => claimClientPassword(s, id, candidate)); },
    async saveClientState(input) { return write(s => saveClientState(s, input)); },
    async list(clientId) {
      if (clientId !== undefined) integer(clientId);
      return read(async s => (await s.query(`SELECT profile_id, revision, state FROM noco.octo_profiles
        ${clientId === undefined ? '' : 'WHERE client_id=$1'} ORDER BY profile_id`, clientId === undefined ? [] : [clientId])).rows.map(profile));
    },
    async get(id) {
      integer(id);
      return read(async s => {
        const row = (await s.query('SELECT profile_id, revision, state FROM noco.octo_profiles WHERE profile_id=$1', [id])).rows[0];
        return row && profile(row);
      });
    },
    async reserve(inputs) {
      if (!inputs.length) return [];
      inputs.forEach(validateNew);
      if (inputs.some(p => p.clientId !== inputs[0].clientId) || new Set(inputs.map(p => p.locale)).size !== inputs.length)
        throw new PostgresReadError('octo_invalid_state');
      return write(async s => {
        const client = await claimClientPassword(s, inputs[0].clientId, inputs[0].password);
        const catalog = createWorkingCatalog((await s.query(
          "SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
        const crud = workingCrud(s, catalog), result: ManagedProfile[] = [];
        for (const input of inputs) {
          const existing = (await s.query(`SELECT profile_id, revision, state FROM noco.octo_profiles
            WHERE client_id=$1 AND locale=$2`, [input.clientId, input.locale])).rows[0];
          if (existing) { result.push(profile(existing)); continue; }
          const common = await crud.createRecord(PROFILE_TABLE, {
            clients_id: input.clientId, locale: input.locale === 'ru' ? 'Ru' : 'En', browser: 'octo'
          });
          const id = integer(common.key[0]), state: ManagedProfile = { ...structuredClone(input), password: client.password, id, revision: 1 };
          await passwordConflict(() => s.query(`INSERT INTO noco.octo_profiles
            (profile_id, client_id, locale, revision, state) VALUES ($1,$2,$3,1,$4::jsonb)`,
          [id, input.clientId, input.locale, JSON.stringify(state)]));
          result.push(state);
        }
        return result;
      });
    },
    async save(input) {
      validateNew(input); integer(input.id); integer(input.revision);
      const next = { ...structuredClone(input), revision: input.revision + 1 };
      return write(async s => {
        const result = await passwordConflict(() => s.query(`UPDATE noco.octo_profiles SET revision=revision+1, state=$5::jsonb
          WHERE profile_id=$1 AND revision=$2 AND client_id=$3 AND locale=$4 RETURNING profile_id`,
        [input.id, input.revision, input.clientId, input.locale, JSON.stringify(next)]));
        if (result.rows.length !== 1) throw new PostgresReadError('octo_stale_revision');
        const common = await s.query(`UPDATE noco.dolphin_profiles SET octo_profile_id=$2
          WHERE id=$1 AND browser='octo' RETURNING id`, [input.id, input.uuid ?? null]);
        if (common.rows.length !== 1) throw new PostgresReadError('octo_binding_missing');
        return next;
      });
    },
    async events(uuid, after = 0) {
      integer(after, true);
      return read(async s => (await s.query(`SELECT seq, event_id, object_uuid, action, event_time, title
        FROM noco.octo_event_inbox WHERE object_uuid=$1 AND seq>$2 ORDER BY seq`, [normalize(uuid), after])).rows.map(row => ({
          seq: integer(row.seq), id: String(row.event_id), profileId: String(row.object_uuid), action: String(row.action),
          time: Number(row.event_time), ...(row.title == null ? {} : { title: String(row.title) })
        } as StoredEvent)));
    },
    async remove(input) {
      integer(input.id); integer(input.revision); integer(input.clientId);
      if (!input.uuid || input.deletion?.phase !== 'purge') throw new PostgresReadError('octo_invalid_state');
      return write(async s => {
        // Same order as event ingestion: stream -> client -> profile. No cloud calls inside.
        await s.query('SELECT singleton FROM noco.octo_stream WHERE singleton=true FOR UPDATE');
        await s.query('SELECT pg_advisory_xact_lock(730644, $1::integer)', [input.clientId]);
        const client = (await s.query('SELECT client_id,password,revision,state FROM noco.octo_clients WHERE client_id=$1 FOR UPDATE', [input.clientId])).rows[0];
        const existing = (await s.query('SELECT profile_id,revision,state FROM noco.octo_profiles WHERE profile_id=$1 FOR UPDATE', [input.id])).rows[0];
        if (!existing) return;
        const current = profile(existing);
        if (current.revision !== input.revision || current.clientId !== input.clientId || normalize(current.uuid ?? '') !== normalize(input.uuid!) ||
            current.deletion?.phase !== 'purge') throw new PostgresReadError('octo_stale_revision');
        if (client) {
          const state = clientState(client);
          if (setupUsesProfile(state.setup, current)) { delete state.setup; await saveClientState(s, state); }
        }
        await s.query('DELETE FROM noco.octo_event_inbox WHERE object_uuid=$1', [normalize(input.uuid!)]);
        await s.query('DELETE FROM noco.octo_profiles WHERE profile_id=$1', [input.id]);
        const deleted = await s.query(`DELETE FROM noco.dolphin_profiles
          WHERE id=$1 AND browser='octo' AND "02_clients_id"=$2
            AND lower(replace(octo_profile_id,'-',''))=$3 RETURNING id`, [input.id, input.clientId, normalize(input.uuid!)]);
        if (deleted.rows.length !== 1) throw new PostgresReadError('octo_binding_missing');
      });
    },
    async stream() {
      return read(async s => {
        const rows = (await s.query('SELECT cursor, coverage_since FROM noco.octo_stream WHERE singleton=true')).rows;
        if (rows.length !== 1) throw new PostgresReadError('octo_schema_required');
        return { ...(rows[0].cursor == null ? {} : { cursor: structuredClone(rows[0].cursor) }),
          coverageSince: Number(rows[0].coverage_since) } as StreamState;
      });
    },
    async recordPage(page: ActionPage) {
      if (!page.watermark?.uuid || !Number.isFinite(page.watermark.time)) throw new PostgresReadError('octo_invalid_page');
      return write(async s => {
        // Serialize whole pages so seq reflects the ingestion order, including concurrent callbacks.
        const locked = await s.query('SELECT singleton FROM noco.octo_stream WHERE singleton=true FOR UPDATE');
        if (locked.rows.length !== 1) throw new PostgresReadError('octo_schema_required');
        for (const event of page.events) {
          if (!event.id || !event.profileId || !Number.isFinite(event.time)) throw new PostgresReadError('octo_invalid_page');
          const inserted = await s.query(`INSERT INTO noco.octo_event_inbox (event_id,object_uuid,action,event_time,title)
            SELECT $1,$2,$3,$4,$5 WHERE EXISTS
              (SELECT 1 FROM noco.octo_profiles WHERE lower(replace(state->>'uuid','-',''))=$2)
            ON CONFLICT (event_id) DO NOTHING RETURNING seq`,
          [event.id, normalize(event.profileId), event.action, event.time, (event as StoredEvent).title ?? null]);
          if (inserted.rows.length && isDeletionEvent(event.action)) {
            const row = (await s.query(`SELECT profile_id,revision,state FROM noco.octo_profiles
              WHERE lower(replace(state->>'uuid','-',''))=$1`, [normalize(event.profileId)])).rows[0];
            if (!row) continue;
            const candidate = profile(row);
            await s.query('SELECT pg_advisory_xact_lock(730644, $1::integer)', [candidate.clientId]);
            const client = (await s.query('SELECT client_id,password,revision,state FROM noco.octo_clients WHERE client_id=$1 FOR UPDATE', [candidate.clientId])).rows[0];
            const current = profile((await s.query('SELECT profile_id,revision,state FROM noco.octo_profiles WHERE profile_id=$1 FOR UPDATE', [candidate.id])).rows[0]);
            if (current.deletion) continue;
            const next = { ...current, revision: current.revision + 1, deletion: initialDeletion(event.id) };
            await s.query(`UPDATE noco.octo_profiles SET revision=revision+1,state=$5::jsonb
              WHERE profile_id=$1 AND revision=$2 AND client_id=$3 AND locale=$4`,
            [current.id, current.revision, current.clientId, current.locale, JSON.stringify(next)]);
            // Invalidate any in-flight onboarding save that still contains this profile's secrets.
            if (client && setupUsesProfile(clientState(client).setup, current)) await saveClientState(s, clientState(client));
          }
        }
        await s.query('UPDATE noco.octo_stream SET cursor=$1::jsonb WHERE singleton=true', [JSON.stringify(page.watermark)]);
      });
    },
    async setCoverage(since) {
      if (!Number.isFinite(since) || since < 0) throw new PostgresReadError('octo_invalid_coverage');
      return write(async s => {
        const result = await s.query(`UPDATE noco.octo_stream SET coverage_since=GREATEST(coverage_since,$1)
          WHERE singleton=true RETURNING singleton`, [since]);
        if (result.rows.length !== 1) throw new PostgresReadError('octo_schema_required');
      });
    },
    async leader() {
      let s: SqlSession | undefined, held = false, ended = false;
      const dispose = (broken: boolean) => { if (!ended) { ended = true; s?.release(broken); } };
      try {
        s = await lockPool.connect();
        await s.query('BEGIN READ ONLY'); await assertCopyDatabase(s, database); await s.query('ROLLBACK');
        held = (await s.query('SELECT pg_try_advisory_lock($1::bigint) AS held', [LEADER_KEY])).rows[0]?.held === true;
        if (!held) { dispose(false); return undefined; }
        const connection = s;
        return {
          async check() {
            if (ended) throw new PostgresReadError('octo_leadership_lost');
            try { await connection.query('SELECT 1'); }
            catch { dispose(true); throw new PostgresReadError('octo_leadership_lost'); }
          },
          async release() {
            if (ended) return;
            try { await connection.query('SELECT pg_advisory_unlock($1::bigint)', [LEADER_KEY]); dispose(false); }
            catch { dispose(true); throw new PostgresReadError('octo_leadership_lost'); }
          }
        };
      } catch (error) {
        if (s && !held) { try { await s.query('ROLLBACK'); } catch {} }
        dispose(true);
        if (error instanceof PostgresReadError) throw error;
        throw new PostgresReadError('octo_leader_unavailable');
      }
    }
  };
}
