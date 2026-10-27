import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { studentLocked, taskRow } from './contracts.mts';
export async function readStudentTask(s: SqlSession, clientId: number) {
  const row = (await s.query("SELECT * FROM noco.linkedin_creation_task WHERE client_id=$1 AND source='student_intake'", [clientId])).rows[0];
  return row ? taskRow(row) : undefined;
}
export async function readAccountTask(s:SqlSession,clientId:number,accountId:number) {
  const student=await readStudentTask(s,clientId);
  if(student?.linkedinAccountId===accountId)return student;
  const row=(await s.query(`SELECT * FROM noco.linkedin_creation_task
    WHERE client_id=$1 AND linkedin_account_id=$2 ORDER BY id DESC LIMIT 1`,[clientId,accountId])).rows[0];
  return row?taskRow(row):undefined;
}
export async function assertStudentEditable(s: SqlSession, clientId: number, accountId?: number) {
  const rows = (await s.query(`SELECT status FROM noco.linkedin_creation_task WHERE client_id=$1
    AND ($2::bigint IS NULL OR linkedin_account_id=$2 OR outlook_account_id=$2)`, [clientId, accountId ?? null])).rows;
  if (rows.some(row => studentLocked(row.status))) throw new PostgresReadError('linkedin_task_student_edit_locked');
}
export async function studentEditLocked(s: SqlSession, clientId: number) {
  return (await s.query('SELECT status FROM noco.linkedin_creation_task WHERE client_id=$1', [clientId])).rows.some(row => studentLocked(row.status));
}
export async function studentAccountAccess(s: SqlSession, clientId: number, accountId?: number) {
  if (!accountId) return {editLocked:false,completionConfirmed:false,registrationPending:false};
  const rows=(await s.query(`SELECT status FROM noco.linkedin_creation_task WHERE client_id=$1
    AND (linkedin_account_id=$2 OR outlook_account_id=$2)`,[clientId,accountId])).rows;
  const registrationPending=rows.some(row=>row.status!=='выполнение подтверждено');
  return {editLocked:rows.some(row=>studentLocked(row.status)),registrationPending,
    completionConfirmed:rows.length>0&&!registrationPending};
}
export async function saveStudentTask(s: SqlSession, clientId: number, linkedinId: number, outlookId: number, changed: boolean, currentTaskId?:number) {
  if(currentTaskId){
    const row=(await s.query(`UPDATE noco.linkedin_creation_task SET
      proxy_profile_id=CASE WHEN $5 THEN NULL ELSE proxy_profile_id END,
      proxy_uuid=CASE WHEN $5 THEN NULL ELSE proxy_uuid END,
      proxy_saved_at=CASE WHEN $5 THEN NULL ELSE proxy_saved_at END
      WHERE id=$1 AND client_id=$2 AND linkedin_account_id=$3 AND outlook_account_id=$4
      RETURNING *, false AS created`,[currentTaskId,clientId,linkedinId,outlookId,changed])).rows[0];
    if(!row)throw new PostgresReadError('linkedin_task_account_binding_invalid');
    return {...taskRow(row),created:false};
  }
  const row = (await s.query(`INSERT INTO noco.linkedin_creation_task(client_id,linkedin_account_id,outlook_account_id,source)
    VALUES($1,$2,$3,'student_intake') ON CONFLICT(client_id) WHERE source='student_intake'
    DO UPDATE SET linkedin_account_id=EXCLUDED.linkedin_account_id,outlook_account_id=EXCLUDED.outlook_account_id,
      proxy_profile_id=CASE WHEN $4 THEN NULL ELSE linkedin_creation_task.proxy_profile_id END,
      proxy_uuid=CASE WHEN $4 THEN NULL ELSE linkedin_creation_task.proxy_uuid END,
      proxy_saved_at=CASE WHEN $4 THEN NULL ELSE linkedin_creation_task.proxy_saved_at END
    RETURNING *, (xmax=0) AS created`, [clientId, linkedinId, outlookId, changed])).rows[0];
  return { ...taskRow(row), created: row.created === true };
}
