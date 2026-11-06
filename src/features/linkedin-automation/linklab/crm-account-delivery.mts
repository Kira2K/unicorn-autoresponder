import {randomUUID} from 'node:crypto';
import {writeTransaction} from '../../../integrations/postgres/working-session.mts';
import type {CopyDatabase, SqlPool} from '../../../integrations/postgres/contracts.mts';
import {sendAccountCommand} from './crm-account-command.mts';

/** One leased intent per pass. HTTP is outside SQL; retries retain the exact saved bytes. */
export function createAccountDeliveryWorker(deps: {
  pool: SqlPool; database: CopyDatabase; config: {baseUrl:string;secret:string};
  fetch?: typeof globalThis.fetch; report?(event:{feature:string;state:string;code?:string}):void;
}) {
  const sql = <T>(fn:Parameters<typeof writeTransaction<T>>[2]) => writeTransaction(deps.pool,deps.database,fn);
  let timer:ReturnType<typeof setTimeout>|undefined, running:Promise<void>|undefined, stopped=true;
  async function deliver() {
    const lease=randomUUID();
    const row=await sql(async s=>(await s.query('SELECT * FROM noco.crm_claim_account_delivery($1::uuid)',[lease])).rows[0]);
    if(!row)return;
    let result='retry',code:string|null=null;
    try {
      const current=await sql(async s=>(await s.query('SELECT noco.crm_account_delivery_current($1::uuid,$2::uuid) AS current',[row.event_id,lease])).rows[0]?.current);
      if(!current){result='superseded';code='crm_account_command_superseded';}
      else {
        await sendAccountCommand({body:Buffer.from(String(row.body),'utf8'),expectedStudentId:String(row.student_id)}, {...deps.config,fetch:deps.fetch});
        result='sent';
      }
    } catch(error) {
      const message=error instanceof Error?error.message:'';
      code=/^crm_account_command_[a-z0-9_]{1,70}$/.test(message)?message:'crm_account_command_unconfirmed';
      // 408/429/5xx/invalid or lost receipt may be transient. Never mint a new event.
      if(/^crm_account_command_http_4\d\d$/.test(code)&&!/_http_(408|429)$/.test(code))result='review';
    }
    const saved=await sql(async s=>(await s.query('SELECT noco.crm_finish_account_delivery($1::uuid,$2::uuid,$3,$4) AS saved',[row.event_id,lease,result,code])).rows[0]?.saved);
    if(!saved)throw Error('crm_account_command_ack_or_lease_unconfirmed');
    deps.report?.({feature:'crm_account_delivery',state:result,...(code?{code}:{})});
  }
  function pass():Promise<void> {
    if(running)return running;
    running=deliver().finally(()=>{running=undefined;});return running;
  }
  async function loop(){
    try{await pass();}catch{deps.report?.({feature:'crm_account_delivery',state:'retry',code:'crm_account_command_worker_unavailable'});}
    if(!stopped){timer=setTimeout(loop,15_000);timer.unref();}
  }
  return {
    checkSchema:()=>sql(async s=>{await s.query("SELECT 'noco.crm_claim_account_delivery(uuid)'::regprocedure,'noco.crm_finish_account_delivery(uuid,uuid,text,text)'::regprocedure");}),
    pass,
    start:async()=>{if(!stopped)return;stopped=false;await loop();},
    stop:async()=>{stopped=true;if(timer)clearTimeout(timer);await running?.catch(()=>{});},
  };
}
