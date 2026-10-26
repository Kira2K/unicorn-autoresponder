import type {SqlSession} from '../../postgres/contracts.mts';
import type {Client} from './types.mts';
import type {TestConfig} from './test-config.mts';
import {MARKET_OPTIONS} from './policy.mts';

/** One SELECT produces an isolated client snapshot; test roles never update noco.clients. */
export async function readTestClient(db:Pick<SqlSession,'query'>,config:TestConfig,chatId:string):Promise<Client>{
  const rows=(await db.query(`SELECT c.id,c.client_name,c.client_status,c.market_id,
    s.name AS stack_name FROM noco.clients c
    LEFT JOIN noco.stacks s ON s.id=c."01_stacks_id" AND NOT COALESCE(s.__nc_deleted,false)
    WHERE c.id=$1 AND NOT COALESCE(c.__nc_deleted,false)`,[config.clientId])).rows;
  if(rows.length!==1)throw new Error('mentor_test_client_not_found');
  const r=rows[0],str=(v:unknown)=>String(v??'').trim();
  if(str(r.id)!==config.clientId)throw new Error('mentor_test_client_mismatch');
  return {id:config.clientId,name:str(r.client_name),username:'@'+config.studentUsername,chatId,
    status:str(r.client_status),market:(Object.keys(MARKET_OPTIONS) as (keyof typeof MARKET_OPTIONS)[])
      .find(key=>MARKET_OPTIONS[key].id===Number(r.market_id))??null,stack:str(r.stack_name),
    hardMentor:config.hardMentorUsername?'@'+config.hardMentorUsername:'',
    softMentor:config.softMentorUsername?'@'+config.softMentorUsername:''};
}
