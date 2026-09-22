import type { SqlPool, CopyDatabase, SqlSession } from '../contracts.mts';
import { createReadSession } from '../read-session.mts';
import { writeTransaction } from '../working-session.mts';
import { automationError, type AutomationStore, type AutomationSettings, type AutomationRun, type AuditEvent, type WorkerHeartbeat } from '../../../features/linkedin-automation/orchestrator/contracts.ts';
import type { Store as WithdrawalStore, State } from '../../../features/linkedin-automation/invitation-withdrawal/contracts.ts';
export function createAutomationSqlStore(pool: SqlPool, database: CopyDatabase) {
  const read = createReadSession(pool, database);
  const write = <T,>(fn: Parameters<typeof writeTransaction<T>>[2]) => writeTransaction(pool, database, fn);
  const row = <T,>(value: unknown): T => {
    if (!value || typeof value !== 'object') throw automationError('automation_storage_invalid');
    return structuredClone(value) as T;
  };
  const append = (s: SqlSession, event: AuditEvent) => s.query(`INSERT INTO linkedin_automation.events(at,account_id,run_key,data)
    VALUES($1,$2,$3,$4::jsonb)`, [event.at,event.account ?? null,event.runKey ?? null,JSON.stringify(event)]);
  const store: AutomationStore = {
    settings: () => read(async s => (await s.query('SELECT data FROM linkedin_automation.settings ORDER BY account_id')).rows.map(r => row<AutomationSettings>(r.data))),
    async saveSettings(value, expectedRevision, event) {
      const saved = await write(async s => {
        const rows = expectedRevision === 0 ? (await s.query(`INSERT INTO linkedin_automation.settings(account_id,revision,data)
          VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING data`, [value.account,value.revision,JSON.stringify(value)])).rows :
          (await s.query(`UPDATE linkedin_automation.settings SET revision=$2,data=$3::jsonb
          WHERE account_id=$1 AND revision=$4 RETURNING data`, [value.account,value.revision,JSON.stringify(value),expectedRevision])).rows;
        if(rows.length && event)await append(s,event);
        return rows;
      });
      if (saved.length !== 1) throw automationError('automation_settings_conflict');
      return row<AutomationSettings>(saved[0].data);
    },
    runs: account => read(async s => (await s.query(`SELECT data FROM linkedin_automation.runs
      ${account === undefined ? '' : 'WHERE account_id=$1'} ORDER BY updated_at DESC`, account === undefined ? [] : [account])).rows.map(r => row<AutomationRun>(r.data))),
    claim: value => write(async s => {
      await s.query(`INSERT INTO linkedin_automation.runs(run_key,account_id,updated_at,data)
        VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`, [value.key,value.account,value.updatedAt,JSON.stringify(value)]);
      return row<AutomationRun>((await s.query('SELECT data FROM linkedin_automation.runs WHERE run_key=$1', [value.key])).rows[0]?.data);
    }),
    async saveRun(value, event) {
      const result = await write(async s => {
        const result = await s.query(`UPDATE linkedin_automation.runs SET updated_at=$2,data=$3::jsonb
          WHERE run_key=$1 AND account_id=$4 RETURNING run_key`, [value.key,value.updatedAt,JSON.stringify(value),value.account]);
        if (result.rows.length && event) await append(s,event);
        return result;
      });
      if (result.rows.length !== 1) throw automationError('automation_run_missing');
    },
    async appendEvent(event) { await write(s => append(s,event)); },
    events: q => read(async s => (await s.query(`SELECT id,data FROM linkedin_automation.events
      WHERE ($1::bigint IS NULL OR account_id=$1) AND ($2::text IS NULL OR run_key=$2)
      AND ($3::bigint IS NULL OR id<$3) ORDER BY id DESC LIMIT $4`,
      [q.account ?? null,q.runKey ?? null,q.before ?? null,Math.max(1,Math.min(q.limit ?? 100,500))])).rows
      .map(r => ({...row<AuditEvent>(r.data),id:Number(r.id)}))),
    async heartbeat(value) {
      if (value) await write(s => s.query(`INSERT INTO linkedin_automation.worker(singleton,data) VALUES(true,$1::jsonb)
        ON CONFLICT(singleton) DO UPDATE SET data=EXCLUDED.data`,[JSON.stringify(value)]));
      return read(async s => { const result = await s.query('SELECT data FROM linkedin_automation.worker WHERE singleton=true');
        return result.rows[0] ? row<WorkerHeartbeat>(result.rows[0].data) : undefined; });
    }
  };
  const withdrawals: WithdrawalStore = {
    load: id => read(async s => {
      const result = await s.query('SELECT data FROM linkedin_automation.withdrawals WHERE account_id=$1', [id]);
      return result.rows[0] ? row<State>(result.rows[0].data) : undefined;
    }),
    async save(id, state) { await write(s => s.query(`INSERT INTO linkedin_automation.withdrawals(account_id,data)
      VALUES($1,$2::jsonb) ON CONFLICT(account_id) DO UPDATE SET data=EXCLUDED.data`, [id,JSON.stringify(state)])); }
  };
  return { store, withdrawals,
    async exists() {
      const result=await read(s=>s.query("SELECT to_regclass('linkedin_automation.schema_version') AS schema_table"));
      return Boolean(result.rows[0]?.schema_table);
    },
    async finishImport() {await write(s=>s.query('UPDATE linkedin_automation.schema_version SET withdrawals_imported=true WHERE singleton=true'));},
    async checkSchema() {
      const result = await read(s => s.query('SELECT version,withdrawals_imported FROM linkedin_automation.schema_version WHERE singleton=true'));
      if (result.rows[0]?.version !== 1) throw automationError('automation_schema_required');
      if (!result.rows[0]?.withdrawals_imported) throw automationError('automation_withdrawal_import_required');
    },
    async importWithdrawal(id: number, state: State) {
      // Existing SQL wins only if doing so cannot discard evidence from the source file.
      const conflict=await write(async s=>{
        await s.query(`INSERT INTO linkedin_automation.withdrawals(account_id,data) VALUES($1,$2::jsonb)
          ON CONFLICT DO NOTHING`, [id,JSON.stringify(state)]);
        const existing=row<State>((await s.query('SELECT data FROM linkedin_automation.withdrawals WHERE account_id=$1 FOR UPDATE',[id])).rows[0].data);
        return existing.accountId!==state.accountId || state.attempted.some(value=>!existing.attempted.includes(value)) ||
          Boolean(state.run && ['running','uncertain','interrupted'].includes(state.run.status) && existing.run?.id!==state.run.id);
      });
      if(conflict)throw automationError('automation_withdrawal_import_conflict');
    }
  };
}
