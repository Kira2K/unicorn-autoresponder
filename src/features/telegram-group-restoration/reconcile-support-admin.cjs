const path=require('node:path');
const {FOLDER,ROOT,REPO,read,save,openCreator,Api,sleep}=require('./live.cjs');
const {grantOne,DESIRED}=require('./support-admin-one.cjs');
async function main(id){
 const row=require('./restored-targets.cjs').collectTargets([FOLDER,path.join(REPO,'storage/group-restoration-additional')],read).find(r=>r.plan.clientId===id);if(!row)throw Error('admin_reconcile_scope_missing');
 const state=read(row.stateFile),file=path.join(FOLDER,'support-admin/8222949251/client-'+id+'.json');
 let release;for(;;){try{release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));break;}catch(e){if(e.message!=='restoration_already_running')throw e;await sleep(10000);}}
 const owner=read(path.join(FOLDER,'transfer-client-'+id+'.json'))?.done?'8805256389':state.ownerId||'8805256389',key={'8805256389':'unicorn','7586552066':'kira','343610488':'local'}[owner];
 const c=openCreator(key);
 try{await c.connect();if(String((await c.getMe()).id)!==owner)throw Error('admin_reconcile_owner_mismatch');const d=(await c.getDialogs({limit:300})).find(d=>String(d.id)===state.chatId);if(!d?.entity?.creator)throw Error('admin_reconcile_not_owner');const channel=d.inputEntity,u=await c.getEntity('veu_support');if(String(u.id)!=='8222949251')throw Error('admin_reconcile_account_mismatch');const user=await c.getInputEntity(u);
  const get=async()=> (await c.invoke(new Api.channels.GetParticipant({channel,participant:user}))).participant;
  const current=await get(),missing=Object.keys(DESIRED).filter(k=>current.adminRights?.[k]!==true);
  save(path.join(FOLDER,'support-admin/8222949251/reconcile-'+id+'-20261017.json'),{at:new Date().toISOString(),clientId:id,chatId:state.chatId,role:current.className,rights:current.adminRights,missing});
  console.log(JSON.stringify({clientId:id,role:current.className,missing}));
  const result=await grantOne(read(file)||{},{accountId:'8222949251',chatId:state.chatId,save:r=>save(file,r),getParticipant:get,promote:(rights,rank)=>c.invoke(new Api.channels.EditAdmin({channel,userId:user,adminRights:new Api.ChatAdminRights(rights),rank}))});
  console.log(JSON.stringify({clientId:id,done:!!result.done}));
 }catch(e){console.error(JSON.stringify({error:e.errorMessage||e.code||e.message,seconds:e.seconds}));process.exitCode=1;}finally{await c.disconnect();release();}
}
if(require.main===module)main(process.argv[2]).catch(e=>{console.error(e.code||'admin_reconciliation_failed');process.exitCode=1;});
