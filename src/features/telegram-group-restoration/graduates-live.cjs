const path=require('node:path');
const {FOLDER,read,save,openDb}=require('./live.cjs');
const {excludeGraduate,markSkipped}=require('./graduates.cjs');
async function prepareGraduates(plans){const db=await openDb();try{
 const rows=(await db.query('SELECT id,client_status FROM noco.clients WHERE id=ANY($1::bigint[])',[plans.map(p=>p.clientId)])).rows;
 const statuses=new Map(rows.map(r=>[String(r.id),r.client_status]));
 for(const p of plans){if(p.clientId==='92')continue;const file=path.join(FOLDER,'client-'+p.clientId+'.json'),s=read(file)||{version:2,clientId:p.clientId,sourceChatId:p.sourceChatId,planHash:p.planHash};
  if(markSkipped(s,statuses.get(p.clientId)))save(file,s);
  else if(s.skipped&&!s.channel&&!excludeGraduate(p.clientId,statuses.get(p.clientId))){delete s.skipped;delete s.skipReason;delete s.skippedAt;delete s.checkedStatus;save(file,s);}
 }
 }finally{await db.end();}}
async function checkCreation(id){const db=await openDb();try{const r=(await db.query('SELECT client_status FROM noco.clients WHERE id=$1',[id])).rows[0];if(!r)throw Error('client_missing_before_create');if(excludeGraduate(id,r.client_status))throw Object.assign(Error('excluded_graduate'),{code:'excluded_graduate'});}finally{await db.end();}}
module.exports={prepareGraduates,checkCreation};
