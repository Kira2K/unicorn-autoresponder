const path=require('node:path');
const {FOLDER,openCreator,read,save,report}=require('./live.cjs');
async function recover(){
 const lock=read(path.join(FOLDER,'batch.lock'));
 if(lock){try{process.kill(lock.pid,0);throw Error('batch_still_running');}catch(e){if(e.code!=='ESRCH')throw e;}}
 const key=read(path.join(FOLDER,'settings.json'))?.creatorKey||'unicorn',identity=require('./live.cjs').creatorIdentity(key),c=openCreator(key);
 try{
  await c.connect();if(String((await c.getMe()).id)!==identity.id)throw Error('creator_mismatch');
  const dialogs=[];for await(const d of c.iterDialogs({}))dialogs.push(d);
  const actions=[];
  for(const p of read(path.join(FOLDER,'plans.json'))){
   const file=path.join(FOLDER,'client-'+p.clientId+'.json'),s=read(file);
   if(!s||s.channel||!s.steps?.create?.intentAt)continue;
   const intent=s.steps.create.intentAt;
   const matches=dialogs.filter(d=>d.entity.className==='Channel'&&d.entity.creator&&d.entity.megagroup&&d.title===p.title&&d.entity.date*1000>=intent-10000);
   if(matches.length>1)throw Error('creation_outcome_unresolved');
   if(matches.length){const e=matches[0].entity;s.channel={id:String(e.id),accessHash:String(e.accessHash),createdAt:e.date*1000};s.chatId=String(-1000000000000n-BigInt(s.channel.id));actions.push({clientId:p.clientId,result:'found'});}
   else{delete s.steps.create.intentAt;s.creationReconciledAt=new Date().toISOString();actions.push({clientId:p.clientId,result:'absent_after_full_dialog_scan'});}
   save(file,s);
  }
  save(path.join(FOLDER,'paused-create-reconciliation.json'),{at:new Date().toISOString(),dialogs:dialogs.length,actions});report('paused_creates_reconciled',{dialogs:dialogs.length,groups:actions.length});
 }finally{await c.disconnect();}
}
if(require.main===module)recover().catch(e=>{report('recovery_failed',{code:e.errorMessage||e.code||'operation_failed'});process.exitCode=1;});
