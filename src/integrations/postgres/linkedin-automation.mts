import type { SqlPool, SqlSession } from './contracts.mts';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import type { Store, Task, Schedule, Event, Cooldown, Feature } from '../../features/linkedin-automation/orchestrator/contracts.ts';
const { fail } = createRequire(import.meta.url)('../../features/linkedin-automation/orchestrator/contracts.ts') as
  typeof import('../../features/linkedin-automation/orchestrator/contracts.ts');
import type { State as WithdrawalState, Store as WithdrawalStore } from '../../features/linkedin-automation/invitation-withdrawal/contracts.ts';

export function createLinkedInAutomationStore(pool: SqlPool): Store & { withdrawals: WithdrawalStore;
  importWithdrawal(id: number, value: WithdrawalState): Promise<void> } {
  async function transaction<T>(write: boolean, action: (sql: SqlSession) => Promise<T>): Promise<T> {
    const sql = await pool.connect(); let broken = false;
    try {
      await sql.query(write ? 'BEGIN READ WRITE' : 'BEGIN READ ONLY');
      const result = await action(sql); await sql.query('COMMIT'); return result;
    } catch (error) { try { await sql.query('ROLLBACK'); } catch { broken = true; } throw error; }
    finally { sql.release(broken); }
  }
  const read = (text: string, values: unknown[] = []) => transaction(false, s => s.query(text, values));
  async function owned(sql: SqlSession, owner: string, epoch: number) {
    const { rows } = await sql.query(`SELECT epoch FROM linkedin_automation.control
      WHERE id=true AND owner=$1 AND epoch=$2 AND lease_until > clock_timestamp() FOR SHARE`, [owner, epoch]);
    if (!rows.length) throw fail('automation_owner_lost', 'Право исполнителя потеряно. Новые отправки запрещены.');
  }
  async function event(sql: SqlSession, value: Event) {
    await sql.query(`INSERT INTO linkedin_automation.events(at,account_id,task_id,state)
      VALUES(to_timestamp($1 / 1000.0),$2,$3,$4::jsonb)`, [value.at, value.accountId ?? null,
      value.taskId ?? null, JSON.stringify(value)]);
  }
  const withdrawals: WithdrawalStore = {
    async load(id) {
      const { rows } = await read('SELECT state FROM linkedin_automation.withdrawals WHERE account_id=$1', [id]);
      return rows[0]?.state as WithdrawalState | undefined;
    },
    async save(id, value) { await transaction(true, async s => {
      await s.query(`INSERT INTO linkedin_automation.withdrawals(account_id,state) VALUES($1,$2::jsonb)
        ON CONFLICT(account_id) DO UPDATE SET state=excluded.state`, [id, JSON.stringify(value)]);
    }); }
  };
  return {
    withdrawals,
    async importWithdrawal(id, value) {
      await transaction(true, async s => {
        await s.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`linkedin-withdrawal-import:${id}`]);
        const { rows } = await s.query('SELECT state FROM linkedin_automation.withdrawals WHERE account_id=$1 FOR UPDATE', [id]);
        if (rows.length && !isDeepStrictEqual(rows[0].state, value))
          throw fail('automation_withdrawal_import_conflict', 'SQL и файловый журнал отзыва различаются. Импорт остановлен.');
        if (!rows.length) await s.query('INSERT INTO linkedin_automation.withdrawals(account_id,state) VALUES($1,$2::jsonb)',
          [id, JSON.stringify(value)]);
      });
    },
    async ready() {
      const result = await read("SELECT to_regclass('linkedin_automation.control') AS table_name");
      if (!result.rows[0]?.table_name) return false;
      const version = await read('SELECT schema_version FROM linkedin_automation.control WHERE id=true');
      if (Number(version.rows[0]?.schema_version) !== 1) throw fail('automation_schema_version', 'Версия схемы оркестратора не поддерживается.');
      return true;
    },
    async snapshot() { return transaction(false, async s => {
      const schedules = await s.query('SELECT state FROM linkedin_automation.schedules ORDER BY account_id');
      // Keep recovery and last publication available without rereading the entire retained history every tick.
      const tasks = await s.query(`SELECT state FROM linkedin_automation.tasks
        WHERE state->>'state' NOT IN ('completed','stopped')
          OR (state->>'state'='stopped' AND state->>'runId' IS NOT NULL AND COALESCE(state->>'stopApplied','false')<>'true')
          OR (state->>'updatedAt')::numeric >= extract(epoch FROM clock_timestamp()-interval '7 days')*1000
          OR id IN (SELECT DISTINCT ON (account_key) id FROM linkedin_automation.tasks
            WHERE state->>'publishedAt' IS NOT NULL ORDER BY account_key,(state->>'publishedAt')::numeric DESC)
        ORDER BY id`);
      const owner = (await s.query('SELECT owner,epoch,extract(epoch FROM lease_until)*1000 AS until FROM linkedin_automation.control WHERE id=true')).rows[0];
      return { schedules: schedules.rows.map(r => r.state as Schedule), tasks: tasks.rows.map(r => r.state as Task),
        owner: owner?.owner ? { id: String(owner.owner), epoch: Number(owner.epoch), until: Number(owner.until) } : undefined };
    }); },
    async schedule(value, expectedVersion) { return transaction(true, async s => {
      await s.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`linkedin-schedule:${value.account.id}`]);
      const current = (await s.query('SELECT version FROM linkedin_automation.schedules WHERE account_id=$1 FOR UPDATE', [value.account.id])).rows[0];
      if (Number(current?.version ?? 0) !== expectedVersion) throw fail('automation_version_conflict', 'Расписание уже изменилось. Обновите страницу.');
      const next = { ...value, version: expectedVersion + 1 };
      await s.query(`INSERT INTO linkedin_automation.schedules(account_id,account_key,version,state) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT(account_id) DO UPDATE SET account_key=excluded.account_key,version=excluded.version,state=excluded.state`,
      [value.account.id, value.account.key, next.version, JSON.stringify(next)]);
      await event(s, { at: value.updatedAt, accountId: value.account.id, studentId: value.account.studentId,
        source: 'наш код', code: 'schedule_saved', message: value.enabled ? 'Расписание сохранено.' : 'Автоматизация выключена.' });
      return next;
    }); },
    async create(tasks) { await transaction(true, async s => { for (const t of tasks) {
      const inserted = await s.query(`INSERT INTO linkedin_automation.tasks(id,account_key,feature,version,state)
        VALUES($1,$2,$3,0,$4::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id`, [t.id,t.account.key,t.feature,JSON.stringify(t)]);
      if (inserted.rows.length) await event(s, { at: t.createdAt, taskId: t.id, accountId: t.account.id,
        studentId: t.account.studentId, feature: t.feature, source: 'наш код', code: 'planned',
        message: 'Время запуска выбрано и сохранено.', nextAt: t.nextAt });
    } }); },
    async save(task, entry, owner, epoch) { return transaction(true, async s => {
      await owned(s, owner, epoch);
      const next = { ...task, version: task.version + 1 };
      const updated = await s.query(`UPDATE linkedin_automation.tasks SET version=$2,state=$3::jsonb
        WHERE id=$1 AND version=$4 RETURNING id`, [task.id,next.version,JSON.stringify(next),task.version]);
      if (!updated.rows.length) throw fail('automation_version_conflict');
      await event(s, entry); return next;
    }); },
    async history(account, after = 0, limit = 200, filter = {}) {
      const result = await read(`SELECT id,state FROM linkedin_automation.events
        WHERE ($1::bigint IS NULL OR account_id=$1) AND id>$2
          AND ($4::bigint IS NULL OR id<$4)
          AND ($5::text IS NULL OR state->>'source'=$5)
          AND ($6::text IS NULL OR state->>'feature'=$6)
          AND (NOT $7::boolean OR COALESCE((state->>'httpStatus')::int,0)>=400
            OR state->>'code' ~ 'error|failed|blocked|lost|uncertain|needs_attention|unavailable|timeout|invalid|conflict|identity_mismatch|automation_likes_expired|comments_post_not_published|comments_not_started|post_account_not_ready|unipile_action_skipped|comments_post_skipped')
          AND ($8::double precision IS NULL OR at>=to_timestamp($8/1000.0))
          AND ($9::double precision IS NULL OR at<to_timestamp($9/1000.0))
        ORDER BY id ${filter.latest ? 'DESC' : 'ASC'} LIMIT $3`, [account ?? null,after,Math.min(1000,limit),
          filter.before ?? null,filter.source ?? null,filter.feature ?? null,filter.errorsOnly ?? false,filter.from ?? null,filter.to ?? null]);
      return result.rows.map(r => ({ ...(r.state as Event), id: Number(r.id) }));
    },
    async durations(feature: Feature, account) {
      const result = await read(`SELECT state->>'activeMs' AS duration FROM linkedin_automation.tasks
        WHERE feature=$1 AND account_key=$2 AND state->>'state'='completed'
        ORDER BY (state->>'updatedAt')::numeric DESC LIMIT 20`, [feature, account]);
      return result.rows.map(r => Number(r.duration));
    },
    async claim(owner, _now) { return transaction(true, async s => {
      const { rows } = await s.query(`UPDATE linkedin_automation.control SET owner=$1,
        epoch=CASE WHEN owner=$1 THEN epoch ELSE epoch+1 END,
        lease_until=clock_timestamp()+interval '45 seconds',heartbeat_at=clock_timestamp()
        WHERE id=true AND (owner=$1 OR owner IS NULL OR lease_until < clock_timestamp()-interval '70 seconds') RETURNING epoch`, [owner]);
      return rows.length ? Number(rows[0].epoch) : undefined;
    }); },
    owned: (owner, epoch, _now) => transaction(true, s => owned(s, owner, epoch)),
    async release(owner, epoch) { await transaction(true, async s => {
      await s.query(`UPDATE linkedin_automation.control SET owner=NULL,lease_until=NULL
        WHERE id=true AND owner=$1 AND epoch=$2`, [owner,epoch]);
    }); },
    async cooldown(value: Cooldown) { await transaction(true, async s => {
      await s.query(`INSERT INTO linkedin_automation.cooldowns(account_key,method,until_at,state)
        VALUES($1,$2,to_timestamp($3/1000.0),$4::jsonb) ON CONFLICT(account_key,method) DO UPDATE
        SET until_at=GREATEST(linkedin_automation.cooldowns.until_at,excluded.until_at),
        state=CASE WHEN excluded.until_at>linkedin_automation.cooldowns.until_at THEN excluded.state ELSE linkedin_automation.cooldowns.state END`,
      [value.account,value.method,value.until,JSON.stringify(value)]);
    }); },
    async cooldowns() {
      const { rows } = await read('SELECT state FROM linkedin_automation.cooldowns WHERE until_at > clock_timestamp()');
      return rows.map(row => row.state as Cooldown);
    },
    async blockedUntil(account, method, now) {
      const { rows } = await read(`SELECT extract(epoch FROM max(until_at))*1000 AS until
        FROM linkedin_automation.cooldowns WHERE account_key IN ($1,'*') AND
          (method=$2 OR ($2<>'action' AND method='*')) AND until_at>to_timestamp($3/1000.0)`, [account,method,now]);
      return Number(rows[0]?.until ?? 0);
    },
    event: value => transaction(true, s => event(s, value)),
    async pruneLogs(before) { await transaction(true, async s => {
      await s.query('DELETE FROM linkedin_automation.events WHERE at<to_timestamp($1/1000.0)', [before]);
    }); }
  };
}
