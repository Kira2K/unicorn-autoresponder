// Explicit local operation: no messages, SQL writes, group creation or account exits.
const fs=require('node:fs'),path=require('node:path');
const {ROOT,REPO,FOLDER,read,save,openDb,openCreator,Api,bi,sleep}=require('./live.cjs');
const {MARKET,selectMarket,assertTarget,authorizedTransfer}=require('./handoff-scope.cjs');
const {ensureRole}=require('./handoff-role.cjs'),{useLocalWss}=require('./local-wss.cjs');
const {joinOne}=require('./support-join-one.cjs'),{DESIRED,hasRights}=require('./support-admin-one.cjs');
const OUT=path.join(REPO,'storage/group-handoff-20261019'),FROM='7586552066',TO='8805256389',SUPPORT='8222949251';
const lock=require(ROOT+'/tools/restoration-lock.cjs').acquireLock;
const safe=e=>{const s=String(e.errorMessage||e.code||e.message);return /^[\w:-]{1,120}$/.test(s)?s:'handoff_failed';};
const file=name=>path.join(OUT,name+'.json');
function status(stage,extra={}){save(file('status'),{at:new Date().toISOString(),pid:process.pid,stage,...extra});console.log(JSON.stringify({event:stage,...extra}));}
async function sql(id){const db=await openDb();try{return(await db.query('SELECT id,client_name,client_status,telegram_personal_chat_id,secured_general_chat_id,secured_general_chat_invitation_link FROM noco.clients WHERE coalesce(__nc_deleted,false)=false'+(id?' AND id=$1':''),id?[id]:[])).rows;}finally{await db.end();}}
async function prepare(){
 fs.mkdirSync(OUT,{recursive:true});if(read(file('manifest')))return read(file('manifest'));
 const collected=require('./restored-targets.cjs').collectTargets([FOLDER,path.join(REPO,'storage/group-restoration-additional'),path.join(REPO,'storage/student-invites-20261018/restoration')],read);
 const all=collected.map(({plan,stateFile})=>({clientId:plan.clientId,chatId:read(stateFile).chatId,planHash:plan.planHash,stateFile,sourceMessages:plan.sourceMessages||0}));
 const rows=await sql(),selection=selectMarket(rows,all),audit=read(path.join(REPO,'storage/group-recovery-20261019/leave-readiness.json'));
 if(audit.status!=='complete'||audit.errors.length)throw Error('complete_owner_audit_required');
 const transfers=audit.groups.filter(g=>g.ownerId===FROM).map(g=>{const t=all.find(t=>t.clientId===g.clientId&&t.chatId===g.chatId);if(!t)throw Error('transfer_not_restored');assertTarget(t,rows.find(r=>String(r.id)===t.clientId),read(t.stateFile));return{...t,from:FROM,to:TO};}).sort((a,b)=>a.sourceMessages-b.sourceMessages||Number(a.clientId)-Number(b.clientId));
 if(transfers.length!==49||all.length!==135)throw Error('authorized_handoff_count_changed');
 const manifest={at:new Date().toISOString(),from:FROM,to:TO,all,transfers,market:selection.targets,skipped:selection.skipped};save(file('manifest'),manifest);return manifest;
}
async function main(){
 const manifest=await prepare();if(process.argv.includes('--prepare')){console.log(JSON.stringify({transfers:manifest.transfers.length,market:manifest.market.length,skipped:manifest.skipped.length}));return;}
 const release=lock(path.join(OUT,'run.lock'));const clients=new Map(),dialogLoaded=new Set();let password='';
 async function actor(key){if(clients.has(key))return clients.get(key);const c=useLocalWss(openCreator(key));await Promise.race([c.connect(),sleep(30000).then(()=>{throw Error('handoff_connect_timeout');})]);const id=String((await c.getMe()).id);if(id!==(key==='kira'?FROM:TO))throw Error('handoff_account_mismatch');c.invoke=require('./read-rpc-gate.cjs').paceReadCalls({invoke:c.invoke.bind(c),sleep,onWait:r=>status('waiting_read_flood',{account:key,method:r.method,seconds:r.seconds})});clients.set(key,c);return c;}
 async function close(){for(const c of clients.values())await c.disconnect().catch(()=>{});clients.clear();dialogLoaded.clear();}
 async function batch(fn){let unlock;for(;;){try{unlock=lock(path.join(FOLDER,'batch.lock'));break;}catch(e){if(e.message!=='restoration_already_running')throw e;status('waiting_batch_lock');await sleep(10000);}}try{return await fn();}finally{unlock();}}
 async function validate(t,market=false){const row=(await sql(t.clientId))[0],s=read(t.stateFile);assertTarget(t,row,s);if(market&&!MARKET.has(row.client_status))return null;if(row.secured_general_chat_invitation_link!==s.invitation)throw Error('handoff_invitation_binding_changed');return s;}
 async function bot(method,body){
  if(!['getChatMember','getChatAdministrators'].includes(method))throw Error('handoff_bot_read_only');
  for(let attempt=0;;attempt++){
   while((read(file('bot-read-rate'))?.nextAt||0)>Date.now())await sleep(Math.min(50000,read(file('bot-read-rate')).nextAt-Date.now()));
   let r;try{const response=await fetch(`https://api.telegram.org/bot${process.env.VEU_SUPPORT_BOT}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});r=await response.json();}catch(e){if(attempt<2){await sleep(2000);continue;}throw Object.assign(Error('handoff_bot_read_unavailable'),{code:e.cause?.code||'BOT_READ_UNAVAILABLE'});}
   if(r.ok)return r.result;
   if(r.error_code===429&&r.parameters?.retry_after&&attempt<3){save(file('bot-read-rate'),{nextAt:Date.now()+(r.parameters.retry_after+1)*1000});status('waiting_bot_read_flood',{seconds:r.parameters.retry_after});continue;}
   throw Object.assign(Error('bot_'+r.error_code),r.parameters?.retry_after?{errorMessage:'FLOOD_WAIT_'+r.parameters.retry_after,seconds:r.parameters.retry_after}:{});
  }
 }
 async function input(c,t){if(!dialogLoaded.has(c)){await c.getDialogs({limit:500});dialogLoaded.add(c);}try{return await c.getInputEntity(bi(t.chatId));}catch{const s=read(t.stateFile),r=await c.invoke(new Api.messages.CheckChatInvite({hash:s.invitation.split('/').at(-1).replace(/^\+/,'')}));if(r.className!=='ChatInviteAlready'||String(r.chat?.id)!==String(-BigInt(t.chatId)-1000000000000n))throw Error('handoff_peer_not_member');return await c.getInputEntity(r.chat);}}
 async function join(key,t,market=false){
  const s=await validate(t,market);if(!s){save(file('market-'+t.clientId),{status:'skipped_status_changed'});return;}
  const id=key==='kira'?FROM:TO,name='join-'+id+'-'+t.clientId,previous=read(file(name))||{},member=await bot('getChatMember',{chat_id:t.chatId,user_id:Number(id)});
  if(['creator','administrator','member'].includes(member.status)){save(file(name),{...previous,clientId:t.clientId,done:true,status:previous.accepted?'joined':'already_member',accountId:id,chatId:t.chatId,role:member.status,verifiedAt:Date.now()});return;}
  if(previous.done)throw Error('handoff_verified_membership_lost');if(member.status==='kicked')throw Error('handoff_account_banned');
  const c=await actor(key),rate='join-rate-'+id;
  for(;;){const r=await joinOne({clientId:t.clientId},{...s,channel:s.channel||{id:String(-BigInt(t.chatId)-1000000000000n)}},read(file(name))||{},{accountId:id,now:Date.now,save:r=>save(file(name),r),checkInvite:token=>c.invoke(new Api.messages.CheckChatInvite({hash:token})),joinInvite:async token=>{if(!await validate(t,market))throw Object.assign(Error('market_status_changed'),{errorMessage:'MARKET_STATUS_CHANGED'});return await c.invoke(new Api.messages.ImportChatInvite({hash:token}));},waitForSlot:async()=>{while((read(file(rate))?.nextAt||0)>Date.now())await sleep(Math.min(50000,read(file(rate)).nextAt-Date.now()));},advanceSlot:async()=>save(file(rate),{nextAt:Date.now()+60000}),verifyHistory:async(p,state,chat)=>{const peer=await c.getInputEntity(chat),full=await c.invoke(new Api.channels.GetFullChannel({channel:peer}));if(full.fullChat.hiddenPrehistory)throw Error('handoff_history_hidden');await c.getMessages(peer,{limit:1});}});
   if(r.error==='MARKET_STATUS_CHANGED'){save(file(name),{...r,status:'skipped_status_changed'});return;}
   if(r.done){status('join_verified',{clientId:t.clientId,account:key});return;}if(r.status==='waiting'&&r.retryAt){status('waiting_join_flood',{account:key,clientId:t.clientId,retryAt:r.retryAt});while(Date.now()<r.retryAt)await sleep(Math.min(50000,r.retryAt-Date.now()));continue;}throw Error(r.error||'handoff_join_failed');
  }
 }
 async function supportAndOwner(t){const admins=await bot('getChatAdministrators',{chat_id:t.chatId}),owner=admins.find(p=>p.status==='creator'),d=admins.find(p=>String(p.user.id)===SUPPORT);const rights={changeInfo:'can_change_info',deleteMessages:'can_delete_messages',banUsers:'can_restrict_members',inviteUsers:'can_invite_users',pinMessages:'can_pin_messages',manageCall:'can_manage_video_chats',other:'can_manage_chat'};if(!d||!Object.keys(DESIRED).every(k=>d[rights[k]]))throw Error('handoff_support_rights_missing');return String(owner?.user.id);}
 async function role(c,t,userId,ordinary){
  const peer=await input(c,t),username=userId===TO?'unicorn_service':'very_evil_unicorn',u=await c.getEntity(username);if(String(u.id)!==userId)throw Error('handoff_role_identity_mismatch');const user=await c.getInputEntity(u),name=(ordinary?'ordinary-':'service-admin-')+t.clientId;
  const desired={...DESIRED,addAdmins:true,manageTopics:true,postStories:true,editStories:true,deleteStories:true};
  return await ensureRole(read(file(name))||{},{inspect:async()=>(await c.invoke(new Api.channels.GetParticipant({channel:peer,participant:user}))).participant,matches:p=>ordinary?['ChannelParticipant','ChannelParticipantSelf'].includes(p.className):p.className==='ChannelParticipantCreator'||Object.keys(desired).every(k=>p.adminRights?.[k]===true),save:r=>save(file(name),r),sleep,change:async()=>{await validate(t);if(ordinary&&await supportAndOwner(t)!==TO)throw Error('handoff_demote_before_transfer');return await c.invoke(new Api.channels.EditAdmin({channel:peer,userId:user,adminRights:new Api.ChatAdminRights(ordinary?{}:desired),rank:ordinary?'':'Service'}));}});
 }
 try{
  status('market_memberships',{total:manifest.market.length});
  for(const t of manifest.market){await batch(()=>join('kira',t,true));}
  save(file('market-complete'),{at:new Date().toISOString(),groups:manifest.market.length});
  const pending=manifest.transfers.filter(t=>!read(file('transfer-'+t.clientId))?.done);
  if(pending.length){
   const source=await actor('kira');
   if(!(await source.invoke(new Api.account.GetPassword())).hasPassword){
    for(const t of pending){await batch(async()=>{
     authorizedTransfer(t,manifest.transfers);await validate(t);status('preparing_service_before_2fa',{clientId:t.clientId,prepared:pending.filter(x=>read(file('prepared-'+x.clientId))?.done).length,total:pending.length});
     const owner=await supportAndOwner(t);if(![FROM,TO].includes(owner))throw Error('handoff_current_owner_changed');await join('unicorn',t);if(owner===FROM)await role(source,t,TO,false);
     save(file('prepared-'+t.clientId),{done:true,clientId:t.clientId,chatId:t.chatId,serviceId:TO,at:new Date().toISOString()});
    });}
    throw Error('handoff_2fa_missing');
   }
   await close();
   status('waiting_local_password',{pending:pending.length});password=await require('./local-extra-auth.cjs').secret('@very_evil_unicorn: Telegram 2FA for 49 ownership transfers (local only)');
  }
  for(const t of manifest.transfers){
   authorizedTransfer(t,manifest.transfers);const receipt=file('transfer-'+t.clientId),previous=read(receipt);
   if(previous?.blocked)throw Error('handoff_previous_transfer_blocked');
   while((read(file('transfer-rate'))?.nextAt||0)>Date.now())await sleep(Math.min(50000,read(file('transfer-rate')).nextAt-Date.now()));
   await batch(async()=>{
    await validate(t);status('transferring',{clientId:t.clientId,completed:manifest.transfers.filter(x=>read(file('transfer-'+x.clientId))?.done).length,total:49});
    if(!previous?.done){const owner=await supportAndOwner(t);if(![FROM,TO].includes(owner))throw Error('handoff_current_owner_changed');await join('unicorn',t);const source=await actor('kira');if(owner===FROM)await role(source,t,TO,false);
     const result=await require('./transfer-timur.cjs').execute(read(t.stateFile),{client:source,scope:t,authorizedScope:t,receipt,passwordProvider:async()=>password});
     save(file('transfer-rate'),{nextAt:Date.now()+60000});if(!result.done)throw Object.assign(Error(result.error||'handoff_transfer_blocked'),{seconds:result.retryNotBefore?Math.max(0,Math.ceil((result.retryNotBefore-Date.now())/1000)):undefined});
    }
    if(await supportAndOwner(t)!==TO)throw Error('handoff_owner_verification_failed');
    if(manifest.market.some(m=>m.clientId===t.clientId)&&await validate(t,true))await role(await actor('unicorn'),t,FROM,true);
   });
  }
  password='';status('final_verification');const results=[];
  for(const t of manifest.all){await validate(t);results.push({clientId:t.clientId,ownerId:await supportAndOwner(t),supportAdmin:true});await sleep(600);}
  for(const t of manifest.market){if(!await validate(t,true))continue;const m=await bot('getChatMember',{chat_id:t.chatId,user_id:Number(FROM)});if(m.status!=='member')throw Error('handoff_market_not_ordinary_member');}
  if(results.some(r=>r.ownerId!==TO))throw Error('handoff_final_owner_mismatch');save(file('complete'),{at:new Date().toISOString(),groups:results,market:manifest.market.map(t=>t.clientId),skipped:manifest.skipped});status('complete',{owners:results.length,marketMembers:manifest.market.length});
 }catch(e){status('blocked',{error:safe(e),seconds:e.seconds,errorName:e.name,frames:String(e.stack||'').split('\n').slice(1,5).map(line=>line.trim()),connectionError:/disconnected|socket|connection/i.test(String(e.message||''))});throw e;}finally{password='';await close();release();}
}
module.exports={prepare,main};
if(require.main===module)main().then(()=>process.exit(0)).catch(e=>{console.error(JSON.stringify({event:'handoff_stopped',error:safe(e)}));process.exit(1);});
