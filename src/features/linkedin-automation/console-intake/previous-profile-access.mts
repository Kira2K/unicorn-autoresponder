import type {SqlSession} from '../../../integrations/postgres/contracts.mts';
import type {CreationTask} from '../creation-tasks/contracts.mts';

/** Registration history determines access; the current expert draft is not a previous account. */
export async function previousProfileAccess(sql:Pick<SqlSession,'query'>,clientId:number,
  task?:Pick<CreationTask,'id'|'linkedinAccountId'|'createdAt'>) {
  const empty={hadLinkedInBeforeTask:false,previousOctoProfileIds:[] as number[]};
  if(!task)return empty;
  const prior=(await sql.query(`SELECT EXISTS(
    SELECT 1 FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id
    WHERE a.clients_id=$1 AND (a.id<>$2 OR a.updated_at<$4::timestamptz) AND lower(p.name)='linkedin'
      AND (coalesce(btrim(a.url),'')<>'' OR coalesce(btrim(a.login),'')<>'' OR coalesce(a.password,'')<>'')
  ) OR EXISTS(
    SELECT 1 FROM noco.linkedin_creation_task WHERE client_id=$1 AND id<>$3
      AND status='выполнение подтверждено' AND created_at<$4::timestamptz
  ) AS had_linkedin`,[clientId,task.linkedinAccountId,task.id,task.createdAt])).rows[0];
  if(prior?.had_linkedin!==true)return empty;
  const profiles=(await sql.query(`SELECT profile_id FROM noco.octo_profiles WHERE client_id=$1
    AND (state->>'createdAt')::numeric<=$2 AND state->'deletion' IS NULL ORDER BY profile_id`,
    [clientId,Date.parse(task.createdAt)])).rows;
  return {hadLinkedInBeforeTask:true,previousOctoProfileIds:profiles.map(p=>Number(p.profile_id))};
}
